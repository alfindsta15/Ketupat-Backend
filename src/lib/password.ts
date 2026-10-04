/**
 * Hash password memakai PBKDF2 (WebCrypto native, cepat & hemat CPU di Workers).
 * Format: pbkdf2$<iterasi>$<salt base64>$<hash base64>
 * Batas iterasi PBKDF2 di Workers = 100.000.
 */
const ITERATIONS = 100_000;
const KEY_BITS = 256;

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(plain, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/** true bila hash memakai format lama (bcrypt dari versi Express). */
export const isLegacyBcrypt = (hash: string) => /^\$2[aby]\$/.test(hash);

export async function verifyPbkdf2(plain: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const derived = await derive(plain, fromB64(salt), Number(iter));
  return safeEqual(derived, fromB64(hash));
}
