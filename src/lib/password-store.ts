import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashPassword, passwordHashMaterial, type PasswordHash } from "@/lib/password-hash";

const STORE_VERSION = 1;

type StoredCredential = PasswordHash & {
  version: number;
  algorithm: "scrypt";
  updatedAt: string;
};

const warnedAbout = new Set<string>();

/**
 * Where a password set from Settings lives. The environment password remains
 * the fallback, so deleting this file is also the recovery path.
 */
export function credentialFilePath() {
  // Default next to attachments in the project's data directory. The override
  // is used as given, exactly like ATTACHMENTS_DIR: resolving it against the
  // working directory would make Turbopack trace the whole project into the
  // server bundle.
  return (
    process.env.KBS_AUTH_CREDENTIAL_PATH?.trim() ||
    path.join(process.cwd(), "data", "auth-credential.json")
  );
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<StoredCredential>;

  return (
    candidate.version === STORE_VERSION &&
    candidate.algorithm === "scrypt" &&
    typeof candidate.salt === "string" &&
    candidate.salt.length > 0 &&
    typeof candidate.hash === "string" &&
    candidate.hash.length > 0 &&
    typeof candidate.updatedAt === "string"
  );
}

function readStoredCredential(filePath = credentialFilePath()): StoredCredential | null {
  let raw: string;

  try {
    // The credential file can live outside the project, like a mounted secret,
    // so this intentional read opts out of Turbopack's project-wide tracing.
    raw = readFileSync(/* turbopackIgnore: true */ filePath, "utf8");
  } catch {
    // No file is the normal case: the environment password is in charge.
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredCredential(parsed)) throw new Error("Unexpected credential shape");

    return parsed;
  } catch (error) {
    // A damaged file must never lock the workspace: fall back to the
    // environment password and say so once instead of on every request.
    if (!warnedAbout.has(filePath)) {
      warnedAbout.add(filePath);
      console.warn(
        `Ignoring an unreadable password credential at ${filePath}; using KBS_AUTH_PASSWORD instead.`,
        error,
      );
    }

    return null;
  }
}

/**
 * Read on every request by the proxy so a change takes effect immediately.
 * The file is a few hundred bytes; reading it costs less than the HMAC that
 * follows, and avoids caching a value that another request may rotate.
 */
export function readStoredPassword(): string | null {
  const stored = readStoredCredential();

  return stored ? passwordHashMaterial(stored) : null;
}

export function writeStoredPassword(password: string): {
  material: string;
  updatedAt: string;
} {
  const filePath = credentialFilePath();
  const stored: StoredCredential = {
    version: STORE_VERSION,
    algorithm: "scrypt",
    ...hashPassword(password),
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(path.dirname(filePath), { recursive: true });

  // Write beside the target and rename over it, so a reader never sees a
  // half-written file.
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, filePath);

  return { material: passwordHashMaterial(stored), updatedAt: stored.updatedAt };
}
