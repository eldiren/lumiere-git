import { safeStorage } from "electron";

/**
 * True when safeStorage encrypts with a real OS keyring. Linux falls back to a hard-coded key
 * ("basic_text") when no keyring is running; don't trust that.
 */
export function canPersistSecrets(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === "basic_text" || backend === "unknown") return false;
  }
  return true;
}

export function encryptSecret(secret: string): string {
  return safeStorage.encryptString(secret).toString("base64");
}

export function decryptSecret(blob: string): string {
  return safeStorage.decryptString(Buffer.from(blob, "base64"));
}
