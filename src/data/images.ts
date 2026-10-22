import { pngBlob } from "../images/png";

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_PIXELS = 16_000_000;
export const MAX_REFERENCE_SIDE = 1600;
const formats = new Set(["image/png", "image/jpeg", "image/webp"]);

function invalidImage() {
  return new Error(
    "画像を読み取れません。壊れていないPNG・JPEG・WebPを選んでください。",
  );
}

function dimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw invalidImage();
  if (width * height > MAX_REFERENCE_PIXELS)
    throw new Error(
      "画像は1,600万画素以下のものを選んでください。端末で小さくしてから選び直せます。",
    );
  return { width, height };
}

function matches(bytes: Uint8Array, at: number, expected: number[]) {
  return expected.every((value, index) => bytes[at + index] === value);
}

function ascii(bytes: Uint8Array, at: number, length: number) {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function inspectPng(bytes: Uint8Array, view: DataView) {
  if (
    bytes.length < 33 ||
    !matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) ||
    view.getUint32(8) !== 13 ||
    ascii(bytes, 12, 4) !== "IHDR"
  )
    throw invalidImage();
  return dimensions(view.getUint32(16), view.getUint32(20));
}

function inspectJpeg(bytes: Uint8Array, view: DataView) {
  if (!matches(bytes, 0, [0xff, 0xd8])) throw invalidImage();
  let offset = 2;
  let result: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw invalidImage();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      marker === 0xd9
    )
      throw invalidImage();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw invalidImage();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) throw invalidImage();
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      // Reject conflicting frame headers before passing input to the decoder.
      if (
        result ||
        length < 8 ||
        bytes[offset + 7] < 1 ||
        length < 8 + 3 * bytes[offset + 7]
      )
        throw invalidImage();
      result = dimensions(
        view.getUint16(offset + 5),
        view.getUint16(offset + 3),
      );
    }
    if (marker === 0xda) {
      if (!result) throw invalidImage();
      return result;
    }
    offset += length;
  }
  throw invalidImage();
}

function inspectWebp(bytes: Uint8Array, view: DataView) {
  if (
    bytes.length < 20 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  )
    throw invalidImage();
  const end = view.getUint32(4, true) + 8;
  if (end < 20 || end > bytes.length) throw invalidImage();
  let offset = 12;
  while (offset + 8 <= end) {
    const chunk = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + length > end) throw invalidImage();
    if (chunk === "VP8X") {
      if (length !== 10) throw invalidImage();
      const width =
        1 +
        bytes[payload + 4] +
        bytes[payload + 5] * 256 +
        bytes[payload + 6] * 65536;
      const height =
        1 +
        bytes[payload + 7] +
        bytes[payload + 8] * 256 +
        bytes[payload + 9] * 65536;
      return dimensions(width, height);
    }
    if (chunk === "VP8 ") {
      if (
        length < 10 ||
        (bytes[payload] & 1) !== 0 ||
        !matches(bytes, payload + 3, [0x9d, 0x01, 0x2a])
      )
        throw invalidImage();
      return dimensions(
        view.getUint16(payload + 6, true) & 0x3fff,
        view.getUint16(payload + 8, true) & 0x3fff,
      );
    }
    if (chunk === "VP8L") {
      if (
        length < 5 ||
        bytes[payload] !== 0x2f ||
        bytes[payload + 4] >> 5 !== 0
      )
        throw invalidImage();
      const bits = view.getUint32(payload + 1, true);
      return dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
    }
    offset = payload + length + (length % 2);
  }
  throw invalidImage();
}

/** Only dimensions are trusted here; the browser must still fully decode the image. */
export function inspectImageDimensions(buffer: ArrayBuffer, mime: string) {
  if (!formats.has(mime))
    throw new Error(
      "PNG・JPEG・WebPを選んでください。HEICやSVGはPNGまたはJPEGに変換してから登録できます。",
    );
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (mime === "image/png") return inspectPng(bytes, view);
  if (mime === "image/jpeg") return inspectJpeg(bytes, view);
  return inspectWebp(bytes, view);
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Safari and older implementations may not support these bitmap options.
    }
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(invalidImage());
    };
    // Browser image decoding applies EXIF orientation by default.
    image.src = url;
  });
}

export async function prepareReferenceImage(
  file: File,
): Promise<PreparedImage> {
  if (!formats.has(file.type))
    throw new Error(
      "PNG・JPEG・WebPを選んでください。HEICやSVGはPNGまたはJPEGに変換してから登録できます。",
    );
  if (file.size > MAX_REFERENCE_BYTES)
    throw new Error("画像は10MiB以下のものを選んでください。");
  if (!file.size) throw invalidImage();
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(
      "画像ファイルを読み込めません。もう一度選び直してください。",
    );
  }
  const header = inspectImageDimensions(buffer, file.type);
  let image: DecodedImage;
  try {
    image = await decodeImage(file);
  } catch {
    throw invalidImage();
  }
  const canvas = document.createElement("canvas");
  try {
    dimensions(image.width, image.height);
    if (!(
      (image.width === header.width && image.height === header.height) ||
      (image.width === header.height && image.height === header.width)
    ))
      throw invalidImage();
    const scale = Math.min(
      1,
      MAX_REFERENCE_SIDE / Math.max(image.width, image.height),
    );
    canvas.width = Math.max(1, Math.floor(image.width * scale));
    canvas.height = Math.max(1, Math.floor(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("このブラウザーでは画像の変換を利用できません。");
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    const blob = await pngBlob(canvas);
    if (blob.type !== "image/png" || blob.size > MAX_REFERENCE_BYTES)
      throw new Error(
        "変換後の画像が大きすぎます。小さな画像を選び直してください。",
      );
    return { blob, width: canvas.width, height: canvas.height };
  } catch (error) {
    if (error instanceof DOMException || error instanceof RangeError) {
      throw new Error(
        "画像を変換できません。画像を小さくして、もう一度選び直してください。",
        { cause: error },
      );
    }
    throw error;
  } finally {
    image.dispose();
    canvas.width = canvas.height = 0;
  }
}
