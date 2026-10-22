import { Zip, ZipPassThrough } from "fflate";
export const MAX_ZIP = 50 * 1024 * 1024;
export const MAX_EXPANDED = 100 * 1024 * 1024;
export const MAX_FILES = 1001;
export const MAX_MANIFEST = 8 * 1024 * 1024;
export const backupError = () =>
  new Error(
    "バックアップの内容を確認できません。このアプリで書き出した対応形式のZIPを選んでください。既存データは変更していません。",
  );
const table = Array.from({ length: 256 }, (_, n) => {
  for (let j = 0; j < 8; j++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function writeBackupZip(
  files: Array<{ name: string; blob: Blob }>,
) {
  let total = 0,
    failure: Error | undefined,
    ended = false;
  const parts: BlobPart[] = [];
  const zip = new Zip((error, data, final) => {
    if (error) {
      failure = error;
      return;
    }
    total += data.byteLength;
    if (total > MAX_ZIP) {
      failure = new Error(
        "バックアップが50MiBを超えます。作品のPNGを個別に書き出して残してください。",
      );
      return;
    }
    parts.push(new Uint8Array(data));
    ended = final;
  });
  try {
    for (const file of files) {
      const entry = new ZipPassThrough(file.name);
      zip.add(entry);
      const reader = file.blob.stream().getReader();
      try {
        let chunks = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          entry.push(chunk.value);
          if (failure) throw failure;
          if (++chunks % 16 === 0)
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        reader.releaseLock();
      }
      entry.push(new Uint8Array(), true);
      if (failure) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    zip.end();
    if (failure) throw failure;
    if (!ended) throw backupError();
    return new Blob(parts, { type: "application/zip" });
  } finally {
    zip.terminate();
  }
}
/** この形式はSTOREのみ。展開せずに長さ・CRC・ヘッダーを検証し、ZIP爆弾を拒否する。 */
export function readBackupZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_ZIP) throw backupError();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    end = bytes.length - 22;
  const u16 = (at: number) => v.getUint16(at, true),
    u32 = (at: number) => v.getUint32(at, true);
  try {
    if (
      u32(end) !== 0x06054b50 ||
      u16(end + 4) ||
      u16(end + 6) ||
      u16(end + 20)
    )
      throw backupError();
    const count = u16(end + 10),
      directory = u32(end + 16),
      length = u32(end + 12);
    if (
      !count ||
      count > MAX_FILES ||
      u16(end + 8) !== count ||
      directory + length !== end
    )
      throw backupError();
    const result = new Map<string, Uint8Array>(),
      ranges: Array<[number, number]> = [];
    let at = directory,
      expanded = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || u32(at) !== 0x02014b50) throw backupError();
      const flags = u16(at + 8),
        method = u16(at + 10),
        crc = u32(at + 16),
        size = u32(at + 20),
        unpacked = u32(at + 24);
      const nameLength = u16(at + 28),
        extra = u16(at + 30),
        comment = u16(at + 32),
        local = u32(at + 42);
      if (
        flags & ~0x0808 ||
        method !== 0 ||
        size !== unpacked ||
        u16(at + 34) ||
        extra ||
        comment ||
        at + 46 + nameLength > end
      )
        throw backupError();
      const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
      if ([...nameBytes].some((n) => n > 127)) throw backupError();
      const name = new TextDecoder().decode(nameBytes);
      if (
        !(
          name === "manifest.json" ||
          /^assets\/(?:0|[1-9][0-9]{0,3})\.png$/.test(name)
        ) ||
        result.has(name)
      )
        throw backupError();
      if (size > (name === "manifest.json" ? MAX_MANIFEST : 10 * 1024 * 1024))
        throw backupError();
      expanded += size;
      if (expanded > MAX_EXPANDED) throw backupError();
      if (
        local + 30 > directory ||
        u32(local) !== 0x04034b50 ||
        u16(local + 6) !== flags ||
        u16(local + 8) !== method ||
        u16(local + 26) !== nameLength ||
        u16(local + 28)
      )
        throw backupError();
      const start = local + 30 + nameLength,
        finish = start + size;
      if (
        finish > directory ||
        !nameBytes.every((b, j) => bytes[local + 30 + j] === b)
      )
        throw backupError();
      let recordEnd = finish;
      if (flags & 8) {
        if (
          finish + 16 > directory ||
          u32(finish) !== 0x08074b50 ||
          u32(finish + 4) !== crc ||
          u32(finish + 8) !== size ||
          u32(finish + 12) !== size
        )
          throw backupError();
        recordEnd += 16;
      } else if (
        u32(local + 14) !== crc ||
        u32(local + 18) !== size ||
        u32(local + 22) !== size
      )
        throw backupError();
      const data = bytes.subarray(start, finish);
      if (crc32(data) !== crc) throw backupError();
      result.set(name, data);
      ranges.push([local, recordEnd]);
      at += 46 + nameLength;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (
      at !== end ||
      ranges[0][0] !== 0 ||
      ranges.at(-1)![1] !== directory ||
      ranges.some((range, i) => i && range[0] !== ranges[i - 1][1])
    )
      throw backupError();
    if (!result.has("manifest.json")) throw backupError();
    return result;
  } catch {
    throw backupError();
  }
}
