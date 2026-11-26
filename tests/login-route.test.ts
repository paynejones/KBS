import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_SIGN_IN_ATTEMPTS, SESSION_COOKIE } from "../src/lib/auth";

const ENV_PASSWORD = "environment-password";
const SECRET = "t".repeat(32);

function signInRequest(body: unknown, forwardedFor?: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function withAuthEnvironment(
  run: (post: typeof import("../src/app/api/auth/login/route").POST) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "kbs-login-"));
  const previous = {
    password: process.env.KBS_AUTH_PASSWORD,
    secret: process.env.KBS_AUTH_SECRET,
    credentialPath: process.env.KBS_AUTH_CREDENTIAL_PATH,
    trustProxy: process.env.KBS_TRUST_PROXY,
  };

  process.env.KBS_AUTH_PASSWORD = ENV_PASSWORD;
  process.env.KBS_AUTH_SECRET = SECRET;
  // No stored credential, so the environment password is the one in charge.
  process.env.KBS_AUTH_CREDENTIAL_PATH = path.join(directory, "absent.json");
  delete process.env.KBS_TRUST_PROXY;

  try {
    const { POST } = await import("../src/app/api/auth/login/route");
    await run(POST);
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

test("the sign-in form may send next as null", async () => {
  await withAuthEnvironment(async (POST) => {
    // A direct visit to /signin has no next parameter, so the form sends null.
    const nullNext = await POST(signInRequest({ password: ENV_PASSWORD, next: null }));
    assert.equal(nullNext.status, 200);
    assert.equal((await nullNext.json()).redirectTo, "/");
    assert.match(nullNext.headers.get("set-cookie") ?? "", new RegExp(`${SESSION_COOKIE}=`));

    const withNext = await POST(
      signInRequest({ password: ENV_PASSWORD, next: "/pages?view=grid" }),
    );
    assert.equal(withNext.status, 200);
    assert.equal((await withNext.json()).redirectTo, "/pages?view=grid");

    const omitted = await POST(signInRequest({ password: ENV_PASSWORD }));
    assert.equal(omitted.status, 200);
    assert.equal((await omitted.json()).redirectTo, "/");

    // null is a destination value, never a validation failure.
    const wrongPassword = await POST(
      signInRequest({ password: "not-the-password", next: null }),
    );
    assert.equal(wrongPassword.status, 401);
    assert.equal((await wrongPassword.json()).error, "That password is not correct.");

    const offsite = await POST(
      signInRequest({ password: ENV_PASSWORD, next: "//evil.example" }),
    );
    assert.equal(offsite.status, 200);
    assert.equal((await offsite.json()).redirectTo, "/");
  });
});

test("wrong guesses never lock the owner out when no proxy supplies an address", async () => {
  await withAuthEnvironment(async (POST) => {
    for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS + 2; attempt += 1) {
      const response = await POST(signInRequest({ password: `guess-${attempt}` }));
      assert.equal(response.status, 401, `attempt ${attempt} is refused, never throttled`);
    }

    const correct = await POST(signInRequest({ password: ENV_PASSWORD }));
    assert.equal(correct.status, 200, "the real password still signs in after a guessing run");
  });
});

test("a trusted proxy throttles one address and leaves another address alone", async () => {
  await withAuthEnvironment(async (POST) => {
    process.env.KBS_TRUST_PROXY = "1";

    // The left hop is caller-controlled; the right one is what the proxy saw.
    const fromAttacker = (password: string) =>
      signInRequest({ password }, "1.2.3.4, 203.0.113.9");

    for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
      assert.equal((await POST(fromAttacker("wrong"))).status, 401);
    }
    const blocked = await POST(fromAttacker("wrong"));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "600");

    const otherAddress = await POST(signInRequest({ password: "wrong" }, "198.51.100.7"));
    assert.equal(otherAddress.status, 401, "a blocked address does not block anyone else");

    const owner = await POST(signInRequest({ password: ENV_PASSWORD }, "198.51.100.7"));
    assert.equal(owner.status, 200);

    // Even the throttled address is only throttled for guesses: the correct
    // password still signs in, so the allowance can never lock anyone out.
    const ownerThroughBlockedAddress = await POST(fromAttacker(ENV_PASSWORD));
    assert.equal(ownerThroughBlockedAddress.status, 200);
  });
});
