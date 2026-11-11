import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Passwords set from the app are stored as a salted scrypt hash, never as the
 * text that was typed. The encoded value also names the credential: session
 * cookies are signed over it, so changing the password invalidates every
 * existing session without the server keeping any session state.
 */
const HASH_PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// 86 base64url characters carry a 64-byte key (the last character has four
// unused bits, which is why comparisons below use the encoded text).
const ENCODED_KEY_LENGTH = 86;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type PasswordHash = {
  salt: string;
  hash: string;
};

/** Normalised so an accented password typed two ways is one credential. */
function normalize(password: string) {
  return password.normalize("NFKC");
}

function derive(password: string, salt: string) {
  return scryptSync(normalize(password), salt, KEY_BYTES, SCRYPT_OPTIONS);
}

export function isPasswordHash(value: string) {
  return value.startsWith(`${HASH_PREFIX}$`);
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(SALT_BYTES).toString("base64url");

  return { salt, hash: derive(password, salt).toString("base64url") };
}

/** The stored material, and the value a session signature is keyed to. */
export function passwordHashMaterial({ salt, hash }: PasswordHash) {
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPasswordHash(password: string, material: string): boolean {
  const parts = material.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return false;

  const salt = parts[1];
  const expected = parts[2];
  if (!salt || !expected || expected.length !== ENCODED_KEY_LENGTH) return false;

  let actual: string;
  try {
    actual = derive(password, salt).toString("base64url");
  } catch {
    return false;
  }

  // Compare the encoded text, not decoded bytes: the final base64url character
  // carries unused bits, so two different strings can decode to the same bytes.
  return timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
}
