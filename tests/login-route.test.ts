import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SESSION_COOKIE } from "../src/lib/auth";

const ENV_PASSWORD = "environment-password";
const SECRET = "t".repeat(32);

function signInRequest(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the sign-in form may send next as null", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kbs-login-"));
  const previous = {
    password: process.env.KBS_AUTH_PASSWORD,
    secret: process.env.KBS_AUTH_SECRET,
    credentialPath: process.env.KBS_AUTH_CREDENTIAL_PATH,
  };

  process.env.KBS_AUTH_PASSWORD = ENV_PASSWORD;
  process.env.KBS_AUTH_SECRET = SECRET;
  // No stored credential, so the environment password is the one in charge.
  process.env.KBS_AUTH_CREDENTIAL_PATH = path.join(directory, "absent.json");

  try {
    const { POST } = await import("../src/app/api/auth/login/route");

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
  } finally {
    if (previous.password === undefined) delete process.env.KBS_AUTH_PASSWORD;
    else process.env.KBS_AUTH_PASSWORD = previous.password;

    if (previous.secret === undefined) delete process.env.KBS_AUTH_SECRET;
    else process.env.KBS_AUTH_SECRET = previous.secret;

    if (previous.credentialPath === undefined) delete process.env.KBS_AUTH_CREDENTIAL_PATH;
    else process.env.KBS_AUTH_CREDENTIAL_PATH = previous.credentialPath;

    await rm(directory, { recursive: true, force: true });
  }
});
