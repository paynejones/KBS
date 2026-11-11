import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  isPasswordHash,
  passwordHashMaterial,
  verifyPasswordHash,
} from "../src/lib/password-hash";

test("a hashed password verifies and rejects everything else", () => {
  const material = passwordHashMaterial(hashPassword("correct horse battery staple"));

  assert.equal(isPasswordHash(material), true);
  assert.equal(verifyPasswordHash("correct horse battery staple", material), true);
  assert.equal(verifyPasswordHash("Correct horse battery staple", material), false);
  assert.equal(verifyPasswordHash("", material), false);
});

test("the stored material carries a salt and never the password", () => {
  const material = passwordHashMaterial(hashPassword("hunter2-hunter2"));

  assert.match(material, /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
  assert.equal(material.includes("hunter2"), false);
});

test("each hash uses a fresh salt for the same password", () => {
  const first = passwordHashMaterial(hashPassword("same password"));
  const second = passwordHashMaterial(hashPassword("same password"));

  assert.notEqual(first, second);
  assert.equal(verifyPasswordHash("same password", first), true);
  assert.equal(verifyPasswordHash("same password", second), true);
});

test("tampered or malformed material never verifies", () => {
  const material = passwordHashMaterial(hashPassword("a password"));
  const [prefix, salt, hash] = material.split("$");
  assert.ok(prefix && salt && hash);

  const flipped = hash.endsWith("A") ? `${hash.slice(0, -1)}B` : `${hash.slice(0, -1)}A`;

  assert.equal(verifyPasswordHash("a password", `${prefix}$${salt}$${flipped}`), false);
  assert.equal(verifyPasswordHash("a password", `${prefix}$${salt}`), false);
  assert.equal(verifyPasswordHash("a password", "plain-text-password"), false);
  assert.equal(verifyPasswordHash("a password", `${prefix}$not base64!$${hash}`), false);
  assert.equal(verifyPasswordHash("a password", `${prefix}$${salt}$short`), false);
});

test("unicode passwords are normalised before hashing", () => {
  const composed = "caf\u00e9-password";
  const decomposed = "cafe\u0301-password";

  assert.equal(verifyPasswordHash(composed, passwordHashMaterial(hashPassword(decomposed))), true);
});
