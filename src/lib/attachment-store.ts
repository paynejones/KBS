import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import {
  FILE_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentUrl,
} from "@/lib/media";

function attachmentsDirectory() {
  return process.env.ATTACHMENTS_DIR || path.join(process.cwd(), "data", "attachments");
}

function attachmentPath(id: string) {
  return path.join(attachmentsDirectory(), id);
}

function sanitizeFilename(filename: string) {
  const base = filename.replace(/[/\\]/g, "").trim() || "upload";
  return base.slice(0, 255);
}

export async function storeAttachment(file: File, allowed: readonly string[] = FILE_MIME_TYPES) {
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return { error: `File must be between 1 byte and ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`, status: 400 as const };
  }
  const mimeType = file.type;
  if (!allowed.includes(mimeType)) {
    return { error: "That file type is not supported.", status: 400 as const };
  }

  const filename = sanitizeFilename(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const [row] = await db.insert(attachments).values({
    filename,
    mimeType,
    size: bytes.byteLength,
  }).returning();

  try {
    await mkdir(attachmentsDirectory(), { recursive: true });
    await writeFile(attachmentPath(row.id), bytes);
  } catch (error) {
    await db.delete(attachments).where(eq(attachments.id, row.id));
    throw error;
  }

  return {
    attachment: {
      id: row.id,
      url: attachmentUrl(row.id),
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
    },
  };
}

export async function readStoredAttachment(id: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row) return null;
  try {
    const bytes = await readFile(attachmentPath(id));
    return { ...row, bytes };
  } catch {
    return null;
  }
}

export async function missingAttachmentIds(ids: string[]) {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return [];
  const found = await db.select({ id: attachments.id }).from(attachments).where(inArray(attachments.id, unique));
  const present = new Set(found.map((row) => row.id));
  return unique.filter((id) => !present.has(id));
}

export { IMAGE_MIME_TYPES };
