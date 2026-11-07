import path from "node:path";

/**
 * Where uploaded attachment bytes live. Kept separate from the database client
 * so backup verification and pure tests can use it without a connection.
 */
export function attachmentsDirectory() {
  return process.env.ATTACHMENTS_DIR || path.join(process.cwd(), "data", "attachments");
}
