import { readBackupZip } from "./backupZip";
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const entries = readBackupZip(new Uint8Array(event.data));
    self.postMessage({ entries }, { transfer: [event.data] });
  } catch {
    self.postMessage({ error: true });
  }
};
