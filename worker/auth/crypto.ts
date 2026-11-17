/** Encoding and hashing helpers for auth. */

export const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

export const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

/** A fresh opaque secret: random bytes, base64url. */
export const randomToken = (bytes = 32): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

export const sha256 = async (value: string): Promise<string> =>
  bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

/** Constant-time string comparison (both sides hashed first, so length leaks nothing). */
export const secretEquals = async (a: string, b: string): Promise<boolean> => {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && x.length === y.length;
};
