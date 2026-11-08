import { markdownFileToPage } from "@/lib/markdown-import";
import { LINKED_FILE_MIME_TYPES, uploadAttachment } from "@/lib/media";

export const MAX_MARKDOWN_FILE_BYTES = 2_000_000;
const MAX_TITLE_LENGTH = 200;

export type MarkdownImportFailure = { name: string; reason: string };
export type MarkdownImportResult = { imported: number; failures: MarkdownImportFailure[] };

type ContentNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  marks?: ContentNode[];
  content?: ContentNode[];
};
type PageDraft = ReturnType<typeof markdownFileToPage>;

async function createPage(input: Record<string, unknown>): Promise<{ id: string }> {
  const response = await fetch("/api/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Server could not create page");
  return await response.json();
}

function normalizePath(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function isMarkdownNote(file: File) {
  return /\.(md|markdown)$/i.test(file.name);
}

function isImportableAsset(file: File) {
  // Markdown files are pages, never attachments, even though they are text.
  return !isMarkdownNote(file) && LINKED_FILE_MIME_TYPES.includes(file.type);
}

function collectAssets(files: File[], keyFor: (file: File) => string) {
  const assets = new Map<string, File>();
  for (const file of files) {
    if (isImportableAsset(file)) assets.set(normalizePath(keyFor(file)), file);
  }
  return assets;
}

function resolveAsset(src: string, noteDir: string, assets: Map<string, File>) {
  const clean = src.split(/[?#]/)[0];
  if (!clean || /^(?:[a-z]+:)?\/\//i.test(clean) || clean.startsWith("data:") || clean.startsWith("/api/attachments/")) {
    return { remote: true } as const;
  }
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Keep the original text when it is not valid percent-encoding.
  }
  const path = normalizePath(`${noteDir}/${decoded.replace(/^\//, "")}`);
  const direct = assets.get(path);
  if (direct) return { key: path, file: direct } as const;
  // A flat multi-file selection loses directories, so fall back to a unique name.
  const name = path.split("/").pop() ?? "";
  const matches = [...assets.entries()].filter(([key]) => key.split("/").pop() === name);
  return matches.length === 1
    ? { key: matches[0][0], file: matches[0][1] } as const
    : { missing: true } as const;
}

/**
 * Uploads local images a note embeds and files it links to, rewriting each
 * image src and link href to its stored attachment URL. Links whose target is
 * not part of the selection stay as written, since they may point at other
 * pages rather than files.
 */
async function attachPageMedia(
  page: PageDraft,
  noteDir: string,
  assets: Map<string, File>,
  uploaded: Map<string, string>,
  noteName: string,
  failures: MarkdownImportFailure[],
) {
  async function store(src: string, kind: "image" | "file") {
    const resolved = resolveAsset(src, noteDir, assets);
    if ("remote" in resolved) return null;
    if ("missing" in resolved) {
      if (kind === "image") failures.push({ name: noteName, reason: `image not found: ${src}` });
      return null;
    }
    const cached = uploaded.get(resolved.key);
    if (cached) return cached;
    try {
      const url = (await uploadAttachment(resolved.file)).url;
      uploaded.set(resolved.key, url);
      return url;
    } catch {
      failures.push({ name: noteName, reason: `${kind} upload failed: ${src}` });
      return null;
    }
  }

  async function walk(nodes: ContentNode[]) {
    for (const node of nodes) {
      if (node.type === "imageEmbed" && typeof node.attrs?.src === "string") {
        const url = await store(node.attrs.src, "image");
        if (url) node.attrs = { ...node.attrs, src: url };
      }
      for (const mark of node.marks ?? []) {
        if (mark.type !== "link" || typeof mark.attrs?.href !== "string") continue;
        const url = await store(mark.attrs.href, "file");
        if (url) mark.attrs = { ...mark.attrs, href: url };
      }
      if (Array.isArray(node.content)) await walk(node.content);
    }
  }
  await walk((page.contentJson as ContentNode).content ?? []);
  return page;
}

/** Turns selected Markdown files into pages, uploading any images they embed. */
export async function importMarkdownFiles(files: File[]): Promise<MarkdownImportResult> {
  const failures: MarkdownImportFailure[] = [];
  const assets = collectAssets(files, (file) => file.name);
  const uploaded = new Map<string, string>();
  let imported = 0;

  for (const file of files) {
    if (isImportableAsset(file)) continue;
    if (!isMarkdownNote(file)) {
      failures.push({ name: file.name, reason: "unsupported file type" });
      continue;
    }
    if (file.size > MAX_MARKDOWN_FILE_BYTES) {
      failures.push({ name: file.name, reason: "file exceeds the 2 MB limit" });
      continue;
    }
    try {
      const draft = markdownFileToPage(await file.text(), file.name);
      await attachPageMedia(draft, "", assets, uploaded, file.name, failures);
      await createPage(draft);
      imported += 1;
    } catch {
      failures.push({ name: file.name, reason: "import failed" });
    }
  }

  return { imported, failures };
}

/**
 * Imports a picked folder, recreating its directory tree: every folder that
 * holds a Markdown file becomes a page, and each note is created beneath it.
 * Browsers expose the relative path on `webkitRelativePath` for folder picks.
 */
export async function importMarkdownFolder(files: File[]): Promise<MarkdownImportResult> {
  const failures: MarkdownImportFailure[] = [];
  const assets = collectAssets(files, (file) => file.webkitRelativePath || file.name);
  const uploaded = new Map<string, string>();
  const notes: { file: File; segments: string[] }[] = [];

  for (const file of files) {
    if (isImportableAsset(file)) continue;
    const segments = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
    const name = segments[segments.length - 1] ?? file.name;
    if (!/\.(md|markdown)$/i.test(name)) {
      failures.push({ name, reason: "unsupported file type" });
      continue;
    }
    if (file.size > MAX_MARKDOWN_FILE_BYTES) {
      failures.push({ name, reason: "file exceeds the 2 MB limit" });
      continue;
    }
    notes.push({ file, segments });
  }

  // Only folders on the path to a note become pages, so empty branches stay out.
  const folders = new Map<string, { title: string; parent: string }>();
  for (const { segments } of notes) {
    for (let depth = 1; depth < segments.length; depth += 1) {
      const path = segments.slice(0, depth).join("/");
      if (folders.has(path)) continue;
      folders.set(path, {
        title: segments[depth - 1].trim().slice(0, MAX_TITLE_LENGTH) || "Untitled folder",
        parent: segments.slice(0, depth - 1).join("/"),
      });
    }
  }

  const folderIds = new Map<string, string>();
  const shallowFirst = [...folders.entries()]
    .sort((left, right) => left[0].split("/").length - right[0].split("/").length);
  for (const [path, folder] of shallowFirst) {
    const parentId = folder.parent ? folderIds.get(folder.parent) : null;
    if (folder.parent && !parentId) {
      failures.push({ name: folder.title, reason: "its parent folder was not created" });
      continue;
    }
    try {
      const page = await createPage({ title: folder.title, parentId });
      folderIds.set(path, page.id);
    } catch {
      failures.push({ name: folder.title, reason: "folder could not be created" });
    }
  }

  let imported = 0;
  for (const { file, segments } of notes) {
    const folderPath = segments.slice(0, -1).join("/");
    const parentId = folderPath ? folderIds.get(folderPath) : null;
    if (folderPath && !parentId) {
      failures.push({ name: file.name, reason: "its folder was not created" });
      continue;
    }
    try {
      const draft = markdownFileToPage(await file.text(), file.name);
      await attachPageMedia(draft, folderPath, assets, uploaded, file.name, failures);
      await createPage({ ...draft, parentId });
      imported += 1;
    } catch {
      failures.push({ name: file.name, reason: "import failed" });
    }
  }

  return { imported, failures };
}

/** One message for both import paths and both entry points. */
export function describeMarkdownImport(
  imported: number,
  total: number,
  failures: MarkdownImportFailure[],
) {
  if (failures.length === 0) return `Imported ${imported} ${imported === 1 ? "page" : "pages"}.`;
  const shown = failures.slice(0, 3).map((failure) => `${failure.name}: ${failure.reason}`).join("; ");
  return `Imported ${imported} of ${total} files. ${shown}${failures.length > 3 ? `; and ${failures.length - 3} more` : ""}`;
}
