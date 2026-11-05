const ATTACHMENT_PATH = /^\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export const FILE_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  "application/pdf",
] as const;

export type FilePropertyValue = {
  attachmentId: string | null;
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
};

export function attachmentUrl(id: string) {
  return `/api/attachments/${id}`;
}

const ATTACHMENT_REFERENCE =
  /\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** Finds every stored attachment referenced anywhere in a page or record payload. */
export function attachmentIdsInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  for (const match of text.matchAll(ATTACHMENT_REFERENCE)) {
    ids.add(match[1].toLowerCase());
  }
  return Array.from(ids);
}

export function isAllowedMediaUrl(value: string) {
  if (ATTACHMENT_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isImageMimeType(mimeType: string) {
  return IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number]);
}

export function parseFilePropertyValue(value: unknown): FilePropertyValue | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  const attachmentId = record.attachmentId === null || record.attachmentId === undefined
    ? null
    : typeof record.attachmentId === "string" ? record.attachmentId : "";
  const alt = typeof record.alt === "string" ? record.alt : "";
  const filename = typeof record.filename === "string" ? record.filename : "";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";

  if (!url || !isAllowedMediaUrl(url)) return undefined;
  if (alt.length > 200 || filename.length > 255 || mimeType.length > 100) return undefined;
  if (attachmentId !== null) {
    const match = ATTACHMENT_PATH.exec(url);
    if (!match || match[1] !== attachmentId) return undefined;
  }

  return { attachmentId, url, alt, filename, mimeType };
}

export function fileValueSearchText(value: unknown) {
  const parsed = parseFilePropertyValue(value);
  if (parsed === undefined) return typeof value === "string" ? value : "";
  if (parsed === null) return "";
  return [parsed.filename, parsed.alt, parsed.url].filter(Boolean).join(" ");
}

export async function uploadAttachment(file: File) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/attachments", { method: "POST", body });
  const data: { id?: string; url?: string; filename?: string; mimeType?: string; size?: number; error?: string } =
    await response.json().catch(() => ({}));
  if (!response.ok || !data.id || !data.url) {
    throw new Error(data.error ?? "Could not upload the file.");
  }
  return {
    id: data.id,
    url: data.url,
    filename: data.filename ?? file.name,
    mimeType: data.mimeType ?? file.type,
    size: data.size ?? file.size,
  };
}

export function pickLocalFile(accept: string) {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}
