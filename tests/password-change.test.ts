import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_SIGN_IN_ATTEMPTS,
  SESSION_COOKIE,
  createSessionToken,
  readAuthConfig,
  verifyPassword,
  verifySessionToken,
} from "../src/lib/auth";
import { MIN_PASSWORD_LENGTH } from "../src/lib/password-policy";
import { readStoredPassword } from "../src/lib/password-store";

const ENV_PASSWORD = "environment-password";
const SECRET = "t".repeat(32);
const NEW_PASSWORD = "a-long-enough-password";

function changeRequest(body: unknown, forwardedFor?: string) {
  return new Request("http://localhost/api/auth/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function withAuthEnvironment(
  run: (
    post: typeof import("../src/app/api/auth/password/route").POST,
    credentialPath: string,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "kbs-password-"));
  const credentialPath = path.join(directory, "auth-credential.json");
  const previous = {
    password: process.env.KBS_AUTH_PASSWORD,
    secret: process.env.KBS_AUTH_SECRET,
    credentialPath: process.env.KBS_AUTH_CREDENTIAL_PATH,
    trustProxy: process.env.KBS_TRUST_PROXY,
  };

  process.env.KBS_AUTH_PASSWORD = ENV_PASSWORD;
  process.env.KBS_AUTH_SECRET = SECRET;
  process.env.KBS_AUTH_CREDENTIAL_PATH = credentialPath;
  delete process.env.KBS_TRUST_PROXY;

  try {
    const { POST } = await import("../src/app/api/auth/password/route");
    await run(POST, credentialPath);
  } finally {
    if (previous.password === undefined) delete process.env.KBS_AUTH_PASSWORD;
    else process.env.KBS_AUTH_PASSWORD = previous.password;

    if (previous.secret === undefined) delete process.env.KBS_AUTH_SECRET;
    else process.env.KBS_AUTH_SECRET = previous.secret;

    if (previous.credentialPath === undefined) delete process.env.KBS_AUTH_CREDENTIAL_PATH;
    else process.env.KBS_AUTH_CREDENTIAL_PATH = previous.credentialPath;

    if (previous.trustProxy === undefined) delete process.env.KBS_TRUST_PROXY;
    else process.env.KBS_TRUST_PROXY = previous.trustProxy;

    await rm(directory, { recursive: true, force: true });
  }
}

function sessionCookie(response: Response) {
  const header = response.headers.get("set-cookie");
  const match = header?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));

  return match?.[1] ?? null;
}

test("changing the password stores a hash, re-keys the session, and ends other sessions", async () => {
  await withAuthEnvironment(async (POST, credentialPath) => {
    const beforeConfig = readAuthConfig(process.env);
    assert.ok(beforeConfig.ok);
    const oldSession = createSessionToken(beforeConfig.config);

    const wrongCurrent = await POST(
      changeRequest({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD }),
    );
    assert.equal(wrongCurrent.status, 401);
    await assert.rejects(readFile(credentialPath, "utf8"));

    const shortPassword = await POST(
      changeRequest({
        currentPassword: ENV_PASSWORD,
        newPassword: "s".repeat(MIN_PASSWORD_LENGTH - 1),
      }),
    );
    assert.equal(shortPassword.status, 400);

    const unchanged = await POST(
      changeRequest({ currentPassword: ENV_PASSWORD, newPassword: ENV_PASSWORD }),
    );
    assert.equal(unchanged.status, 400);
    await assert.rejects(readFile(credentialPath, "utf8"));

    const changed = await POST(
      changeRequest({ currentPassword: ENV_PASSWORD, newPassword: NEW_PASSWORD }),
    );
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).ok, true);

    const stored = readStoredPassword();
    assert.ok(stored);
    assert.equal(verifyPassword(NEW_PASSWORD, stored), true);
    assert.equal(verifyPassword(ENV_PASSWORD, stored), false);

    const raw = await readFile(credentialPath, "utf8");
    assert.match(raw, /"algorithm": "scrypt"/);
    assert.equal(raw.includes(NEW_PASSWORD), false);
    assert.equal(raw.includes(ENV_PASSWORD), false);

    const afterConfig = readAuthConfig(process.env, stored);
    assert.ok(afterConfig.ok);
    assert.equal(verifySessionToken(oldSession, afterConfig.config), false);

    const freshSession = sessionCookie(changed);
    assert.ok(freshSession);
    assert.equal(verifySessionToken(freshSession, afterConfig.config), true);

    // The stored file overrides the environment password; removing it brings
    // the environment password back, which is the recovery path.
    const fallback = readAuthConfig(process.env, null);
    assert.ok(fallback.ok);
    assert.equal(verifyPassword(ENV_PASSWORD, fallback.config.password), true);
    assert.equal(verifyPassword(NEW_PASSWORD, fallback.config.password), false);
  });
});

test("a throttled address gets 429 for a wrong current password but still changes it with the right one", async () => {
  await withAuthEnvironment(async (POST) => {
    process.env.KBS_TRUST_PROXY = "1";

    // The left hop is caller-controlled; the right one is what the proxy saw.
    const fromAddress = (currentPassword: string) =>
      changeRequest(
        { currentPassword, newPassword: NEW_PASSWORD },
        "1.2.3.4, 203.0.113.9",
      );

    for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
      const response = await POST(fromAddress("not-the-password"));
      assert.equal(response.status, 401, `attempt ${attempt} is a plain refusal`);
    }

    const blocked = await POST(fromAddress("not-the-password"));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "600");

    const otherAddress = await POST(
      changeRequest(
        { currentPassword: "not-the-password", newPassword: NEW_PASSWORD },
        "198.51.100.7",
      ),
    );
    assert.equal(otherAddress.status, 401, "a blocked address does not block anyone else");

    // The allowance only refuses guesses: the real password still changes it.
    const changed = await POST(fromAddress(ENV_PASSWORD));
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).ok, true);
  });
});

test("repeated wrong current passwords never return 429 without a trusted proxy", async () => {
  await withAuthEnvironment(async (POST, credentialPath) => {
    for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS + 2; attempt += 1) {
      const response = await POST(
        changeRequest({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD }),
      );
      assert.equal(response.status, 401, `attempt ${attempt} is refused, never throttled`);
    }

    await assert.rejects(readFile(credentialPath, "utf8"), "a guessing run stores nothing");

    // No shared bucket was spent, so the owner's own attempt is not throttled.
    const changed = await POST(
      changeRequest({ currentPassword: ENV_PASSWORD, newPassword: NEW_PASSWORD }),
    );
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).ok, true);
  });
});
