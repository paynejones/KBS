/**
 * Imports a Notion workspace into KBS.
 *
 * The importer walks everything shared with a Notion integration and writes
 * ordinary KBS rows: pages become pages (nested exactly as they are in Notion),
 * Notion databases become KBS databases with typed properties, their rows
 * become records that own a page, and images and files are downloaded into
 * ATTACHMENTS_DIR so the imported workspace does not depend on Notion's
 * one-hour S3 links.
 *
 * Setup
 * 1. Create an internal integration at https://www.notion.so/my-integrations.
 * 2. In Notion, share the pages or databases you want with that integration
 *    (••• → Connections → the integration). Every child page comes with them.
 * 3. Export NOTION_TOKEN in the shell or in .env, then:
 *
 *      npm run db:migrate
 *      npm run import:notion -- --dry-run     # report what would be imported
 *      npm run import:notion                  # write it
 *
 * Options
 *   --root <id-or-url>  Import one page, database or data source. Repeatable.
 *                       Defaults to NOTION_ROOT_IDS, then to every top-level
 *                       object shared with the integration.
 *   --merge             Add to a workspace that already has pages. Objects that
 *                       already exist keep their current content and parent.
 *   --dry-run           Fetch and convert everything, then report; writes no
 *                       rows and no files.
 *   --dump <file>       Also write the converted workspace to a JSON file for
 *                       review (independent of --dry-run).
 *   --verify            Fetch Notion and check that every page, database,
 *                       property, record, relation and file the import would
 *                       create is actually in KBS. Writes nothing and exits
 *                       non-zero when something is missing or a file differs.
 *   --retry-files       Re-download the Notion-hosted images and documents an
 *                       earlier run left as Notion links (a failed download, or
 *                       a type KBS did not store then). Only attachment ids
 *                       that are missing from KBS are fetched, and the pages
 *                       and records that still point at Notion are rewritten to
 *                       the stored file. Video and audio blocks are always
 *                       links and are not retried.
 *   --update            Refresh an existing import in place: pages whose body,
 *                       title, icon or cover changed in Notion, record titles
 *                       and property values, database names, and the structure
 *                       around them (page parents, inline links, relations,
 *                       property schemas and choices, and the inferred
 *                       views). Only rows Notion edited after their stored
 *                       timestamp are touched, and no page, record or database
 *                       is ever inserted.
 *   --prune-trashed     Remove the pages, records and databases Notion has
 *                       moved to its trash, using the ids stored in
 *                       `notion_objects`. Pages go to the KBS trash; record and
 *                       database rows are removed and recorded in a prune
 *                       manifest. Add --dry-run to preview. Needs a typed
 *                       confirmation unless --yes.
 *   --restore <manifest>  Put back exactly what a --prune-trashed run removed:
 *                       un-trashes its pages and re-inserts its databases,
 *                       properties, views, templates, records, relations and
 *                       Notion ids. Existing rows are kept. Add --dry-run to
 *                       preview.
 *   --manifest <file>   Where to write this run's manifest. Defaults to
 *                       data/import-manifests/notion-<timestamp>.json, or to
 *                       IMPORT_MANIFEST_DIR when that is set.
 *   --undo <manifest>   Delete exactly the rows and files a recorded run
 *                       created, then mark the manifest undone.
 *   --yes               Skip the typed confirmation for --undo.
 *   --force             Undo even when the manifest names another database.
 *   --help              Print the usage above.
 *
 * Environment
 *   NOTION_TOKEN        Required. Internal integration secret.
 *   NOTION_ROOT_IDS     Optional comma- or space-separated root ids.
 *   NOTION_API_BASE     Optional API base; used by the local test harness.
 *   DATABASE_URL        KBS PostgreSQL connection string (required to write,
 *                       to --verify, to --retry-files, or to --update).
 *   ATTACHMENTS_DIR     Where attachment bytes are stored; defaults to
 *                       data/attachments, the same directory the app reads.
 *   IMPORT_MANIFEST_DIR Where manifests are written when --manifest is not
 *                       given; defaults to data/import-manifests.
 *
 * Ids are derived deterministically from Notion ids, so a second run adds only
 * objects that are new instead of duplicating the workspace. Notion's API does
 * not expose database views, so each imported database gets a table view, plus
 * a board over a status-like select (Notion's `status` type, or a select named
 * Status/State/Stage/Phase/Priority) when that select has two or more choices.
 * Every other database keeps just the table rather than guessing a gallery or
 * calendar, and a linked database view is skipped with an explanation.
 * Rollups become KBS rollups when KBS computes the same calculation, and
 * formulas become KBS formulas when their expression translates; the rest keep
 * their computed Notion values in a number or text property. Buttons are
 * skipped: Notion's API returns the button but not the actions behind it, so
 * there is nothing to recreate them from. Video and audio blocks become links;
 * a Notion-hosted one is a signed URL that expires, and `--retry-files` never
 * sees those blocks. Rich-text and callout colours,
 * callout icons and a toggle's collapsed state have no KBS equivalent and are
 * dropped, and a date keeps only its day (its time and time zone are dropped).
 * Comments are available from Notion's API, but KBS has no comment model to
 * store them in, so they are not imported.
 *
 * Every run that writes also writes a manifest of the rows and files it created
 * (only the ones that were actually new) so the import can be undone exactly:
 * `npm run import:notion -- --undo <manifest>`.
 *
 * `--verify` repeats the conversion without writing and compares its counts
 * with KBS: how many of the pages, databases, properties, records, relations
 * and files it found are stored. It is the check to run after an import, and
 * it exits non-zero so a script can notice a partial or damaged import.
 *
 * `--retry-files` repeats the conversion too, but uses it to find the
 * Notion-hosted media that is still not stored. Attachment ids are derived from
 * where the media sits in Notion, so a file is downloaded again only when its
 * row or bytes are missing; the page content, covers and file properties that
 * still hold the old Notion URL are rewritten to the attachment URL.
 *
 * `--update` walks Notion and refreshes the rows an earlier run created. Notion
 * records when it last changed a page, and the import stored that timestamp, so
 * only rows Notion reports as edited since then are compared and rewritten;
 * newer work in KBS is left alone. A refreshed page also carries its parent and
 * inline links, a refreshed record carries its relation rows, and a refreshed
 * database carries its property schema, choices and inferred views. It never
 * inserts pages, records, databases or attachments, so a second run cannot
 * duplicate the workspace, and an object Notion has in its trash is reported
 * and left in KBS rather than silently kept or deleted. The Notion id of every
 * object a run wrote is stored in `notion_objects`, so `--update` can still name
 * one that disappeared from the walk (Notion omits trashed objects from search
 * results and from a parent's children).
 *
 * `--prune-trashed` is the explicit counterpart to that report: it asks Notion
 * about every object recorded in `notion_objects` and removes the ones Notion
 * says are trashed. Pages are soft-deleted, exactly as the KBS trash button
 * does, so they can be restored; records and databases have no trash of their
 * own, so their rows are deleted and the pages they own go to the trash.
 * Nothing Notion did not trash is touched, and `--update` keeps reporting.
 * Every removed row and trashed page is recorded in a prune manifest (default
 * `data/import-manifests/notion-prune-<timestamp>.json`), and `--restore
 * <manifest>` replays it: pages are un-trashed with their previous timestamps,
 * the captured rows are inserted again, and rows that already exist are left
 * alone. A page permanently deleted from the KBS trash cannot be un-trashed;
 * the restore reports it instead of failing.
 */

import "dotenv/config";

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import { attachmentsDirectory } from "@/lib/attachment-paths";
import { parseFormula } from "@/lib/database-formula";
import {
  MAX_PROPERTY_CHOICES,
  propertyChoices,
  type RollupAggregation,
} from "@/lib/database-property";
import {
  IMAGE_MIME_TYPES,
  LINKED_FILE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentUrl,
} from "@/lib/media";

// ---------------------------------------------------------------------------
// Notion API client
// ---------------------------------------------------------------------------

const NOTION_VERSION = "2025-09-03";
const DEFAULT_API_BASE = "https://api.notion.com/v1";
const REQUEST_INTERVAL_MS = 340; // Notion allows about 3 requests per second.
const MAX_ATTEMPTS = 6;
const PAGE_SIZE = 100;

type Json = Record<string, unknown>;

const EMPTY: Json = {};

function asRecord(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : EMPTY;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class NotionApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, pathname: string) {
    super(`Notion API ${status}${code ? ` (${code})` : ""} on ${pathname}: ${message}`);
    this.name = "NotionApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: Json;
  query?: Record<string, string>;
};

class NotionClient {
  private readonly token: string;
  private readonly apiBase: string;
  private nextSlotAt = 0;

  constructor(token: string, apiBase: string) {
    this.token = token;
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  /** Spaces requests so a large workspace stays inside Notion's rate limit. */
  private async waitForSlot() {
    const now = Date.now();
    const start = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = start + REQUEST_INTERVAL_MS;
    if (start > now) await sleep(start - now);
  }

  async request<T = Json>(pathname: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const query = options.query
      ? `?${new URLSearchParams(options.query).toString()}`
      : "";
    const url = `${this.apiBase}${pathname}${query}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.waitForSlot();

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Notion-Version": NOTION_VERSION,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch (error) {
        lastError = error;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(1000 * attempt);
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** (attempt - 1), 16_000);
        const payload = await response.json().catch(() => null);
        lastError = new NotionApiError(
          response.status,
          asString(asRecord(payload).code),
          asString(asRecord(payload).message) || response.statusText,
          pathname,
        );
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(delay);
        continue;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new NotionApiError(
          response.status,
          asString(asRecord(payload).code),
          asString(asRecord(payload).message) || response.statusText,
          pathname,
        );
      }
      return payload as T;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Notion API request failed: ${pathname}`);
  }

  /**
   * Yields every item of a paginated endpoint. `onPage` sees each raw response
   * so a data source query can notice Notion's 10,000-result cutoff.
   */
  async *paginate(
    pathname: string,
    options: RequestOptions = {},
    onPage?: (payload: Json) => void,
  ): AsyncGenerator<Json> {
    let cursor: string | null = null;

    for (;;) {
      const payload = await this.request(pathname, {
        ...options,
        ...(options.method === "POST"
          ? {
              body: {
                ...(options.body ?? {}),
                page_size: PAGE_SIZE,
                ...(cursor ? { start_cursor: cursor } : {}),
              },
            }
          : {
              query: {
                ...(options.query ?? {}),
                page_size: String(PAGE_SIZE),
                ...(cursor ? { start_cursor: cursor } : {}),
              },
            }),
      });

      onPage?.(payload);
      for (const item of asArray(payload.results)) yield asRecord(item);

      const next = asString(payload.next_cursor);
      if (!asBoolean(payload.has_more) || !next) return;
      cursor = next;
    }
  }
}

// ---------------------------------------------------------------------------
// Ids, text and document helpers
// ---------------------------------------------------------------------------

const UUID_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

/** A deterministic RFC 4122 v5 UUID, so repeated runs map to the same rows. */
function kbsId(kind: string, notionId: string): string {
  const digest = createHash("sha1")
    .update(UUID_NAMESPACE)
    .update(`kbs-notion-import:${kind}:${notionId.toLowerCase()}`, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function dashId(hex: string): string {
  const value = hex.toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(value)) return value;
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join("-");
}

function normalizeNotionId(input: string): string {
  const trimmed = input.trim();
  const fromUrl = notionIdFromUrl(trimmed);
  if (fromUrl) return fromUrl;
  const hex = trimmed.replace(/-/g, "");
  return /^[0-9a-f]{32}$/i.test(hex) ? dashId(hex) : trimmed.toLowerCase();
}

function notionIdFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/(^|\.)notion\.(so|site)$/i.test(url.hostname)) return null;
  const matches = [...url.pathname.matchAll(/([0-9a-f]{32})/gi)];
  const last = matches.at(-1)?.[1];
  return last ? dashId(last) : null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function plainTextFromRichText(items: unknown[]): string {
  return items.map((item) => asString(asRecord(item).plain_text)).join("");
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

type DocMark = { type: string; attrs?: Record<string, unknown> };

type DocNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: DocMark[];
  content?: DocNode[];
};

function paragraphNode(content: DocNode[] = []): DocNode {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function paragraphLink(text: string, href: string): DocNode {
  return {
    type: "paragraph",
    content: [{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }],
  };
}

function richTextHref(item: Json): string | null {
  const mention = asRecord(item.mention);
  const mentionType = asString(mention.type);

  if (mentionType === "page") {
    const id = asString(asRecord(mention.page).id);
    return id ? `notion://page/${id}` : null;
  }
  if (mentionType === "database") {
    const id = asString(asRecord(mention.database).id);
    return id ? `notion://database/${id}` : null;
  }
  if (mentionType === "link_preview") {
    return asString(asRecord(mention.link_preview).url) || null;
  }

  const direct = asString(item.href);
  if (direct) {
    const pageId = notionIdFromUrl(direct);
    if (pageId) return `notion://page/${pageId}`;
    return /^(https?:|mailto:)/i.test(direct) ? direct : null;
  }

  const linked = asString(asRecord(asRecord(item.text).link).url);
  if (linked) {
    const pageId = notionIdFromUrl(linked);
    if (pageId) return `notion://page/${pageId}`;
    return /^(https?:|mailto:)/i.test(linked) ? linked : null;
  }

  return null;
}

function richTextToNodes(items: unknown[]): DocNode[] {
  const nodes: DocNode[] = [];

  for (const rawItem of items) {
    const item = asRecord(rawItem);
    const annotations = asRecord(item.annotations);
    const marks: DocMark[] = [];
    if (asBoolean(annotations.bold)) marks.push({ type: "bold" });
    if (asBoolean(annotations.italic)) marks.push({ type: "italic" });
    if (asBoolean(annotations.strikethrough)) marks.push({ type: "strike" });
    if (asBoolean(annotations.underline)) marks.push({ type: "underline" });
    if (asBoolean(annotations.code)) marks.push({ type: "code" });
    const href = richTextHref(item);
    if (href) marks.push({ type: "link", attrs: { href } });

    const text = asString(item.plain_text);
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) nodes.push({ type: "hardBreak" });
      if (!line) return;
      nodes.push({
        type: "text",
        text: line,
        ...(marks.length > 0 ? { marks: marks.map((mark) => ({ ...mark })) } : {}),
      });
    });
  }

  return nodes;
}

function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "imageEmbed") return asString(node.attrs?.alt);
  return (node.content ?? []).map(nodeText).join("");
}

function blockText(node: DocNode): string {
  if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
    return (node.content ?? []).map(blockText).join("\n");
  }
  if (node.type === "listItem" || node.type === "taskItem") {
    return (node.content ?? []).map(blockText).join("\n");
  }
  if (node.type === "table") {
    return (node.content ?? [])
      .map((row) =>
        (row.content ?? [])
          .map((cell) => (cell.content ?? []).map(blockText).filter(Boolean).join(" "))
          .join(" | "),
      )
      .join("\n");
  }
  if (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock") {
    return nodeText(node);
  }
  return (node.content ?? []).map(blockText).filter(Boolean).join("\n");
}

/** Plain text for search, snippets and the markdown export fallback. */
function documentToPlainText(document: DocNode): string {
  return (document.content ?? [])
    .map((block) => blockText(block).trim())
    .filter(Boolean)
    .join("\n");
}

function emojiIcon(icon: unknown): string | null {
  const value = asRecord(icon);
  if (asString(value.type) !== "emoji") return null;
  const emoji = asString(value.emoji);
  return emoji ? truncate(emoji, 32) : null;
}

/** The Notion id of the object a page or database sits under. */
function notionParentId(payload: Json): string | null {
  const parent = asRecord(payload.parent);
  return (
    asString(parent.page_id)
    || asString(parent.database_id)
    || asString(parent.data_source_id)
    || null
  );
}

function pageTitle(page: Json): string {
  const properties = asRecord(page.properties);
  for (const value of Object.values(properties)) {
    const property = asRecord(value);
    if (asString(property.type) === "title") {
      return plainTextFromRichText(asArray(property.title));
    }
  }
  return plainTextFromRichText(asArray(page.title));
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/**
 * Notion rollup functions KBS computes the same way. Everything else
 * (count_values, show_unique, dates, checked, percentages, …) is snapshotted.
 */
const NOTION_ROLLUP_AGGREGATIONS: Record<string, RollupAggregation> = {
  count: "count",
  sum: "sum",
  average: "average",
  min: "min",
  max: "max",
};

/** The value Notion computed for a rollup, in a shape a KBS column can hold. */
function rollupSnapshotValue(rollup: Json): unknown {
  const resultType = asString(rollup.type);

  if (resultType === "number") {
    const number = asNumber(rollup.number);
    return number === null ? undefined : number;
  }

  if (resultType === "date") {
    const date = asRecord(rollup.date);
    return dateValue(date.start) ?? undefined;
  }

  if (resultType === "array") {
    const entries = asArray(rollup.array)
      .map((entry) => rollupEntryText(asRecord(entry)))
      .filter((entry) => entry !== "");
    return entries.length > 0 ? entries.join(", ") : undefined;
  }

  return undefined;
}

function rollupEntryText(entry: Json): string {
  switch (asString(entry.type)) {
    case "number": {
      const number = asNumber(entry.number);
      return number === null ? "" : String(number);
    }
    case "rich_text":
      return plainTextFromRichText(asArray(entry.rich_text));
    case "title":
      return plainTextFromRichText(asArray(entry.title));
    case "date": {
      const date = asRecord(entry.date);
      return dateValue(date.start) ?? "";
    }
    case "select":
      return asString(asRecord(entry.select).name);
    case "status":
      return asString(asRecord(entry.status).name);
    case "multi_select":
      return asArray(entry.multi_select)
        .map((option) => asString(asRecord(option).name))
        .filter(Boolean)
        .join(", ");
    case "people":
      return asArray(entry.people)
        .map((person) => asString(asRecord(person).name))
        .filter(Boolean)
        .join(", ");
    case "url":
    case "email":
    case "phone_number":
      return asString(entry[asString(entry.type)]);
    case "checkbox":
      return asBoolean(entry.checkbox) ? "Yes" : "No";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

/**
 * Notion writes arithmetic either infix or as a function call; KBS's formula
 * language has the same operators, so these map one to the other. A function
 * this translator does not map (if, concat, comparisons, dates, pow, mod, …)
 * makes the whole expression untranslatable rather than silently wrong, even
 * where KBS itself can now compute a value.
 */
const NOTION_FORMULA_OPERATORS: Record<string, "+" | "-" | "*" | "/"> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

const NOTION_FORMULA_DEPTH = 32;

type NotionExpressionToken =
  | { kind: "number"; text: string }
  | { kind: "reference"; name: string }
  | { kind: "name"; name: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma" };

type NotionExpressionParse =
  | { ok: true; expression: string }
  | { ok: false; reason: string };

type TokenizeResult =
  | { ok: true; tokens: NotionExpressionToken[] }
  | { ok: false; reason: string };

function tokenizeNotionFormula(text: string): TokenizeResult {
  const tokens: NotionExpressionToken[] = [];
  let index = 0;

  while (index < text.length) {
    const rest = text.slice(index);
    const character = text[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    // `prop("Name")` is the only way a Notion formula references a property.
    const doubleQuoted = /^prop\(\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(rest);
    const singleQuoted = doubleQuoted
      ? null
      : /^prop\(\s*'((?:[^'\\]|\\.)*)'\s*\)/.exec(rest);
    const reference = doubleQuoted ?? singleQuoted;
    if (reference) {
      tokens.push({ kind: "reference", name: reference[1].replace(/\\(.)/g, "$1") });
      index += reference[0].length;
      continue;
    }

    const number = /^\d*\.?\d+/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", text: number[0] });
      index += number[0].length;
      continue;
    }

    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ kind: "name", name: name[0] });
      index += name[0].length;
      continue;
    }

    if (character === "+" || character === "-" || character === "*" || character === "/") {
      tokens.push({ kind: "operator", value: character });
      index += 1;
      continue;
    }

    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", value: character });
      index += 1;
      continue;
    }

    if (character === ",") {
      tokens.push({ kind: "comma" });
      index += 1;
      continue;
    }

    return {
      ok: false,
      reason: `the expression uses “${character}”, which a KBS formula cannot express`,
    };
  }

  return { ok: true, tokens };
}

class NotionExpressionParser {
  private position = 0;
  private depth = 0;

  constructor(private readonly tokens: NotionExpressionToken[]) {}

  parse(): NotionExpressionParse {
    if (this.tokens.length === 0) {
      return { ok: false, reason: "the expression is empty" };
    }
    const expression = this.parseAdditive();
    if (!expression.ok) return expression;
    if (this.position < this.tokens.length) {
      return { ok: false, reason: "the expression has more than one value" };
    }
    return expression;
  }

  private peek(): NotionExpressionToken | undefined {
    return this.tokens[this.position];
  }

  private parseAdditive(): NotionExpressionParse {
    let left = this.parseMultiplicative();
    if (!left.ok) return left;

    while (true) {
      const token = this.peek();
      if (token?.kind !== "operator" || (token.value !== "+" && token.value !== "-")) break;
      this.position += 1;
      const right = this.parseMultiplicative();
      if (!right.ok) return right;
      left = { ok: true, expression: `(${left.expression} ${token.value} ${right.expression})` };
    }

    return left;
  }

  private parseMultiplicative(): NotionExpressionParse {
    let left = this.parseUnary();
    if (!left.ok) return left;

    while (true) {
      const token = this.peek();
      if (token?.kind !== "operator" || (token.value !== "*" && token.value !== "/")) break;
      this.position += 1;
      const right = this.parseUnary();
      if (!right.ok) return right;
      left = { ok: true, expression: `(${left.expression} ${token.value} ${right.expression})` };
    }

    return left;
  }

  private parseUnary(): NotionExpressionParse {
    const token = this.peek();
    if (token?.kind === "operator" && (token.value === "+" || token.value === "-")) {
      this.position += 1;
      const operand = this.parseUnary();
      if (!operand.ok) return operand;
      return {
        ok: true,
        expression: token.value === "-" ? `(-${operand.expression})` : operand.expression,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): NotionExpressionParse {
    const token = this.peek();
    if (!token) return { ok: false, reason: "the expression ends before a value" };

    if (token.kind === "number") {
      this.position += 1;
      return { ok: true, expression: token.text };
    }

    if (token.kind === "reference") {
      this.position += 1;
      return token.name
        ? { ok: true, expression: `{${token.name}}` }
        : { ok: false, reason: "the expression has an empty property reference" };
    }

    if (token.kind === "name") {
      this.position += 1;
      return this.parseCall(token.name);
    }

    if (token.kind === "paren" && token.value === "(") {
      this.position += 1;
      this.depth += 1;
      if (this.depth > NOTION_FORMULA_DEPTH) {
        this.depth -= 1;
        return { ok: false, reason: "the expression is nested too deeply" };
      }
      const inner = this.parseAdditive();
      this.depth -= 1;
      if (!inner.ok) return inner;
      const closing = this.peek();
      if (closing?.kind !== "paren" || closing.value !== ")") {
        return { ok: false, reason: "the expression has an unclosed parenthesis" };
      }
      this.position += 1;
      return { ok: true, expression: `(${inner.expression})` };
    }

    return { ok: false, reason: "the expression is missing a value" };
  }

  private parseCall(name: string): NotionExpressionParse {
    const operator = NOTION_FORMULA_OPERATORS[name];
    if (!operator && name !== "round" && name !== "unaryMinus") {
      return {
        ok: false,
        reason: `the expression uses “${name}()”, which a KBS formula cannot express`,
      };
    }

    const opening = this.peek();
    if (opening?.kind !== "paren" || opening.value !== "(") {
      return { ok: false, reason: `the expression uses “${name}” without parentheses` };
    }
    this.position += 1;

    const parsed = this.parseArguments();
    if (!parsed.ok) return parsed;
    const args = parsed.args;

    if (name === "round") {
      if (args.length < 1 || args.length > 2) {
        return { ok: false, reason: "round() needs a value and an optional number of digits" };
      }
      return { ok: true, expression: `round(${args.join(", ")})` };
    }

    if (name === "unaryMinus") {
      if (args.length !== 1) return { ok: false, reason: "unaryMinus() needs one value" };
      return { ok: true, expression: `(-${args[0]})` };
    }

    if (args.length !== 2) {
      return { ok: false, reason: `${name}() needs two values` };
    }
    return { ok: true, expression: `(${args[0]} ${operator} ${args[1]})` };
  }

  private parseArguments():
    | { ok: true; args: string[] }
    | { ok: false; reason: string } {
    this.depth += 1;
    if (this.depth > NOTION_FORMULA_DEPTH) {
      this.depth -= 1;
      return { ok: false, reason: "the expression is nested too deeply" };
    }

    try {
      const args: string[] = [];
      const empty = this.peek();
      if (empty?.kind === "paren" && empty.value === ")") {
        this.position += 1;
        return { ok: true, args };
      }

      for (;;) {
        const argument = this.parseAdditive();
        if (!argument.ok) return argument;
        args.push(argument.expression);

        const separator = this.peek();
        if (separator?.kind === "comma") {
          this.position += 1;
          continue;
        }
        if (separator?.kind !== "paren" || separator.value !== ")") {
          return { ok: false, reason: "the expression has an unclosed parenthesis" };
        }
        this.position += 1;
        return { ok: true, args };
      }
    } finally {
      this.depth -= 1;
    }
  }
}

/** Rewrites a Notion formula as KBS formula text, or says why it cannot be. */
function translateNotionFormula(text: string): NotionExpressionParse {
  const tokenized = tokenizeNotionFormula(text);
  if (!tokenized.ok) return tokenized;
  return new NotionExpressionParser(tokenized.tokens).parse();
}

/** The value Notion computed for a formula, in a shape a KBS column can hold. */
function formulaSnapshotValue(formula: Json): unknown {
  const resultType = asString(formula.type);

  if (resultType === "number") {
    const number = asNumber(formula.number);
    return number === null ? undefined : number;
  }

  if (resultType === "string") return asString(formula.string);

  if (resultType === "boolean") return asBoolean(formula.boolean) ? "Yes" : "No";

  if (resultType === "date") {
    const date = asRecord(formula.date);
    return dateValue(date.start) ?? undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Import model
// ---------------------------------------------------------------------------

type PageRow = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  icon: string | null;
  coverImageUrl: string | null;
  title: string;
  content: string;
  contentJson: DocNode;
  createdAt: Date;
  updatedAt: Date;
};

type DatabaseRow = {
  id: string;
  pageId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

type ImportedProperty = {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  options: Json;
  sortOrder: number;
  createdAt: Date;
  /** The Notion property type this row was derived from. */
  notionType: string;
};

type ViewRow = {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: Json;
  sortOrder: number;
  createdAt: Date;
};

type RecordRow = {
  id: string;
  databaseId: string;
  pageId: string;
  title: string;
  values: Json;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type RelationRow = {
  sourceRecordId: string;
  propertyId: string;
  targetRecordId: string;
};

type PageLinkRow = {
  sourcePageId: string;
  targetPageId: string;
  origin: "inline";
};

type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
};

/**
 * Notion's own id for a row an import wrote. The mapping is stored in KBS so a
 * later `--update` can ask Notion about an object that no longer appears in the
 * walk (a trashed page is missing from its parent's children and from search).
 * `parentNotionId` only decides whether the walk should have reached it, so an
 * object outside a `--root` import is not reported.
 */
type NotionObjectRow = {
  notionId: string;
  kind: "page" | "record" | "database";
  /** Deterministic id of the KBS row the run wrote. */
  kbsId: string;
  label: string;
  parentNotionId: string | null;
};

type ImportModel = {
  pages: PageRow[];
  databases: DatabaseRow[];
  properties: ImportedProperty[];
  views: ViewRow[];
  records: RecordRow[];
  relations: RelationRow[];
  pageLinks: PageLinkRow[];
  attachments: Map<string, AttachmentRow>;
  /** Notion objects this walk wrote, recorded so `--update` can find them again. */
  objects: NotionObjectRow[];
};

type ImportOptions = {
  roots: string[];
  merge: boolean;
  dryRun: boolean;
  verify: boolean;
  retryFiles: boolean;
  update: boolean;
  dumpPath: string | null;
  manifestPath: string | null;
  undoPath: string | null;
  yes: boolean;
  force: boolean;
};

type UndoOptions = {
  yes: boolean;
  dryRun: boolean;
  force: boolean;
};

type ManifestRelation = {
  sourceRecordId: string;
  propertyId: string;
  targetRecordId: string;
};

type ManifestPageLink = {
  sourcePageId: string;
  targetPageId: string;
};

/** Exactly the rows one run inserted, keyed by the table they live in. */
type ManifestRows = {
  pages: string[];
  databases: string[];
  databaseProperties: string[];
  databaseViews: string[];
  databaseRecords: string[];
  attachments: string[];
  databaseRecordRelations: ManifestRelation[];
  pageLinks: ManifestPageLink[];
  /** Pages whose parent this run linked, including pages that already existed. */
  parentLinks: string[];
};

type ManifestFile = {
  attachmentId: string;
  path: string;
  size: number;
};

/** Which mode wrote a manifest. Old manifests without it are imports. */
type ManifestRun = "import" | "update" | "retry-files";

/**
 * The Notion URL an attachment replaced. Undo restores it before deleting the
 * bytes, so a page that still exists never references a missing attachment.
 */
type ManifestAttachmentSource = {
  attachmentId: string;
  url: string;
  filename: string;
  mimeType: string;
};

type ImportManifest = {
  format: "kbs-import-manifest";
  version: 1;
  kind: "notion";
  run: ManifestRun;
  createdAt: string;
  database: string;
  roots: string[];
  rows: ManifestRows;
  files: ManifestFile[];
  attachmentSources: ManifestAttachmentSource[];
  totals: { rows: number; files: number; bytes: number };
  undoneAt?: string;
  removed?: Record<string, number>;
};

type MediaResult =
  | {
      kind: "stored";
      url: string;
      attachmentId: string;
      filename: string;
      mimeType: string;
      size: number;
    }
  | { kind: "external"; url: string; filename: string; mimeType: string };

type PendingRelationProperty = {
  propertyId: string;
  dataSourceId: string;
  databaseId: string;
};

type PendingRelationValue = {
  sourceRecordId: string;
  propertyId: string;
  targetNotionPageId: string;
};

type PendingRollupProperty = {
  /** KBS id of the rollup property being built. */
  propertyId: string;
  databaseId: string;
  relationNotionPropertyId: string;
  targetNotionPropertyId: string;
  notionFunction: string;
};

type PendingFormulaProperty = {
  /** KBS id of the formula property being built. */
  propertyId: string;
  databaseId: string;
  notionExpression: string;
};

/** Notion-hosted media that an import did not store as an attachment. */
type RetryFile = {
  /** Deterministic id derived from the media's location in Notion. */
  attachmentId: string;
  url: string;
  filename: string;
  declaredMime: string;
  purpose: "image" | "file";
};

/**
 * A Notion object the integration can still see in the trash. Its KBS row is
 * never deleted by `--update`; the run reports it so nothing is silently kept.
 */
type TrashedNotion = {
  kind: "page" | "record" | "database";
  /** Deterministic id of the KBS row an import would have written. */
  id: string;
  label: string;
};

type AttachmentReplacement = {
  attachmentId: string | null;
  url: string;
  filename: string;
  mimeType: string;
};

type PageContext = {
  pageId: string;
  nextSortOrder: () => number;
};

type Root =
  | { kind: "page"; id: string }
  | { kind: "database"; id: string }
  | { kind: "data_source"; id: string };

type PropertyLookup = {
  byNotionId: Map<string, ImportedProperty>;
  byName: Map<string, ImportedProperty>;
};

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

const IMAGE_MIME_SET = new Set<string>(IMAGE_MIME_TYPES);
const LINKED_FILE_MIME_SET = new Set<string>(LINKED_FILE_MIME_TYPES);
const MAX_WARNINGS = 500;

/**
 * Select names that exist to group records. A board over one is what a Notion
 * user almost always means by it, and it is the only view the import guesses.
 */
const BOARD_GROUP_NAMES = new Set(["status", "state", "stage", "phase", "priority"]);

/**
 * The MIME type KBS should store for a download. Servers often serve a correct
 * image as application/octet-stream or a bare "image"; the filename's
 * extension is a better guess when it agrees with an allowlisted type.
 */
function chooseMimeType(
  responseMime: string,
  declaredMime: string,
  purpose: "image" | "file",
): { mimeType: string; allowed: boolean } {
  const allowedMime = (mimeType: string) =>
    purpose === "image" ? IMAGE_MIME_SET.has(mimeType) : LINKED_FILE_MIME_SET.has(mimeType);
  const mimeType = allowedMime(responseMime)
    ? responseMime
    : declaredMime && allowedMime(declaredMime)
      ? declaredMime
      : responseMime || declaredMime;
  return { mimeType, allowed: allowedMime(mimeType) };
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/rtf": "rtf",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/x-7z-compressed": "7z",
  "application/epub+zip": "epub",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
};

const EXTENSION_MIME_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mimeType, extension]) => [extension, mimeType]),
);
EXTENSION_MIME_TYPES.jpg = "image/jpeg";
EXTENSION_MIME_TYPES.jpeg = "image/jpeg";

function mimeFromFilename(filename: string): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase();
  return extension ? EXTENSION_MIME_TYPES[extension] ?? "" : "";
}

function withExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{1,8}$/i.test(filename)) return filename;
  const extension = MIME_EXTENSIONS[mimeType];
  return extension ? `${filename}.${extension}` : filename;
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const decoded = decodeURIComponent(last).replace(/[/\\]/g, "").trim();
    return truncate(decoded || fallback, 255);
  } catch {
    return fallback;
  }
}

function safeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const LANGUAGE_ALIASES: Record<string, string> = {
  "plain text": "",
  "c++": "cpp",
  "c#": "csharp",
  "objective-c": "objectivec",
  "visual basic": "vbnet",
  shell: "bash",
  "shell script": "bash",
  markdown: "markdown",
  "jupyter notebook": "jupyter",
};

function languageForCodeBlock(language: string): string | null {
  const normalized = language.trim().toLowerCase();
  if (normalized in LANGUAGE_ALIASES) return LANGUAGE_ALIASES[normalized] || null;
  return normalized ? normalized.replace(/\s+/g, "-") : null;
}

class NotionImporter {
  private readonly client: NotionClient;
  private readonly options: ImportOptions;
  private readonly model: ImportModel = {
    pages: [],
    databases: [],
    properties: [],
    views: [],
    records: [],
    relations: [],
    pageLinks: [],
    attachments: new Map(),
    objects: [],
  };

  private readonly pageRowsById = new Map<string, PageRow>();
  private readonly pageIdByNotion = new Map<string, string>();
  private readonly pageTitleByNotion = new Map<string, string>();
  private readonly databaseIdsByNotion = new Map<string, string[]>();
  private readonly databaseIdByDataSource = new Map<string, string>();
  private readonly dataSourceByDatabase = new Map<string, string>();
  private readonly recordIdByNotion = new Map<string, string>();
  /** KBS database id → the Notion database the data source belongs to. */
  private readonly notionIdByKbsDatabase = new Map<string, string>();
  /** Index into `model.objects`, so one object is recorded once per walk. */
  private readonly notionObjectIndex = new Map<string, number>();
  private readonly blockChildren = new Map<string, Json[]>();
  private readonly fileUploadUrls = new Map<string, string>();
  private readonly writtenAttachments = new Set<string>();
  private readonly createdFiles = new Map<string, ManifestFile>();
  /** The Notion URL each stored attachment replaced, for a manifest. */
  private readonly attachmentSources = new Map<
    string,
    { url: string; filename: string; mimeType: string }
  >();
  private readonly retryFiles = new Map<string, RetryFile>();
  /** Notion objects found in the trash during this walk, by kind and id. */
  private readonly trashed = new Map<string, TrashedNotion>();
  /** Hosted video/audio kept as links; counted once in the run's warnings. */
  private readonly hostedMedia: { type: string; blockId: string }[] = [];
  /** Attachments an earlier run stored; an update reuses them instead of fetching. */
  private readonly knownAttachments = new Map<string, StoredAttachment>();
  private readonly pendingRelationProperties: PendingRelationProperty[] = [];
  private readonly pendingRelationValues: PendingRelationValue[] = [];
  private readonly pendingRollupProperties: PendingRollupProperty[] = [];
  private readonly pendingFormulaProperties: PendingFormulaProperty[] = [];
  /** `${databaseId}:${notionPropertyId}` → the property, including dropped ones. */
  private readonly propertyByNotion = new Map<string, ImportedProperty>();
  private rollupsMapped = 0;
  private rollupsSnapshotted = 0;
  private formulasMapped = 0;
  private formulasSnapshotted = 0;
  private buttonsSkipped = 0;
  private boardViews = 0;
  private readonly warnings: string[] = [];
  private nextDownloadAt = 0;
  private rootCount = 0;
  private rootNotionIds: string[] = [];

  constructor(client: NotionClient, options: ImportOptions) {
    this.client = client;
    this.options = options;
  }

  async run() {
    const startedAt = Date.now();
    if (this.options.update) await this.prepareUpdate();
    const roots = await this.discoverRoots();
    this.rootCount = roots.length;
    this.rootNotionIds = roots.map((root) => root.id);
    console.log(`Importing from ${roots.length} Notion root(s)…`);

    let nextRootOrder = 0;
    for (const root of roots) {
      if (root.kind === "page") {
        await this.importPage(root.id, null, nextRootOrder);
      } else if (root.kind === "database") {
        await this.importDatabase(root.id, null, nextRootOrder);
      } else {
        await this.importDataSource(root.id, "Imported database", null, nextRootOrder, null, null);
      }
      nextRootOrder += 1;
    }

    this.resolveRelations();
    this.resolveRollups();
    this.resolveFormulas();
    this.resolvePageLinks();
    this.mergeSelectChoices();
    this.createBoardViews();

    if (this.options.update) {
      await this.updateExistingRows();
      return;
    }

    if (this.options.retryFiles) {
      if (!(await this.retryMissingFiles())) process.exitCode = 1;
      return;
    }

    if (this.options.dumpPath) {
      await dumpImportModel(this.model, this.options.dumpPath, this.warnings);
    }
    this.printSummary(Date.now() - startedAt);

    if (this.options.verify) {
      if (!(await this.verifyAgainstKbs())) process.exitCode = 1;
      return;
    }

    if (!this.options.dryRun) {
      const manifestFile = await writeImportModel(this.model, this.options.merge, {
        roots: this.rootNotionIds,
        files: [...this.createdFiles.values()],
        manifestPath: this.options.manifestPath,
      });
      console.log(
        manifestFile
          ? `Import manifest: ${manifestFile}\nUndo this run with: npm run import:notion -- --undo "${manifestFile}"`
          : "Nothing new was written, so no manifest was needed.",
      );
    }
  }

  // -- Discovery ------------------------------------------------------------

  private async discoverRoots(): Promise<Root[]> {
    if (this.options.roots.length > 0) {
      const roots: Root[] = [];
      for (const id of this.options.roots) roots.push(await this.classifyRoot(id));
      return this.dedupeRoots(roots);
    }

    const pages: Json[] = [];
    const dataSources: Json[] = [];
    for await (const item of this.client.paginate("/search", {
      method: "POST",
      body: { sort: { direction: "descending", timestamp: "last_edited_time" } },
    })) {
      const object = asString(item.object);
      if (object === "page") pages.push(item);
      else if (object === "data_source") dataSources.push(item);
    }

    const sharedPageIds = new Set(pages.map((page) => asString(page.id)));
    const roots: Root[] = [];

    for (const page of pages) {
      if (asBoolean(page.in_trash)) {
        const id = asString(page.id);
        this.noteTrashed("page", kbsId("page", id), pageTitle(page) || id);
        continue;
      }
      const parent = asRecord(page.parent);
      const parentType = asString(parent.type);
      const parentPageId = asString(parent.page_id);
      if (parentType === "workspace") {
        roots.push({ kind: "page", id: asString(page.id) });
      } else if (parentType === "page_id" && !sharedPageIds.has(parentPageId)) {
        // A page shared on its own: its parent was not shared with us.
        roots.push({ kind: "page", id: asString(page.id) });
      }
    }

    const databaseIds = new Map<string, string>();
    for (const dataSource of dataSources) {
      const databaseId = asString(asRecord(dataSource.parent).database_id);
      if (databaseId) databaseIds.set(databaseId, asString(dataSource.id));
    }

    for (const databaseId of databaseIds.keys()) {
      let database: Json;
      try {
        database = await this.client.request(`/databases/${databaseId}`);
      } catch (error) {
        if (error instanceof NotionApiError && error.status === 404) continue;
        throw error;
      }
      if (asBoolean(database.in_trash)) {
        const dataSourceId = databaseIds.get(databaseId);
        if (dataSourceId) {
          this.noteTrashed(
            "database",
            kbsId("database", dataSourceId),
            plainTextFromRichText(asArray(database.title)) || databaseId,
          );
        }
        continue;
      }
      const parent = asRecord(database.parent);
      const parentType = asString(parent.type);
      if (parentType === "workspace") {
        roots.push({ kind: "database", id: databaseId });
      } else if (parentType === "page_id" && !sharedPageIds.has(asString(parent.page_id))) {
        roots.push({ kind: "database", id: databaseId });
      }
    }

    if (roots.length === 0) {
      throw new Error(
        "No top-level pages or databases are shared with this integration. Share a page in Notion (••• → Connections), or pass --root <page-or-database-id>.",
      );
    }

    return this.dedupeRoots(roots);
  }

  private dedupeRoots(roots: Root[]): Root[] {
    const seen = new Set<string>();
    const unique: Root[] = [];
    for (const root of roots) {
      const key = `${root.kind}:${root.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(root);
    }
    return unique;
  }

  private async classifyRoot(input: string): Promise<Root> {
    const id = normalizeNotionId(input);
    try {
      await this.client.request(`/pages/${id}`);
      return { kind: "page", id };
    } catch (error) {
      if (!(error instanceof NotionApiError) || error.status !== 404) throw error;
    }
    try {
      await this.client.request(`/databases/${id}`);
      return { kind: "database", id };
    } catch (error) {
      if (!(error instanceof NotionApiError) || error.status !== 404) throw error;
    }
    try {
      await this.client.request(`/data_sources/${id}`);
      return { kind: "data_source", id };
    } catch (error) {
      if (!(error instanceof NotionApiError) || error.status !== 404) throw error;
    }
    throw new Error(
      `Notion object ${id} was not found, or it is not shared with this integration.`,
    );
  }

  // -- Pages ----------------------------------------------------------------

  private async importPage(
    notionId: string,
    parentId: string | null,
    sortOrder: number,
    fallbackTitle = "",
  ): Promise<string | null> {
    const existing = this.pageIdByNotion.get(notionId);
    if (existing) return existing;

    let page: Json;
    try {
      page = await this.client.request(`/pages/${notionId}`);
    } catch (error) {
      if (error instanceof NotionApiError && error.status === 404) {
        this.warn(`page ${notionId}`, "Page is no longer available to the integration; skipped.");
        return null;
      }
      throw error;
    }

    if (asBoolean(page.in_trash)) {
      this.noteTrashed("page", kbsId("page", notionId), pageTitle(page) || notionId);
      this.warn(`page ${notionId}`, "Page is in the Notion trash; skipped.");
      return null;
    }

    const row = await this.storePage(page, notionId, parentId, sortOrder, fallbackTitle);
    this.noteNotionObject("page", notionId, row.id, row.title, notionParentId(page));
    return row.id;
  }

  private async storePage(
    notionPage: Json,
    notionId: string,
    parentId: string | null,
    sortOrder: number,
    fallbackTitle: string,
  ): Promise<PageRow> {
    const id = kbsId("page", notionId);
    const existing = this.pageRowsById.get(id);
    if (existing) return existing;

    const title = truncate(pageTitle(notionPage) || fallbackTitle || "Untitled", 200);
    const createdAt = parseTimestamp(notionPage.created_time) ?? new Date();
    const updatedAt = parseTimestamp(notionPage.last_edited_time) ?? createdAt;
    const row: PageRow = {
      id,
      parentId,
      sortOrder,
      icon: emojiIcon(notionPage.icon),
      coverImageUrl: null,
      title,
      content: "",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      createdAt,
      updatedAt,
    };

    this.pageRowsById.set(id, row);
    this.pageIdByNotion.set(notionId, id);
    this.pageTitleByNotion.set(notionId, title);
    this.model.pages.push(row);

    const cover = asRecord(notionPage.cover);
    if (asString(cover.type)) {
      const media = await this.storeMedia(cover, `cover:${notionId}`, "image");
      if (media) row.coverImageUrl = media.url;
    }

    let childOrder = 0;
    const context: PageContext = {
      pageId: id,
      nextSortOrder: () => childOrder++,
    };

    try {
      const blocks = await this.listChildren(notionId);
      const content = await this.convertBlocks(blocks, context);
      if (content.length > 0) row.contentJson = { type: "doc", content };
      row.content = documentToPlainText(row.contentJson).slice(0, 2_000_000);
    } catch (error) {
      this.warn(`page ${notionId}`, `Could not read the page body: ${messageOf(error)}`);
    }

    const count = this.model.pages.length;
    if (count % 25 === 0) {
      console.log(
        `  pages ${count}  databases ${this.model.databases.length}  records ${this.model.records.length}`,
      );
    }

    return row;
  }

  private async listChildren(blockId: string): Promise<Json[]> {
    const blocks: Json[] = [];
    for await (const block of this.client.paginate(`/blocks/${blockId}/children`)) {
      blocks.push(block);
    }
    return blocks;
  }

  private async childrenById(blockId: string): Promise<Json[]> {
    if (!blockId) return [];
    const cached = this.blockChildren.get(blockId);
    if (cached) return cached;
    const children = await this.listChildren(blockId);
    this.blockChildren.set(blockId, children);
    return children;
  }

  private async childrenOf(block: Json): Promise<Json[]> {
    return this.childrenById(asString(block.id));
  }

  // -- Block conversion -----------------------------------------------------

  private async convertBlocks(blocks: Json[], context: PageContext): Promise<DocNode[]> {
    const nodes: DocNode[] = [];
    let index = 0;

    // One unreadable block must not cost the rest of the page: a failed nested
    // fetch is reported and the importer carries on with the next block.
    while (index < blocks.length) {
      const block = blocks[index];
      const type = asString(block.type);

      if (type === "bulleted_list_item" || type === "numbered_list_item" || type === "to_do") {
        const group: Json[] = [];
        while (index < blocks.length && asString(blocks[index].type) === type) {
          group.push(blocks[index]);
          index += 1;
        }
        try {
          nodes.push(await this.convertList(type, group, context));
        } catch (error) {
          this.warn(
            `list at block ${asString(block.id)}`,
            `Could not read this list: ${messageOf(error)}`,
          );
        }
        continue;
      }

      try {
        nodes.push(...(await this.convertBlock(block, context)));
      } catch (error) {
        this.warn(
          `block ${asString(block.id)}`,
          `Could not convert this block: ${messageOf(error)}`,
        );
      }
      index += 1;
    }

    return nodes;
  }

  private async convertList(type: string, blocks: Json[], context: PageContext): Promise<DocNode> {
    const items: DocNode[] = [];

    for (const block of blocks) {
      const payload = asRecord(block[type]);
      const text = richTextToNodes(asArray(payload.rich_text));
      const nested =
        asBoolean(block.has_children) ? await this.convertBlocks(await this.childrenOf(block), context) : [];
      items.push({
        type: type === "to_do" ? "taskItem" : "listItem",
        ...(type === "to_do" ? { attrs: { checked: asBoolean(payload.checked) } } : {}),
        content: [paragraphNode(text), ...nested],
      });
    }

    return {
      type:
        type === "bulleted_list_item"
          ? "bulletList"
          : type === "numbered_list_item"
            ? "orderedList"
            : "taskList",
      content: items,
    };
  }

  private async convertBlock(block: Json, context: PageContext): Promise<DocNode[]> {
    const type = asString(block.type);
    const payload = asRecord(block[type]);
    const text = richTextToNodes(asArray(payload.rich_text));
    const nested =
      asBoolean(block.has_children)
      && type !== "child_page"
      && type !== "child_database"
      && type !== "synced_block"
        ? await this.childrenOf(block)
        : [];

    switch (type) {
      case "paragraph":
        return [paragraphNode(text), ...(await this.convertBlocks(nested, context))];

      case "heading_1":
      case "heading_2":
      case "heading_3":
      case "heading_4":
      case "heading_5":
      case "heading_6": {
        const level = Math.min(Number(type.slice("heading_".length)) || 1, 6);
        return [
          { type: "heading", attrs: { level }, content: text },
          ...(await this.convertBlocks(nested, context)),
        ];
      }

      case "callout":
        return [
          {
            type: "callout",
            content: [paragraphNode(text), ...(await this.convertBlocks(nested, context))],
          },
        ];

      case "toggle":
        return [
          {
            type: "toggleBlock",
            content: [paragraphNode(text), ...(await this.convertBlocks(nested, context))],
          },
        ];

      case "quote":
        return [
          {
            type: "blockquote",
            content: [paragraphNode(text), ...(await this.convertBlocks(nested, context))],
          },
        ];

      case "divider":
        return [{ type: "horizontalRule" }];

      case "code": {
        const code = plainTextFromRichText(asArray(payload.rich_text));
        const language = languageForCodeBlock(asString(payload.language));
        return [
          {
            type: "codeBlock",
            attrs: { language },
            ...(code ? { content: [{ type: "text", text: code }] } : {}),
          },
        ];
      }

      case "equation": {
        const expression = asString(payload.expression);
        return expression
          ? [paragraphNode([{ type: "text", text: `$$ ${expression} $$` }])]
          : [];
      }

      case "image":
        return this.convertImageBlock(block, payload);

      case "file":
      case "pdf":
        return this.convertFileBlock(block, payload);

      case "video":
      case "audio": {
        // `file_upload` media has no inline URL: it has to be resolved through
        // the same lookup images and file blocks use, or the block is dropped.
        const url = (await this.fileUrl(payload)) || this.blockMediaUrl(payload);
        if (!url) return [];
        const hosted =
          asString(payload.type) === "file" || asString(payload.type) === "file_upload";
        // Notion signs its own media URLs and expires them. These blocks never
        // go through storeMedia, so they are not downloaded and never enter the
        // retry list: the link is all KBS will ever have, and it will rot. One
        // warning per block would flood a media-heavy workspace, so the run
        // counts them and prints a single line.
        if (hosted) this.hostedMedia.push({ type, blockId: asString(block.id) });
        const caption = plainTextFromRichText(asArray(payload.caption)) || url;
        return [paragraphLink(caption, url)];
      }

      case "embed":
      case "bookmark":
      case "link_preview": {
        const url = this.blockMediaUrl(payload);
        if (!url) return [];
        const caption = plainTextFromRichText(asArray(payload.caption)) || url;
        return [paragraphLink(caption, url)];
      }

      case "table":
        return [await this.convertTable(block, payload)];

      case "table_row":
        // A table row is converted with its table; a stray one is skipped.
        return [];

      case "column_list":
      case "column":
        return this.convertBlocks(nested, context);

      case "synced_block": {
        // A synced block that is a copy has no children of its own; Notion
        // points at the original block, which is where they are read from.
        const sourceBlockId = asString(asRecord(payload.synced_from).block_id);
        const children = sourceBlockId
          ? await this.childrenById(sourceBlockId)
          : asBoolean(block.has_children)
            ? await this.childrenById(asString(block.id))
            : [];
        return this.convertBlocks(children, context);
      }

      case "child_page": {
        const notionId = asString(block.id);
        const title = asString(payload.title) || "Untitled";
        await this.importPage(notionId, context.pageId, context.nextSortOrder(), title);
        return [];
      }

      case "child_database": {
        const notionId = asString(block.id);
        const title = asString(payload.title) || "Untitled database";
        const ids = await this.importDatabase(
          notionId,
          context.pageId,
          context.nextSortOrder(),
          title,
        );
        return ids.length > 0 ? [{ type: "databaseEmbed", attrs: { databaseId: ids[0] } }] : [];
      }

      case "link_to_page": {
        const pageId = asString(payload.page_id);
        const databaseId = asString(payload.database_id);
        if (pageId) return [paragraphLink("Linked page", `notion://page/${pageId}`)];
        if (databaseId) return [paragraphLink("Linked database", `notion://database/${databaseId}`)];
        return [];
      }

      case "table_of_contents":
      case "breadcrumb":
      case "template":
      case "unsupported":
        return [];

      default: {
        // A block type this importer does not know still keeps its text.
        if (text.length > 0) {
          return [paragraphNode(text), ...(await this.convertBlocks(nested, context))];
        }
        return this.convertBlocks(nested, context);
      }
    }
  }

  private blockMediaUrl(payload: Json): string {
    const direct = asString(payload.url);
    if (direct) return direct;
    const external = asString(asRecord(payload.external).url);
    if (external) return external;
    return asString(asRecord(payload.file).url);
  }

  private async convertImageBlock(block: Json, payload: Json): Promise<DocNode[]> {
    // An image block's payload *is* the file object: its `type` is `file` or
    // `external`, and the URL sits in the matching nested object.
    const caption = plainTextFromRichText(asArray(payload.caption));
    const media = await this.storeMedia(payload, `image:${asString(block.id)}`, "image");
    if (!media) return [];

    if (media.kind === "stored" || IMAGE_MIME_SET.has(media.mimeType)) {
      return [
        {
          type: "imageEmbed",
          attrs: { src: media.url, alt: caption || media.filename },
        },
      ];
    }

    this.warn(
      `block ${asString(block.id)}`,
      "Image could not be stored as a file; kept as a link.",
    );
    return [paragraphLink(caption || media.filename, media.url)];
  }

  private async convertFileBlock(block: Json, payload: Json): Promise<DocNode[]> {
    const caption = plainTextFromRichText(asArray(payload.caption));
    const media = await this.storeMedia(payload, `file:${asString(block.id)}`, "file");
    if (!media) return [];
    return [paragraphLink(caption || media.filename, media.url)];
  }

  private async convertTable(block: Json, payload: Json): Promise<DocNode> {
    const rows = asBoolean(block.has_children) ? await this.childrenOf(block) : [];
    const hasColumnHeader = asBoolean(payload.has_column_header);
    const cellRows = rows.map((row) => {
      const cells = asArray(asRecord(row.table_row).cells);
      return cells.map((cell) => richTextToNodes(asArray(cell)));
    });
    const width = Math.max(
      Number(payload.table_width) || 0,
      ...cellRows.map((cells) => cells.length),
      1,
    );

    return {
      type: "table",
      content: cellRows.map((cells, rowIndex) => ({
        type: "tableRow",
        content: Array.from({ length: width }, (_, cellIndex) => ({
          type: rowIndex === 0 && hasColumnHeader ? "tableHeader" : "tableCell",
          content: [paragraphNode(cells[cellIndex] ?? [])],
        })),
      })),
    };
  }

  // -- Media ----------------------------------------------------------------

  private async fileUrl(file: Json): Promise<string> {
    const type = asString(file.type);
    if (type === "external") return asString(asRecord(file.external).url);
    if (type === "file") return asString(asRecord(file.file).url);
    if (type === "file_upload") {
      const id = asString(asRecord(file.file_upload).id);
      if (!id) return "";
      const cached = this.fileUploadUrls.get(id);
      if (cached) return cached;
      try {
        const upload = await this.client.request(`/file_uploads/${id}`);
        const url =
          asString(upload.upload_url) ||
          asString(asRecord(asRecord(upload.file).file).url) ||
          asString(asRecord(upload.file).url);
        if (url) this.fileUploadUrls.set(id, url);
        return url;
      } catch (error) {
        this.warn("file upload", `Could not read a Notion file upload: ${messageOf(error)}`);
        return "";
      }
    }
    return "";
  }

  private async download(
    url: string,
    filename: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    // Several hosts (Wikipedia, MyAnimeList) reject requests without a real
    // user agent and throttle bursts, so retry a few times and space requests.
    const headers = {
      "User-Agent": "KBS-Notion-Import/1.0 (personal workspace import)",
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,application/pdf,*/*;q=0.5",
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const now = Date.now();
      const wait = Math.max(0, this.nextDownloadAt - now);
      this.nextDownloadAt = Math.max(now, this.nextDownloadAt) + 80;
      if (wait > 0) await sleep(wait);

      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });

        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          // Never let one throttled thumbnail hold up the walk: a short pause
          // and one retry, then the image stays a link.
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 3000)
            : 700;
          await sleep(delay);
          continue;
        }

        if (!response.ok) {
          this.warn("download", `${filename}: the file server answered ${response.status}.`);
          return null;
        }

        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
          this.warn(
            "download",
            `${filename} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB; kept as a link.`,
          );
          return null;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
          this.warn(
            "download",
            `${filename} is empty or larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB; kept as a link.`,
          );
          return null;
        }
        const mimeType = (response.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        return { bytes, mimeType };
      } catch (error) {
        if (attempt === 2) {
          this.warn("download", `${filename}: ${messageOf(error)}`);
          return null;
        }
        await sleep(500);
      }
    }

    return null;
  }

  /**
   * Downloads a Notion file into ATTACHMENTS_DIR when KBS can store its type.
   * Anything else stays a link to the Notion URL, and the caller is warned that
   * Notion-hosted links expire after an hour.
   */
  private async storeMedia(
    file: Json,
    key: string,
    purpose: "image" | "file",
  ): Promise<MediaResult | null> {
    const url = await this.fileUrl(file);
    if (!url) return null;

    const filename = filenameFromUrl(url, purpose === "image" ? "image" : "file");
    const declaredMime = mimeFromFilename(filename);
    const attachmentId = kbsId("attachment", key);

    if (this.options.update) {
      // A stored attachment is already the same file; reuse it so an update
      // downloads nothing that the workspace already has.
      const known = this.knownAttachments.get(attachmentId);
      if (known) {
        return {
          kind: "stored",
          url: attachmentUrl(known.id),
          attachmentId: known.id,
          filename: known.filename,
          mimeType: known.mimeType,
          size: known.size,
        };
      }
    }

    if (this.options.retryFiles) {
      // A retry re-walks Notion to find the media the import could not store.
      // Whether anything has to be fetched is decided later, against the
      // deterministic attachment id, so this pass downloads nothing.
      const hosted = asString(file.type) === "file" || asString(file.type) === "file_upload";
      if (hosted && !this.retryFiles.has(attachmentId)) {
        this.retryFiles.set(attachmentId, {
          attachmentId,
          url,
          filename,
          declaredMime,
          purpose,
        });
      }
      return { kind: "external", url, filename, mimeType: declaredMime };
    }

    if (this.options.dryRun) {
      return { kind: "external", url, filename, mimeType: declaredMime };
    }

    const downloaded = await this.download(url, filename);
    const { mimeType, allowed } = chooseMimeType(
      downloaded?.mimeType ?? "",
      declaredMime,
      purpose,
    );

    if (!downloaded || !allowed) {
      if (downloaded && !allowed) {
        this.warn(
          "file",
          `${filename} (${mimeType || "unknown type"}) is not a file type KBS stores; kept as a link.`,
        );
      }
      return safeExternalUrl(url)
        ? { kind: "external", url, filename, mimeType }
        : null;
    }

    const storedFilename = withExtension(filename, mimeType);
    const attachment: AttachmentRow = {
      id: attachmentId,
      filename: truncate(storedFilename, 255),
      mimeType,
      size: downloaded.bytes.byteLength,
      createdAt: new Date(),
    };

    this.model.attachments.set(attachmentId, attachment);
    this.attachmentSources.set(attachmentId, {
      url,
      filename: attachment.filename,
      mimeType,
    });
    await this.writeAttachmentFile(attachmentId, downloaded.bytes);

    return {
      kind: "stored",
      url: attachmentUrl(attachmentId),
      attachmentId,
      filename: attachment.filename,
      mimeType,
      size: attachment.size,
    };
  }

  private async writeAttachmentFile(id: string, bytes: Buffer) {
    // Verification needs the file's size to compare with KBS, not the bytes.
    if (this.options.verify) return;
    if (this.writtenAttachments.has(id)) return;
    const directory = attachmentsDirectory();
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, id);
    // A file that is already on disk came from an earlier run, so this run must
    // not claim it: undo only removes what this run wrote itself.
    if (!(await fileExists(file))) {
      await writeFile(file, bytes);
      this.createdFiles.set(id, { attachmentId: id, path: file, size: bytes.byteLength });
    }
    this.writtenAttachments.add(id);
  }

  // -- Databases ------------------------------------------------------------

  private async importDatabase(
    databaseId: string,
    parentPageId: string | null,
    sortOrder: number,
    fallbackTitle = "",
  ): Promise<string[]> {
    const known = this.databaseIdsByNotion.get(databaseId);
    if (known) return known;

    let database: Json;
    try {
      database = await this.client.request(`/databases/${databaseId}`);
    } catch (error) {
      if (error instanceof NotionApiError && error.status === 404) {
        this.warn(`database ${databaseId}`, "Database is no longer available; skipped.");
        return [];
      }
      throw error;
    }

    const title =
      plainTextFromRichText(asArray(database.title)) || fallbackTitle || "Untitled database";
    if (asBoolean(database.in_trash)) {
      for (const rawSource of asArray(database.data_sources)) {
        const dataSourceId = asString(asRecord(rawSource).id);
        if (dataSourceId) this.noteTrashed("database", kbsId("database", dataSourceId), title);
      }
      this.warn(`database ${databaseId}`, "Database is in the Notion trash; skipped.");
      return [];
    }
    const icon = emojiIcon(database.icon);
    const notionParent = notionParentId(database);
    const sources = asArray(database.data_sources);
    if (sources.length === 0) {
      this.warn(
        `database ${databaseId}`,
        `Linked database view skipped: Notion exposes no data source for "${title}", so its columns and views cannot be imported. Its rows belong to the database it points at, which is imported on its own when it is shared with the integration.`,
      );
      return [];
    }

    const ids: string[] = [];
    let sibling = sortOrder;
    for (const [index, rawSource] of sources.entries()) {
      const source = asRecord(rawSource);
      const dataSourceId = asString(source.id);
      if (!dataSourceId) continue;
      const name =
        sources.length > 1
          ? `${title} — ${asString(source.name) || `Data source ${index + 1}`}`
          : title;
      const id = await this.importDataSource(
        dataSourceId,
        name,
        parentPageId,
        sibling,
        icon,
        notionParent,
      );
      if (id) {
        ids.push(id);
        sibling += 1;
      }
    }

    this.databaseIdsByNotion.set(databaseId, ids);
    return ids;
  }

  private async importDataSource(
    dataSourceId: string,
    name: string,
    parentPageId: string | null,
    sortOrder: number,
    icon: string | null,
    databaseParentId: string | null,
  ): Promise<string | null> {
    const known = this.databaseIdByDataSource.get(dataSourceId);
    if (known) return known;

    let dataSource: Json;
    try {
      dataSource = await this.client.request(`/data_sources/${dataSourceId}`);
    } catch (error) {
      if (error instanceof NotionApiError && error.status === 404) {
        this.warn(`data source ${dataSourceId}`, "Data source is no longer available; skipped.");
        return null;
      }
      throw error;
    }

    if (asBoolean(dataSource.in_trash)) {
      this.noteTrashed("database", kbsId("database", dataSourceId), name || "Untitled database");
      this.warn(`data source ${dataSourceId}`, "Data source is in the Notion trash; skipped.");
      return null;
    }

    const databaseId = kbsId("database", dataSourceId);
    // The data source is what the walk imports; the database is what Notion
    // reports as trashed, and it is the parent of every record page.
    const notionDatabaseId = asString(asRecord(dataSource.parent).database_id) || dataSourceId;
    this.notionIdByKbsDatabase.set(databaseId, notionDatabaseId);
    const pageId = kbsId("database-page", dataSourceId);
    const createdAt = parseTimestamp(dataSource.created_time) ?? new Date();
    const updatedAt = parseTimestamp(dataSource.last_edited_time) ?? createdAt;
    const title = truncate(name || "Untitled database", 200);

    this.databaseIdByDataSource.set(dataSourceId, databaseId);
    this.dataSourceByDatabase.set(databaseId, dataSourceId);
    this.model.pages.push({
      id: pageId,
      parentId: parentPageId,
      sortOrder,
      icon,
      coverImageUrl: null,
      title,
      content: "",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      createdAt,
      updatedAt,
    });
    this.model.databases.push({ id: databaseId, pageId, name: title, createdAt, updatedAt });
    this.noteNotionObject("database", notionDatabaseId, databaseId, title, databaseParentId);
    this.model.views.push({
      id: kbsId("view", dataSourceId),
      databaseId,
      name: "Table",
      type: "table",
      config: {},
      sortOrder: 0,
      createdAt,
    });

    const properties = this.importProperties(dataSourceId, databaseId, asRecord(dataSource.properties));

    let incomplete = false;
    const rows: Json[] = [];
    for await (const row of this.client.paginate(
      `/data_sources/${dataSourceId}/query`,
      { method: "POST" },
      (payload) => {
        if (asString(asRecord(payload.request_status).type) === "incomplete") incomplete = true;
      },
    )) {
      if (asString(row.object) !== "page") continue;
      rows.push(row);
    }
    if (incomplete) {
      this.warn(
        `database ${dataSourceId}`,
        "Notion capped this query at 10,000 rows, so some records were not imported.",
      );
    }

    for (const [index, row] of rows.entries()) {
      await this.importRecord(row, databaseId, pageId, index, properties);
    }

    return databaseId;
  }

  private importProperties(
    dataSourceId: string,
    databaseId: string,
    properties: Json,
  ): PropertyLookup {
    const lookup: PropertyLookup = { byNotionId: new Map(), byName: new Map() };
    const createdAt = new Date();
    let sortOrder = 0;

    for (const [name, rawProperty] of Object.entries(properties)) {
      const schema = asRecord(rawProperty);
      const notionType = asString(schema.type);
      if (notionType === "title") continue;

      // Notion returns a button property as `button: {}`: the API exposes the
      // button but never the actions behind it, and a button cell holds no
      // value to snapshot, so a KBS button cannot be built from what it sends.
      if (notionType === "button") {
        this.buttonsSkipped += 1;
        this.warn(
          `button "${name}"`,
          "Skipped: Notion's API does not expose a button's actions, so it cannot be recreated. Add a KBS button to this database with the actions you want.",
        );
        continue;
      }

      const mapped = this.mapPropertyType(schema, notionType);
      if (!mapped) {
        this.warn(
          `database "${name}"`,
          `Skipped the ${notionType || "unknown"} property: KBS has no equivalent.`,
        );
        continue;
      }

      const notionPropertyId = asString(schema.id) || name;
      const property: ImportedProperty = {
        id: kbsId("property", `${dataSourceId}:${notionPropertyId}`),
        databaseId,
        name: truncate(name, 120),
        type: mapped.type,
        options: mapped.options,
        sortOrder,
        createdAt,
        notionType,
      };
      sortOrder += 1;
      this.model.properties.push(property);

      if (notionType === "relation") {
        const relation = asRecord(schema.relation);
        this.pendingRelationProperties.push({
          propertyId: property.id,
          dataSourceId: asString(relation.data_source_id),
          databaseId: asString(relation.database_id),
        });
      }
      if (notionType === "rollup") {
        const rollup = asRecord(schema.rollup);
        this.pendingRollupProperties.push({
          propertyId: property.id,
          databaseId,
          relationNotionPropertyId: asString(rollup.relation_property_id),
          targetNotionPropertyId: asString(rollup.rollup_property_id),
          notionFunction: asString(rollup.function),
        });
      }
      if (notionType === "formula") {
        this.pendingFormulaProperties.push({
          propertyId: property.id,
          databaseId,
          notionExpression: asString(asRecord(schema.formula).expression),
        });
      }
      this.propertyByNotion.set(`${databaseId}:${notionPropertyId}`, property);
      lookup.byNotionId.set(notionPropertyId, property);
      lookup.byName.set(name, property);
    }

    return lookup;
  }

  private mapPropertyType(
    schema: Json,
    notionType: string,
  ): { type: string; options: Json } | null {
    switch (notionType) {
      case "rich_text":
        return { type: "text", options: {} };
      case "number":
        return { type: "number", options: {} };
      case "checkbox":
        return { type: "checkbox", options: {} };
      case "date":
      case "created_time":
      case "last_edited_time":
        return { type: "date", options: {} };
      case "url":
        return { type: "url", options: {} };
      case "email":
      case "phone_number":
      case "unique_id":
      case "people":
        return { type: "text", options: {} };
      case "files":
        return { type: "file", options: {} };
      case "formula":
        // Resolved once every property and record is known: it stays a formula
        // when the expression translates, and becomes a snapshot when it does not.
        return { type: "formula", options: {} };
      case "select": {
        const choices = this.choicesFromSchema(asArray(asRecord(schema.select).options));
        return { type: "select", options: { choices } };
      }
      case "status": {
        const status = asRecord(schema.status);
        const choices = this.choicesFromSchema([
          ...asArray(status.options),
          ...asArray(status.groups).flatMap((group) => asArray(asRecord(group).options)),
        ]);
        return { type: "select", options: { choices } };
      }
      case "multi_select":
        return {
          type: "multi_select",
          options: { choices: this.choicesFromSchema(asArray(asRecord(schema.multi_select).options)) },
        };
      case "relation":
        return { type: "relation", options: {} };
      case "rollup":
        // Resolved once every database, property and record is known; it falls
        // back to a number or text snapshot when KBS cannot compute it.
        return { type: "rollup", options: {} };
      default:
        return null;
    }
  }

  private choicesFromSchema(options: unknown[]): string[] {
    const choices: string[] = [];
    for (const rawOption of options) {
      const name = truncate(asString(asRecord(rawOption).name).trim(), 100);
      if (name && !choices.includes(name)) choices.push(name);
      if (choices.length >= MAX_PROPERTY_CHOICES) break;
    }
    return choices;
  }

  private async importRecord(
    rowPage: Json,
    databaseId: string,
    groupingPageId: string,
    sortOrder: number,
    properties: PropertyLookup,
  ) {
    const notionId = asString(rowPage.id);
    if (!notionId || this.recordIdByNotion.has(notionId)) return;
    if (asBoolean(rowPage.in_trash)) {
      this.noteTrashed("record", kbsId("record", notionId), pageTitle(rowPage) || notionId);
      return;
    }

    const recordId = kbsId("record", notionId);
    this.recordIdByNotion.set(notionId, recordId);
    const title = truncate(pageTitle(rowPage) || "Untitled", 200);
    const values: Json = {};

    for (const [name, rawValue] of Object.entries(asRecord(rowPage.properties))) {
      const value = asRecord(rawValue);
      const property =
        properties.byNotionId.get(asString(value.id)) ?? properties.byName.get(name);
      if (!property) continue;
      const converted = await this.propertyValue(property, value, notionId);
      if (converted !== undefined) values[property.id] = converted;
    }

    const page = await this.storePage(rowPage, notionId, groupingPageId, sortOrder, title);
    this.noteNotionObject(
      "record",
      notionId,
      recordId,
      title,
      this.notionIdByKbsDatabase.get(databaseId) ?? null,
    );

    this.model.records.push({
      id: recordId,
      databaseId,
      pageId: page.id,
      title,
      values,
      sortOrder,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    });
  }

  private async propertyValue(
    property: ImportedProperty,
    value: Json,
    notionPageId: string,
  ): Promise<unknown> {
    switch (property.notionType) {
      case "rich_text":
        return plainTextFromRichText(asArray(value.rich_text));

      case "number": {
        const number = asNumber(value.number);
        return number === null ? undefined : number;
      }

      case "checkbox":
        return asBoolean(value.checkbox);

      case "date": {
        const date = asRecord(value.date);
        return dateValue(date.start) ?? dateValue(date.end) ?? undefined;
      }

      case "created_time":
      case "last_edited_time":
        return dateValue(value[property.notionType]) ?? undefined;

      case "url":
      case "email":
      case "phone_number":
        return asString(value[property.notionType]) || undefined;

      case "unique_id": {
        const unique = asRecord(value.unique_id);
        const number = asNumber(unique.number);
        return number === null ? undefined : `${asString(unique.prefix)}${number}`.trim() || undefined;
      }

      case "people": {
        const names = asArray(value.people)
          .map((person) => asString(asRecord(person).name))
          .filter(Boolean);
        return names.length > 0 ? names.join(", ") : undefined;
      }

      case "select": {
        const name = truncate(asString(asRecord(value.select).name).trim(), 100);
        return name || undefined;
      }

      case "status": {
        const name = truncate(asString(asRecord(value.status).name).trim(), 100);
        return name || undefined;
      }

      case "multi_select":
        return asArray(value.multi_select)
          .map((option) => truncate(asString(asRecord(option).name).trim(), 100))
          .filter(Boolean);

      case "files": {
        const files = asArray(value.files);
        if (files.length > 1) {
          this.warn(
            `record ${notionPageId}`,
            `The ${property.name} property holds ${files.length} files; KBS keeps the first one.`,
          );
        }
        const file = asRecord(files[0]);
        if (!asString(file.type)) return undefined;
        const media = await this.storeMedia(
          file,
          `property:${notionPageId}:${property.id}`,
          "file",
        );
        if (!media) return undefined;
        return {
          attachmentId: media.kind === "stored" ? media.attachmentId : null,
          url: media.url,
          alt: "",
          filename: truncate(media.filename, 255),
          mimeType: truncate(media.mimeType || mimeFromFilename(media.filename), 100),
        };
      }

      case "formula":
        return formulaSnapshotValue(asRecord(value.formula));

      case "rollup":
        return rollupSnapshotValue(asRecord(value.rollup));

      case "relation": {
        for (const target of asArray(value.relation)) {
          const targetId = asString(asRecord(target).id);
          if (!targetId) continue;
          this.pendingRelationValues.push({
            sourceRecordId: kbsId("record", notionPageId),
            propertyId: property.id,
            targetNotionPageId: targetId,
          });
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }

  // -- Resolution passes ----------------------------------------------------

  private resolveRelations() {
    const droppedProperties = new Set<string>();
    const relatedDatabaseByProperty = new Map<string, string>();

    for (const pending of this.pendingRelationProperties) {
      const targetDatabaseId =
        (pending.dataSourceId && this.databaseIdByDataSource.get(pending.dataSourceId)) ||
        this.databaseIdsByNotion.get(pending.databaseId)?.[0];

      if (!targetDatabaseId) {
        droppedProperties.add(pending.propertyId);
        this.warn(
          "relation",
          "A relation points at a database that is not part of this import; the property was skipped.",
        );
        continue;
      }

      const property = this.model.properties.find((row) => row.id === pending.propertyId);
      if (property) property.options = { relatedDatabaseId: targetDatabaseId };
      relatedDatabaseByProperty.set(pending.propertyId, targetDatabaseId);
    }

    if (droppedProperties.size > 0) {
      this.model.properties = this.model.properties.filter(
        (property) => !droppedProperties.has(property.id),
      );
    }

    const databaseByRecord = new Map(
      this.model.records.map((record) => [record.id, record.databaseId]),
    );
    const seen = new Set<string>();

    for (const pending of this.pendingRelationValues) {
      const relatedDatabaseId = relatedDatabaseByProperty.get(pending.propertyId);
      if (!relatedDatabaseId) continue;
      const targetRecordId = this.recordIdByNotion.get(pending.targetNotionPageId);
      if (!targetRecordId) continue;
      if (databaseByRecord.get(targetRecordId) !== relatedDatabaseId) continue;

      const key = `${pending.sourceRecordId}:${pending.propertyId}:${targetRecordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.model.relations.push({
        sourceRecordId: pending.sourceRecordId,
        propertyId: pending.propertyId,
        targetRecordId,
      });
    }
  }

  /**
   * Turns Notion rollups into KBS rollups where KBS computes the same thing:
   * it counts linked records for `count` and aggregates a number property for
   * sum, average, min and max. Every other Notion function (count_values,
   * show_unique, dates, checked, percentages, …) has no KBS equivalent, so the
   * values Notion computed are kept as a number or text snapshot instead of
   * leaving an empty column.
   */
  private resolveRollups() {
    if (this.pendingRollupProperties.length === 0) return;
    const mapped = new Set<string>();

    for (const pending of this.pendingRollupProperties) {
      const property = this.model.properties.find((row) => row.id === pending.propertyId);
      if (!property) continue;

      const relation = this.propertyByNotion.get(
        `${pending.databaseId}:${pending.relationNotionPropertyId}`,
      );
      const relatedDatabaseId = asString(relation?.options.relatedDatabaseId);
      if (!relation || relation.type !== "relation" || !relatedDatabaseId) {
        this.snapshotRollup(property, pending, "its relation is not part of this import");
        continue;
      }

      const aggregation = NOTION_ROLLUP_AGGREGATIONS[pending.notionFunction];
      if (aggregation === "count") {
        property.options = {
          relatedDatabaseId,
          relationPropertyId: relation.id,
          aggregation,
        };
        mapped.add(property.id);
        this.rollupsMapped += 1;
        continue;
      }

      const target = this.propertyByNotion.get(
        `${relatedDatabaseId}:${pending.targetNotionPropertyId}`,
      );
      if (aggregation && target?.type === "number") {
        property.options = {
          relatedDatabaseId,
          relationPropertyId: relation.id,
          targetPropertyId: target.id,
          aggregation,
        };
        mapped.add(property.id);
        this.rollupsMapped += 1;
        continue;
      }

      this.snapshotRollup(
        property,
        pending,
        aggregation
          ? "the value it summarizes is not a number property"
          : `KBS has no "${pending.notionFunction || "unknown"}" calculation`,
      );
    }

    if (mapped.size === 0) return;
    // A computed rollup owns its value; keeping the Notion copy would make the
    // record look like it had a manual value behind the calculation.
    for (const record of this.model.records) {
      for (const propertyId of mapped) delete record.values[propertyId];
    }
  }

  /** Keeps a Notion-computed rollup as an ordinary number or text column. */
  private snapshotRollup(
    property: ImportedProperty,
    pending: PendingRollupProperty,
    reason: string,
  ) {
    const type = this.computedValuesAreNumeric(property, pending.databaseId)
      ? "number"
      : "text";
    this.snapshotComputedValues(property, pending.databaseId, type);

    this.rollupsSnapshotted += 1;
    this.warn(
      `rollup "${property.name}"`,
      `Snapshotted its computed values into a ${type} property because ${reason}.`,
    );
  }

  /** True when every value Notion computed for a property is a number or blank. */
  private computedValuesAreNumeric(property: ImportedProperty, databaseId: string): boolean {
    return this.model.records.every((record) => {
      if (record.databaseId !== databaseId) return true;
      const value = record.values[property.id];
      return value === undefined || typeof value === "number";
    });
  }

  /** Makes a property hold the values Notion computed, as a number or text column. */
  private snapshotComputedValues(
    property: ImportedProperty,
    databaseId: string,
    type: "number" | "text",
  ) {
    property.type = type;
    if (type === "number") return;
    for (const record of this.model.records) {
      if (record.databaseId !== databaseId) continue;
      const value = record.values[property.id];
      if (typeof value === "number") record.values[property.id] = String(value);
    }
  }

  /** Keeps a Notion-computed formula as an ordinary number or text column. */
  private snapshotFormula(
    property: ImportedProperty,
    databaseId: string,
    type: "number" | "text",
    reason: string,
  ) {
    this.snapshotComputedValues(property, databaseId, type);

    this.formulasSnapshotted += 1;
    this.warn(
      `formula "${property.name}"`,
      `Snapshotted its computed values into a ${type} property because ${reason}.`,
    );
  }

  /**
   * Notion does not expose a database's saved views, so the import cannot
   * recreate them. It does add the one view whose grouping can be inferred
   * safely: a board over a status-like select. Notion's `status` property (and
   * a select named Status/State/Stage/Phase/Priority) exists to group records,
   * and the app's own "add board" action groups by a select the same way. A
   * select with fewer than two real choices gets no board, because a single
   * "No value" column is not worth a tab; every other database stays on its
   * single table view instead of guessing a gallery or calendar.
   */
  private createBoardViews() {
    for (const database of this.model.databases) {
      const dataSourceId = this.dataSourceByDatabase.get(database.id);
      if (!dataSourceId) continue;

      const candidates = this.model.properties.filter(
        (property) =>
          property.databaseId === database.id
          && property.type === "select"
          && (property.notionType === "status"
            || BOARD_GROUP_NAMES.has(property.name.trim().toLowerCase())),
      );
      const grouped = candidates.find((property) => property.notionType === "status") ?? candidates[0];
      if (!grouped) continue;
      if (propertyChoices(grouped.options).length < 2) continue;

      this.model.views.push({
        id: kbsId("view-board", dataSourceId),
        databaseId: database.id,
        name: "Board",
        type: "board",
        config: { groupBy: grouped.id },
        sortOrder: 1,
        createdAt: database.createdAt,
      });
      this.boardViews += 1;
    }
  }

  /**
   * Turns Notion formulas into KBS formulas when the expression means the same
   * thing: both languages do arithmetic over number properties, so numbers,
   * `prop("…")` references, + - * /, parentheses and round() translate one to
   * one (Notion's operators may be written infix or as functions). Anything the
   * translator does not map — if(), concat(), comparisons, dates, strings,
   * pow(), mod(), … — keeps the values Notion computed in a number or text
   * property instead of leaving an empty column.
   */
  private resolveFormulas() {
    if (this.pendingFormulaProperties.length === 0) return;

    const propertiesByName = new Map<string, Map<string, ImportedProperty>>();
    for (const property of this.model.properties) {
      let byName = propertiesByName.get(property.databaseId);
      if (!byName) {
        byName = new Map();
        propertiesByName.set(property.databaseId, byName);
      }
      byName.set(property.name, property);
    }

    const formulas = this.pendingFormulaProperties.flatMap((pending) => {
      const property = this.model.properties.find((row) => row.id === pending.propertyId);
      if (!property) return [];
      return [{
        pending,
        property,
        byName: propertiesByName.get(pending.databaseId) ?? new Map<string, ImportedProperty>(),
      }];
    });
    if (formulas.length === 0) return;

    // A snapshot's type comes from the values Notion computed, before any of
    // them is moved, so it is known even for a formula still awaiting a verdict.
    const snapshotTypes = new Map<string, "number" | "text">();
    for (const { pending, property } of formulas) {
      snapshotTypes.set(
        property.id,
        this.computedValuesAreNumeric(property, pending.databaseId) ? "number" : "text",
      );
    }

    const translations = new Map<string, { expression: string; references: string[] }>();
    const reasons = new Map<string, string>();

    for (const { pending, property, byName } of formulas) {
      const translated = translateNotionFormula(pending.notionExpression);
      if (!translated.ok) {
        reasons.set(property.id, translated.reason);
        continue;
      }

      const parsed = parseFormula(translated.expression);
      if (!parsed.ok) {
        reasons.set(
          property.id,
          `its expression could not be written as a KBS formula (${parsed.error.replace(/\.$/, "")})`,
        );
        continue;
      }

      const missing = parsed.references.find((reference) => !byName.has(reference));
      if (missing) {
        reasons.set(property.id, `it references “${missing}”, which is not part of this import`);
        continue;
      }

      translations.set(property.id, { expression: translated.expression, references: parsed.references });
    }

    // A KBS formula may read numbers, rollups and formulas, so the decision
    // depends on which other formulas become formulas too. Mapping one only
    // makes more references usable, so this reaches a fixed point quickly.
    const mapped = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const { property, byName } of formulas) {
        if (mapped.has(property.id)) continue;
        const translation = translations.get(property.id);
        if (!translation) continue;
        const blocked = translation.references.some((reference) => {
          const referenced = byName.get(reference);
          if (!referenced) return true;
          if (referenced.type === "number" || referenced.type === "rollup") return false;
          if (referenced.type !== "formula") return true;
          return !mapped.has(referenced.id) && snapshotTypes.get(referenced.id) !== "number";
        });
        if (blocked) continue;
        mapped.add(property.id);
        changed = true;
      }
    }

    // A computed formula owns its value; keeping the Notion copy would make the
    // record look like it had a manual value behind the calculation.
    for (const record of this.model.records) {
      for (const propertyId of mapped) delete record.values[propertyId];
    }

    for (const { pending, property, byName } of formulas) {
      const translation = translations.get(property.id);
      if (translation && mapped.has(property.id)) {
        property.type = "formula";
        property.options = { expression: translation.expression };
        this.formulasMapped += 1;
        continue;
      }

      const reason =
        reasons.get(property.id) ??
        (translation
          ? this.formulaReferenceBlocker(translation.references, byName, mapped, snapshotTypes)
          : "its expression is not a formula KBS can express");

      this.snapshotFormula(
        property,
        pending.databaseId,
        snapshotTypes.get(property.id) ?? "text",
        reason,
      );
    }
  }

  /** Explains which reference keeps an otherwise valid formula out of KBS. */
  private formulaReferenceBlocker(
    references: string[],
    byName: Map<string, ImportedProperty>,
    mapped: ReadonlySet<string>,
    snapshotTypes: ReadonlyMap<string, "number" | "text">,
  ): string {
    for (const reference of references) {
      const referenced = byName.get(reference);
      if (!referenced) return `it references “${reference}”, which is not part of this import`;
      if (referenced.type === "number" || referenced.type === "rollup") continue;
      if (referenced.type === "formula") {
        if (mapped.has(referenced.id) || snapshotTypes.get(referenced.id) === "number") continue;
        return `it uses the formula “${reference}”, whose computed values are kept as text`;
      }
      return `it uses “${reference}”, which is not a number, rollup or formula property`;
    }
    return "its expression is not a formula KBS can express";
  }

  private resolvePageLinks() {
    const seen = new Set<string>();

    for (const page of this.model.pages) {
      this.resolveLinksInDocument(page.contentJson, (href, text) => {
        if (href.startsWith("notion://page/")) {
          const notionId = href.slice("notion://page/".length);
          const targetPageId = this.pageIdByNotion.get(notionId);
          if (!targetPageId) return { href: null };
          const key = `${page.id}:${targetPageId}`;
          if (seen.has(key)) return { href: `/pages/${targetPageId}` };
          if (targetPageId !== page.id) {
            seen.add(key);
            this.model.pageLinks.push({
              sourcePageId: page.id,
              targetPageId,
              origin: "inline",
            });
          }
          const title = this.pageTitleByNotion.get(notionId);
          return {
            href: `/pages/${targetPageId}`,
            ...(text === "Linked page" && title ? { text: title } : {}),
          };
        }

        if (href.startsWith("notion://database/")) {
          const notionId = href.slice("notion://database/".length);
          const databaseId = this.databaseIdsByNotion.get(notionId)?.[0];
          if (!databaseId) return { href: null };
          return { href: `/databases/${databaseId}` };
        }

        const notionPageId = notionIdFromUrl(href);
        if (notionPageId) {
          const targetPageId = this.pageIdByNotion.get(notionPageId);
          if (!targetPageId) return { href: null };
          const key = `${page.id}:${targetPageId}`;
          if (!seen.has(key) && targetPageId !== page.id) {
            seen.add(key);
            this.model.pageLinks.push({
              sourcePageId: page.id,
              targetPageId,
              origin: "inline",
            });
          }
          return { href: `/pages/${targetPageId}` };
        }

        return { href };
      });
    }
  }

  private resolveLinksInDocument(
    document: DocNode,
    resolve: (href: string, text: string) => { href: string | null; text?: string },
  ) {
    const visit = (node: DocNode) => {
      if (node.marks && node.marks.length > 0) {
        const next: DocMark[] = [];
        for (const mark of node.marks) {
          if (mark.type !== "link") {
            next.push(mark);
            continue;
          }
          const href = asString(mark.attrs?.href);
          const resolved = resolve(href, node.text ?? "");
          if (!resolved.href) continue;
          if (resolved.text !== undefined) node.text = resolved.text;
          next.push({ type: "link", attrs: { ...(mark.attrs ?? {}), href: resolved.href } });
        }
        if (next.length > 0) node.marks = next;
        else delete node.marks;
      }
      for (const child of node.content ?? []) visit(child);
    };
    visit(document);
  }

  /** Select and multi-select need every value their records use as a choice. */
  private mergeSelectChoices() {
    for (const property of this.model.properties) {
      if (property.type !== "select" && property.type !== "multi_select") continue;
      const choices = new Set(propertyChoices(property.options));
      for (const record of this.model.records) {
        if (record.databaseId !== property.databaseId) continue;
        const value = record.values[property.id];
        if (typeof value === "string" && value.trim()) choices.add(value.trim());
        else if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === "string" && entry.trim()) choices.add(entry.trim());
          }
        }
      }
      property.options = {
        ...property.options,
        choices: [...choices].slice(0, MAX_PROPERTY_CHOICES),
      };
      if (choices.size > MAX_PROPERTY_CHOICES) {
        this.warn(
          `property "${property.name}"`,
          `Has ${choices.size} values; KBS stores the first ${MAX_PROPERTY_CHOICES} as choices.`,
        );
      }
    }
  }

  // -- Update ---------------------------------------------------------------

  /**
   * Loads the attachments an earlier run stored so the walk reuses them instead
   * of downloading every file again. A row whose bytes are gone is left out, so
   * the page is refreshed with a working file rather than a broken reference.
   */
  private async prepareUpdate() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to update an import.");

    const client = new Client({ connectionString, application_name: "kbs-notion-update" });
    await client.connect();

    try {
      const result = await client.query<{
        id: string;
        filename: string;
        mime_type: string;
        size: number;
      }>(`SELECT id, filename, mime_type, size FROM attachments`);
      const directory = attachmentsDirectory();

      for (const row of result.rows) {
        const info = await stat(path.join(directory, row.id)).catch(() => null);
        if (!info) continue;
        this.knownAttachments.set(row.id, {
          id: row.id,
          filename: row.filename,
          mimeType: row.mime_type,
          size: row.size,
        });
      }
    } finally {
      await client.end();
    }
  }

  /**
   * Refreshes the rows an earlier import created. Notion's last-edited time is
   * compared with the stored one, so only pages and records Notion changed
   * after the import are rewritten and newer work in KBS is left alone. Rows
   * are updated by their deterministic id and never inserted, so an update
   * cannot duplicate a page or a record.
   */
  private async updateExistingRows() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to update an import.");

    const client = new Client({ connectionString, application_name: "kbs-notion-update" });
    await client.connect();

    try {
      // Media the walk downloaded for changed content, with the same
      // deterministic ids the import would have used.
      const addedAttachments: string[] = [];
      for (const batch of batches([...this.model.attachments.values()], 400)) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO attachments (id, filename, mime_type, size)
           SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::int[])
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            batch.map((attachment) => attachment.id),
            batch.map((attachment) => attachment.filename),
            batch.map((attachment) => attachment.mimeType),
            batch.map((attachment) => attachment.size),
          ],
        );
        addedAttachments.push(...inserted.rows.map((row) => row.id));
      }

      // What this run adds is recorded so a later --undo can remove it. Content
      // changes and parent moves are not additions; they have no row to delete.
      const additions = emptyRows();
      const databaseByPageId = new Map(
        this.model.databases.map((database) => [database.pageId, database]),
      );
      const changes: string[] = [];
      const newer: string[] = [];
      const refreshedDatabases = new Set<string>();
      const relationPropertyIds = new Map<string, string[]>();
      for (const property of this.model.properties) {
        if (property.type !== "relation") continue;
        const ids = relationPropertyIds.get(property.databaseId) ?? [];
        ids.push(property.id);
        relationPropertyIds.set(property.databaseId, ids);
      }
      let pagesUpdated = 0;
      let recordsUpdated = 0;
      let databasesRenamed = 0;
      let parentsUpdated = 0;
      let relationsChanged = 0;
      let pageLinksChanged = 0;
      let propertiesChanged = 0;
      let viewsChanged = 0;
      let missingPages = 0;
      let missingRecords = 0;
      let pagesNewer = 0;
      let recordsNewer = 0;

      for (const batch of batches(this.model.pages, 500)) {
        const result = await client.query<{
          id: string;
          title: string;
          icon: string | null;
          cover_image_url: string | null;
          content_json: Json;
          parent_id: string | null;
          updated_at: Date;
        }>(
          `SELECT id, title, icon, cover_image_url, content_json, parent_id, updated_at
           FROM pages WHERE id = ANY($1::uuid[])`,
          [batch.map((page) => page.id)],
        );
        const existing = new Map(result.rows.map((row) => [row.id, row]));

        for (const page of batch) {
          const row = existing.get(page.id);
          if (!row) {
            missingPages += 1;
            continue;
          }
          // The import stored Notion's last-edited time on the row. When KBS is
          // newer, the page was edited here after the import: keep it and name
          // it in the report so a page that may now be stale is never silent.
          if (page.updatedAt.getTime() < row.updated_at.getTime()) {
            pagesNewer += 1;
            newer.push(
              `page "${row.title}": KBS ${row.updated_at.toISOString()}, Notion ${page.updatedAt.toISOString()}`,
            );
            continue;
          }
          if (page.updatedAt.getTime() === row.updated_at.getTime()) continue;

          const contentChanged =
            row.title !== page.title
            || row.icon !== page.icon
            || row.cover_image_url !== page.coverImageUrl
            || !sameJson(row.content_json, page.contentJson);

          if (contentChanged) {
            await client.query(
              `UPDATE pages
               SET title = $2, icon = $3, cover_image_url = $4, content = $5,
                   content_json = $6::jsonb, updated_at = $7
               WHERE id = $1`,
              [
                page.id,
                page.title,
                page.icon,
                page.coverImageUrl,
                page.content,
                JSON.stringify(page.contentJson),
                page.updatedAt,
              ],
            );
            pagesUpdated += 1;
            changes.push(`page "${page.title}"`);

            // A database's name lives on its grouping page, so it is refreshed
            // by the same Notion timestamp that refreshed that page.
            const database = databaseByPageId.get(page.id);
            if (database) {
              const renamed = await client.query(
                `UPDATE databases SET name = $2 WHERE id = $1 AND name <> $2`,
                [database.id, database.name],
              );
              if ((renamed.rowCount ?? 0) > 0) {
                databasesRenamed += 1;
                changes.push(`database "${database.name}"`);
              }
            }
          }

          // Structure follows the same gate: a page Notion did not report as
          // edited keeps its parent and links, even when the walk would move
          // or unlink it.
          const structure = await this.syncPageStructure(client, page, row.parent_id);
          if (structure.parent) {
            parentsUpdated += 1;
            changes.push(`parent of page "${page.title}"`);
          }
          if (structure.links > 0) {
            pageLinksChanged += structure.links;
            if (!contentChanged) changes.push(`links in page "${page.title}"`);
          }
          additions.pageLinks.push(...structure.addedLinks);

          const refreshedDatabase = databaseByPageId.get(page.id);
          if (refreshedDatabase) refreshedDatabases.add(refreshedDatabase.id);
        }
      }

      for (const batch of batches(this.model.records, 500)) {
        const result = await client.query<{
          id: string;
          title: string;
          values: Json;
          updated_at: Date;
        }>(
          `SELECT id, title, values, updated_at
           FROM database_records WHERE id = ANY($1::uuid[])`,
          [batch.map((record) => record.id)],
        );
        const existing = new Map(result.rows.map((row) => [row.id, row]));

        for (const record of batch) {
          const row = existing.get(record.id);
          if (!row) {
            missingRecords += 1;
            continue;
          }
          if (record.updatedAt.getTime() < row.updated_at.getTime()) {
            recordsNewer += 1;
            newer.push(
              `record "${row.title}": KBS ${row.updated_at.toISOString()}, Notion ${record.updatedAt.toISOString()}`,
            );
            continue;
          }
          if (record.updatedAt.getTime() === row.updated_at.getTime()) continue;

          const contentChanged =
            row.title !== record.title || !sameJson(row.values, record.values);
          if (contentChanged) {
            await client.query(
              `UPDATE database_records
               SET title = $2, values = $3::jsonb, updated_at = $4
               WHERE id = $1`,
              [record.id, record.title, JSON.stringify(record.values), record.updatedAt],
            );
            recordsUpdated += 1;
            changes.push(`record "${record.title}"`);
          }

          const relations = await this.syncRecordRelations(
            client,
            record,
            relationPropertyIds.get(record.databaseId) ?? [],
          );
          if (relations.changed > 0) {
            relationsChanged += relations.changed;
            if (!contentChanged) changes.push(`relations of record "${record.title}"`);
          }
          additions.databaseRecordRelations.push(...relations.added);
        }
      }

      // Property schemas, choices and inferred views belong to the database's
      // grouping page, so they are refreshed with the same gate.
      for (const databaseId of refreshedDatabases) {
        const synced = await this.syncDatabaseStructure(client, databaseId);
        if (synced.properties > 0) {
          propertiesChanged += synced.properties;
          changes.push(`schema of database "${synced.name}"`);
        }
        if (synced.views > 0) {
          viewsChanged += synced.views;
          changes.push(`views of database "${synced.name}"`);
        }
        additions.databaseProperties.push(...synced.addedProperties);
        additions.databaseViews.push(...synced.addedViews);
      }

      additions.attachments = [
        ...new Set([...addedAttachments, ...this.createdFiles.keys()]),
      ];

      // Store the Notion ids this walk saw before looking for the objects it
      // did not, so a newly imported page is never mistaken for a missing one.
      await upsertNotionObjects(client, await this.storedNotionObjects(client));
      await this.reportTrashedOutsideWalk(client);
      const trashed = await this.findTrashedInKbs(client);
      const skipped = missingPages + missingRecords;
      const lines = [
        "",
        "Notion → KBS update",
        `  pages:              ${this.model.pages.length - missingPages} checked, ${pagesUpdated} updated`,
        `  records:            ${this.model.records.length - missingRecords} checked, ${recordsUpdated} updated`,
        `  databases:          ${this.model.databases.length} checked, ${databasesRenamed} renamed`,
        `  attachments:        ${additions.attachments.length} added`,
        `  not in KBS:         ${skipped} skipped${skipped > 0 ? ` (${missingPages} pages, ${missingRecords} records — run the import first)` : ""}`,
        `  newer in KBS:       ${pagesNewer} pages, ${recordsNewer} records kept their local edits`,
        `  structure:          ${parentsUpdated} parents, ${relationsChanged} relations, ${pageLinksChanged} page links, ${propertiesChanged} properties, ${viewsChanged} views`,
        ...(trashed.count > 0
          ? [
              `  trashed in Notion:   ${trashed.count} found, ${trashed.kept.length} still in KBS (kept)`,
            ]
          : []),
      ];

      if (newer.length > 0) {
        lines.push("", "Kept local edits (newer in KBS than Notion):");
        for (const entry of newer.slice(0, 10)) lines.push(`  - ${entry}`);
        if (newer.length > 10) lines.push(`  - … and ${newer.length - 10} more`);
      }

      if (trashed.kept.length > 0) {
        lines.push("", "Trashed in Notion but still in KBS (nothing was deleted):");
        for (const entry of trashed.kept.slice(0, 10)) {
          lines.push(`  - ${entry.kind} "${entry.label}"`);
        }
        if (trashed.kept.length > 10) {
          lines.push(`  - … and ${trashed.kept.length - 10} more`);
        }
      }

      if (changes.length > 0) {
        lines.push("", "Changed:");
        for (const change of changes.slice(0, 10)) lines.push(`  - ${change}`);
        if (changes.length > 10) lines.push(`  - … and ${changes.length - 10} more`);
      } else {
        lines.push(
          "",
          newer.length > 0
            ? "No changes applied: the rows marked newer in KBS were left as they are."
            : "No changes: KBS already matches Notion.",
        );
      }

      lines.push(...this.warningLines());
      console.log(lines.join("\n"));

      const attachmentSources: ManifestAttachmentSource[] = [];
      for (const attachmentId of additions.attachments) {
        const source = this.attachmentSources.get(attachmentId);
        if (source) attachmentSources.push({ attachmentId, ...source });
      }
      const manifestFile = await saveManifest({
        databaseName: await currentDatabaseName(client),
        roots: this.rootNotionIds,
        rows: additions,
        files: [...this.createdFiles.values()],
        attachmentSources,
        run: "update",
        destination: this.options.manifestPath,
      });
      console.log(
        manifestFile
          ? `Update manifest: ${manifestFile}\nUndo this run with: npm run import:notion -- --undo "${manifestFile}"`
          : "No rows or files were added, so there is nothing for --undo to remove.",
      );
    } finally {
      await client.end();
    }
  }

  /**
   * Brings a refreshed page's parent and inline links in line with Notion.
   * Called only for pages Notion reports as newer than their stored row, so a
   * move or unlink made in KBS is never overwritten by an older Notion tree.
   */
  private async syncPageStructure(
    client: Client,
    page: PageRow,
    storedParentId: string | null,
  ): Promise<{ parent: boolean; links: number; addedLinks: ManifestPageLink[] }> {
    let parent = false;
    const nextParent = page.parentId ?? null;
    if (nextParent !== (storedParentId ?? null)) {
      // The parent may be a page this run could not import (a partial import),
      // so it is only moved when it exists; the foreign key would refuse it
      // otherwise and abort the whole update.
      const moved = await client.query(
        `UPDATE pages AS target
         SET parent_id = $2
         WHERE target.id = $1
           AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM pages WHERE id = $2))`,
        [page.id, nextParent],
      );
      if ((moved.rowCount ?? 0) > 0) {
        parent = true;
      } else if (nextParent) {
        this.warn(
          `page "${page.title}"`,
          "Its new parent is not in KBS, so its parent was left as it was.",
        );
      }
    }

    const desired = this.model.pageLinks
      .filter((link) => link.sourcePageId === page.id)
      .map((link) => link.targetPageId);
    const stored = await client.query<{ target_page_id: string }>(
      `SELECT target_page_id FROM page_links WHERE source_page_id = $1 AND origin = 'inline'`,
      [page.id],
    );
    const before = new Set(stored.rows.map((row) => row.target_page_id));
    const after = new Set(desired);
    const removed = [...before].filter((id) => !after.has(id));
    const added = [...after].filter((id) => !before.has(id));

    let links = 0;
    let addedLinks: ManifestPageLink[] = [];
    if (removed.length > 0) {
      const deleted = await client.query(
        `DELETE FROM page_links
         WHERE source_page_id = $1 AND origin = 'inline' AND target_page_id = ANY($2::uuid[])`,
        [page.id, removed],
      );
      links += deleted.rowCount ?? 0;
    }
    if (added.length > 0) {
      // A link to a page that is not in KBS (a partial import, or a page
      // trashed since) is dropped instead of failing the foreign key.
      const inserted = await client.query<{ source_page_id: string; target_page_id: string }>(
        `INSERT INTO page_links (source_page_id, target_page_id, origin)
         SELECT $1, target.id, 'inline'
         FROM pages AS target
         WHERE target.id = ANY($2::uuid[])
         ON CONFLICT DO NOTHING
         RETURNING source_page_id, target_page_id`,
        [page.id, added],
      );
      links += inserted.rowCount ?? 0;
      addedLinks = inserted.rows.map((link) => ({
        sourcePageId: link.source_page_id,
        targetPageId: link.target_page_id,
      }));
    }

    return { parent, links, addedLinks };
  }

  /**
   * Replaces one refreshed record's relation rows for every relation property
   * of its database. Only the pairs that differ are written, and targets that
   * are not in KBS are skipped rather than failing the foreign key.
   */
  private async syncRecordRelations(
    client: Client,
    record: RecordRow,
    relationPropertyIds: string[],
  ): Promise<{ changed: number; added: ManifestRelation[] }> {
    if (relationPropertyIds.length === 0) return { changed: 0, added: [] };

    const relationProperties = new Set(relationPropertyIds);
    const wanted = new Map<string, Set<string>>();
    for (const relation of this.model.relations) {
      if (relation.sourceRecordId !== record.id) continue;
      if (!relationProperties.has(relation.propertyId)) continue;
      const targets = wanted.get(relation.propertyId) ?? new Set<string>();
      targets.add(relation.targetRecordId);
      wanted.set(relation.propertyId, targets);
    }

    const stored = await client.query<{ property_id: string; target_record_id: string }>(
      `SELECT property_id, target_record_id
       FROM database_record_relations
       WHERE source_record_id = $1 AND property_id = ANY($2::uuid[])`,
      [record.id, relationPropertyIds],
    );
    const before = new Map<string, Set<string>>();
    for (const row of stored.rows) {
      const targets = before.get(row.property_id) ?? new Set<string>();
      targets.add(row.target_record_id);
      before.set(row.property_id, targets);
    }

    let changed = 0;
    const addedRelations: ManifestRelation[] = [];
    for (const propertyId of relationPropertyIds) {
      const current = before.get(propertyId) ?? new Set<string>();
      const next = wanted.get(propertyId) ?? new Set<string>();
      const removed = [...current].filter((id) => !next.has(id));
      const added = [...next].filter((id) => !current.has(id));

      if (removed.length > 0) {
        const deleted = await client.query(
          `DELETE FROM database_record_relations
           WHERE source_record_id = $1 AND property_id = $2 AND target_record_id = ANY($3::uuid[])`,
          [record.id, propertyId, removed],
        );
        changed += deleted.rowCount ?? 0;
      }
      if (added.length > 0) {
        const inserted = await client.query<{
          source_record_id: string;
          property_id: string;
          target_record_id: string;
        }>(
          `INSERT INTO database_record_relations (source_record_id, property_id, target_record_id)
           SELECT $1, $2, target.id
           FROM database_records AS target
           WHERE target.id = ANY($3::uuid[])
           ON CONFLICT DO NOTHING
           RETURNING source_record_id, property_id, target_record_id`,
          [record.id, propertyId, added],
        );
        changed += inserted.rowCount ?? 0;
        addedRelations.push(...inserted.rows.map((relation) => ({
          sourceRecordId: relation.source_record_id,
          propertyId: relation.property_id,
          targetRecordId: relation.target_record_id,
        })));
      }
    }

    return { changed, added: addedRelations };
  }

  /**
   * Refreshes a database's property schema and the views the import infers.
   * Property rows are matched by their deterministic id, so a rename or type
   * change is applied in place. A property that is no longer in Notion is kept
   * (its values are not thrown away) and a view the import did not create is
   * never touched.
   */
  private async syncDatabaseStructure(
    client: Client,
    databaseId: string,
  ): Promise<{
    name: string;
    properties: number;
    views: number;
    addedProperties: string[];
    addedViews: string[];
  }> {
    const database = this.model.databases.find((row) => row.id === databaseId);
    const name = database?.name ?? databaseId;
    const properties = this.model.properties.filter((row) => row.databaseId === databaseId);

    const existing = await client.query<{
      id: string;
      name: string;
      type: string;
      options: Json;
      sort_order: number;
    }>(
      `SELECT id, name, type, options, sort_order
       FROM database_properties WHERE database_id = $1`,
      [databaseId],
    );
    const stored = new Map(existing.rows.map((row) => [row.id, row]));
    let propertyChanges = 0;
    const addedProperties: string[] = [];

    for (const property of properties) {
      const row = stored.get(property.id);
      if (!row) {
        // A property Notion added. Records keep the values they were imported
        // with; a refreshed record fills the new column on its next edit.
        const inserted = await client.query(
          `INSERT INTO database_properties
             (id, database_id, name, type, options, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            property.id,
            property.databaseId,
            property.name,
            property.type,
            JSON.stringify(property.options),
            property.sortOrder,
            property.createdAt,
          ],
        );
        if ((inserted.rowCount ?? 0) > 0) addedProperties.push(property.id);
        propertyChanges += inserted.rowCount ?? 0;
        continue;
      }

      if (
        row.name === property.name
        && row.type === property.type
        && row.sort_order === property.sortOrder
        && sameJson(row.options, property.options)
      ) {
        continue;
      }

      await client.query(
        `UPDATE database_properties
         SET name = $2, type = $3, options = $4::jsonb, sort_order = $5
         WHERE id = $1`,
        [
          property.id,
          property.name,
          property.type,
          JSON.stringify(property.options),
          property.sortOrder,
        ],
      );
      propertyChanges += 1;
    }

    const dataSourceId = this.dataSourceByDatabase.get(databaseId);
    if (!dataSourceId) {
      return {
        name,
        properties: propertyChanges,
        views: 0,
        addedProperties,
        addedViews: [],
      };
    }

    const tableId = kbsId("view", dataSourceId);
    const boardId = kbsId("view-board", dataSourceId);
    const board = this.model.views.find((view) => view.id === boardId);
    const views = await client.query<{ id: string; config: Json }>(
      `SELECT id, config FROM database_views WHERE id = ANY($1::uuid[])`,
      [[tableId, boardId]],
    );
    const storedViews = new Map(views.rows.map((row) => [row.id, row]));
    let viewChanges = 0;

    const addedViews: string[] = [];
    const insertView = async (view: ViewRow) => {
      const inserted = await client.query(
        `INSERT INTO database_views
           (id, database_id, name, type, config, sort_order, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          view.id,
          view.databaseId,
          view.name,
          view.type,
          JSON.stringify(view.config),
          view.sortOrder,
          view.createdAt,
        ],
      );
      if ((inserted.rowCount ?? 0) > 0) addedViews.push(view.id);
      return inserted.rowCount ?? 0;
    };

    if (!storedViews.has(tableId)) {
      const table = this.model.views.find((view) => view.id === tableId);
      if (table) viewChanges += await insertView(table);
    }

    if (board) {
      const current = storedViews.get(boardId);
      if (!current) {
        viewChanges += await insertView(board);
      } else if (asString(asRecord(current.config).groupBy) !== asString(board.config.groupBy)) {
        // Only the grouping is the import's guess; other view settings the user
        // configured are left as they are.
        const updated = await client.query(
          `UPDATE database_views SET config = config || $2::jsonb WHERE id = $1`,
          [boardId, JSON.stringify({ groupBy: asString(board.config.groupBy) })],
        );
        viewChanges += updated.rowCount ?? 0;
      }
    } else if (storedViews.has(boardId)) {
      // The status-like select is gone, so the board the import inferred for it
      // is no longer justified. Only the import's own view is removed.
      const deleted = await client.query(
        `DELETE FROM database_views WHERE id = $1 AND database_id = $2`,
        [boardId, databaseId],
      );
      viewChanges += deleted.rowCount ?? 0;
    }

    return {
      name,
      properties: propertyChanges,
      views: viewChanges,
      addedProperties,
      addedViews,
    };
  }

  /** The trashed objects this walk found that still have a row in KBS. */
  private async findTrashedInKbs(
    client: Client,
  ): Promise<{ count: number; kept: TrashedNotion[] }> {
    const entries = [...this.trashed.values()];
    if (entries.length === 0) return { count: 0, kept: [] };

    const kept: TrashedNotion[] = [];
    const tables = [
      ["page", "pages"],
      ["record", "database_records"],
      ["database", "databases"],
    ] as const;

    for (const [kind, table] of tables) {
      const ids = entries.filter((entry) => entry.kind === kind).map((entry) => entry.id);
      if (ids.length === 0) continue;
      const found = await existingRowIds(client, table, ids);
      for (const entry of entries) {
        if (entry.kind === kind && found.has(entry.id)) kept.push(entry);
      }
    }

    return { count: entries.length, kept };
  }

  /**
   * The walked objects that have a KBS row. `--update` never inserts, so an
   * object Notion has but KBS does not was not written by the import and must
   * not enter the map, which only describes rows that exist.
   */
  private async storedNotionObjects(client: Client): Promise<NotionObjectRow[]> {
    const tables: Record<NotionObjectRow["kind"], string> = {
      page: "pages",
      record: "database_records",
      database: "databases",
    };
    const stored: NotionObjectRow[] = [];
    for (const [kind, table] of Object.entries(tables) as [
      NotionObjectRow["kind"],
      string,
    ][]) {
      const objects = this.model.objects.filter((object) => object.kind === kind);
      if (objects.length === 0) continue;
      const found = await existingRowIds(client, table, objects.map((object) => object.kbsId));
      stored.push(...objects.filter((object) => found.has(object.kbsId)));
    }
    return stored;
  }

  /**
   * Notion's search results and a page's children both omit objects in the
   * trash, so an object trashed after an import simply disappears from the
   * walk. Every import stores the Notion id of what it wrote, so the update can
   * ask Notion about the stored objects the walk did not reach and report the
   * trashed ones even though nothing in the walk names them.
   */
  private async reportTrashedOutsideWalk(client: Client) {
    const result = await client.query<{
      notion_id: string;
      kind: string;
      kbs_id: string;
      label: string;
      parent_notion_id: string | null;
    }>("SELECT notion_id, kind, kbs_id, label, parent_notion_id FROM notion_objects");
    if (result.rows.length === 0) return;

    const seen = new Set(
      this.model.objects.map((object) => `${object.kind}:${object.notionId}:${object.kbsId}`),
    );
    const reached = new Set(this.model.objects.map((object) => object.notionId));
    // A --root walk covers only part of the workspace, so an object outside it
    // is missing because it was not asked for, not because Notion trashed it.
    const workspaceWalked = this.options.roots.length === 0;

    const pending = result.rows.filter(
      (row) => !seen.has(`${row.kind}:${row.notion_id}:${row.kbs_id}`),
    );
    if (pending.length === 0) return;

    const tables: Record<string, string> = {
      page: "pages",
      record: "database_records",
      database: "databases",
    };
    const stillStored = new Map<string, Set<string>>();
    for (const [kind, table] of Object.entries(tables)) {
      const ids = pending.filter((row) => row.kind === kind).map((row) => row.kbs_id);
      if (ids.length === 0) continue;
      stillStored.set(kind, await existingRowIds(client, table, ids));
    }

    const checked = new Set<number>();
    let learned = true;
    while (learned) {
      learned = false;
      for (const [index, row] of pending.entries()) {
        if (checked.has(index)) continue;
        const parent = row.parent_notion_id;
        if (parent ? !reached.has(parent) : !workspaceWalked) continue;

        checked.add(index);
        const label = await this.trashedNotionLabel(row.kind, row.notion_id);
        if (label === null) continue;
        // A trashed object makes its own children candidates too, so a whole
        // trashed subtree is reported rather than only its top page.
        reached.add(row.notion_id);
        learned = true;

        if (row.kind !== "page" && row.kind !== "record" && row.kind !== "database") continue;
        if (!stillStored.get(row.kind)?.has(row.kbs_id)) continue;
        this.noteTrashed(row.kind, row.kbs_id, label || row.label);
      }
    }
  }

  /** The current label of a Notion object when it is trashed, otherwise null. */
  private async trashedNotionLabel(kind: string, notionId: string): Promise<string | null> {
    return notionTrashLabel(this.client, kind, notionId);
  }

  // -- File retry -----------------------------------------------------------

  /**
   * Re-downloads the Notion-hosted media a previous run had to keep as Notion
   * links. The conversion pass did not download anything; this method checks
   * each deterministic attachment id against KBS and fetches only the ids whose
   * row or bytes are missing. Whatever it recovers is then written back into
   * the page documents, covers and record file values that still hold the
   * expired Notion URL, so those references stop depending on Notion.
   */
  private async retryMissingFiles(): Promise<boolean> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to retry files.");

    if (this.retryFiles.size === 0) {
      console.log("\nNo Notion-hosted files were found, so there is nothing to retry.");
      return true;
    }

    const client = new Client({ connectionString, application_name: "kbs-notion-retry-files" });
    await client.connect();

    try {
      const candidates = [...this.retryFiles.values()];
      const stored = await storedAttachments(
        client,
        candidates.map((file) => file.attachmentId),
      );
      const directory = attachmentsDirectory();
      const replacements = new Map<string, AttachmentReplacement>();
      const alreadyStored: RetryFile[] = [];
      const missing: RetryFile[] = [];

      for (const file of candidates) {
        const row = stored.get(file.attachmentId);
        const onDisk = row
          ? await stat(path.join(directory, file.attachmentId)).catch(() => null)
          : null;
        if (row && onDisk) {
          alreadyStored.push(file);
          continue;
        }
        missing.push(file);
      }

      // Files stored by an earlier run still get a replacement entry: the bytes
      // may be there while the reference rewrite never happened.
      for (const file of alreadyStored) {
        const row = stored.get(file.attachmentId);
        if (!row) continue;
        replacements.set(attachmentSourceUrl(file.url), {
          attachmentId: row.id,
          url: attachmentUrl(row.id),
          filename: row.filename,
          mimeType: row.mimeType,
        });
      }

      const fetched: string[] = [];
      const fetchedFiles: ManifestFile[] = [];
      const attachmentSources: ManifestAttachmentSource[] = [];
      const failures: string[] = [];
      const notes: string[] = [];

      for (const file of missing) {
        const downloaded = await this.download(file.url, file.filename);
        if (!downloaded) {
          failures.push(`${file.filename}: Notion's copy could not be downloaded.`);
          continue;
        }
        const { mimeType, allowed } = chooseMimeType(
          downloaded.mimeType,
          file.declaredMime,
          file.purpose,
        );
        if (!allowed) {
          failures.push(`${file.filename}: KBS does not store ${mimeType || "this type"} files.`);
          continue;
        }

        const filename = truncate(withExtension(file.filename, mimeType), 255);
        const size = downloaded.bytes.byteLength;
        // The row can exist while its bytes do not, so the insert keeps the
        // metadata the import recorded and only the file is rewritten.
        const existing = stored.get(file.attachmentId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, file.attachmentId), downloaded.bytes);
        await client.query(
          `INSERT INTO attachments (id, filename, mime_type, size)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [file.attachmentId, filename, mimeType, size],
        );
        if (existing && existing.size !== size) {
          notes.push(
            `attachment ${file.attachmentId}: stored ${size} bytes, but KBS recorded ${existing.size}.`,
          );
        }

        fetched.push(file.attachmentId);
        fetchedFiles.push({
          attachmentId: file.attachmentId,
          path: path.join(directory, file.attachmentId),
          size,
        });
        attachmentSources.push({
          attachmentId: file.attachmentId,
          url: file.url,
          filename: existing?.filename ?? filename,
          mimeType: existing?.mimeType ?? mimeType,
        });
        replacements.set(attachmentSourceUrl(file.url), {
          attachmentId: file.attachmentId,
          url: attachmentUrl(file.attachmentId),
          filename: existing?.filename ?? filename,
          mimeType: existing?.mimeType ?? mimeType,
        });
      }

      const pagesUpdated = await patchPageReferences(
        client,
        this.model.pages.map((page) => page.id),
        replacements,
      );
      const recordsUpdated = await patchRecordReferences(
        client,
        this.model.records.map((record) => record.id),
        replacements,
      );

      const lines = [
        "",
        "Notion → KBS file retry",
        `  Notion-hosted files: ${candidates.length}`,
        `  already stored:      ${alreadyStored.length}`,
        `  re-downloaded:       ${fetched.length}`,
        `  still unavailable:   ${failures.length}`,
        `  pages updated:       ${pagesUpdated}`,
        `  records updated:     ${recordsUpdated}`,
      ];
      if (replacements.size === 0) {
        lines.push("", "Nothing to rewrite: no stored attachment matches these files.");
      }
      if (notes.length > 0) {
        lines.push("", "Notes:");
        for (const note of notes) lines.push(`  - ${note}`);
      }
      if (failures.length > 0) {
        lines.push("", "Files still kept as Notion links:");
        for (const failure of failures.slice(0, MAX_WARNINGS)) lines.push(`  - ${failure}`);
        if (failures.length > MAX_WARNINGS) {
          lines.push(`  - … and ${failures.length - MAX_WARNINGS} more`);
        }
      }

      lines.push(...this.warningLines());
      console.log(lines.join("\n"));

      // Files this run stored are exactly what a later --undo has to remove:
      // the Notion URL each one replaced is kept so the references can be put
      // back before the bytes go away.
      if (fetched.length > 0) {
        const rows = emptyRows();
        rows.attachments = [...fetched];
        const manifestFile = await saveManifest({
          databaseName: await currentDatabaseName(client),
          roots: this.rootNotionIds,
          rows,
          files: fetchedFiles,
          attachmentSources,
          run: "retry-files",
          destination: this.options.manifestPath,
        });
        if (manifestFile) {
          console.log(
            `Retry manifest: ${manifestFile}\nUndo this run with: npm run import:notion -- --undo "${manifestFile}"`,
          );
        }
      }
      return failures.length === 0;
    } finally {
      await client.end();
    }
  }

  // -- Reporting ------------------------------------------------------------

  /**
   * Checks that every row this conversion would write is present in KBS. The
   * ids are deterministic, so a partial write, a rolled-back transaction, or a
   * deleted attachment shows up as a missing id while unrelated workspace
   * content is ignored. Files are checked twice: the attachment row must exist
   * and the bytes on disk must still be the size Notion sent.
   */
  private async verifyAgainstKbs(): Promise<boolean> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to verify an import.");

    const client = new Client({ connectionString, application_name: "kbs-notion-verify" });
    await client.connect();

    try {
      const expectedPages = this.model.pages.map((row) => row.id);
      const expectedDatabases = this.model.databases.map((row) => row.id);
      const expectedProperties = this.model.properties.map((row) => row.id);
      const expectedRecords = this.model.records.map((row) => row.id);
      const expectedFiles = [...this.model.attachments.values()];

      const foundPages = await existingRowIds(client, "pages", expectedPages);
      const foundDatabases = await existingRowIds(client, "databases", expectedDatabases);
      const foundProperties = await existingRowIds(client, "database_properties", expectedProperties);
      const foundRecords = await existingRowIds(client, "database_records", expectedRecords);
      const foundRelations = await existingRelationKeys(client, this.model.relations);
      const foundAttachments = await existingRowIds(
        client,
        "attachments",
        expectedFiles.map((file) => file.id),
      );

      const mismatches: string[] = [];
      const reportMissing = (label: string, ids: string[], present: ReadonlySet<string>) => {
        const missing = ids.filter((id) => !present.has(id));
        if (missing.length === 0) return;
        mismatches.push(
          `${missing.length} of ${ids.length} ${label} ${missing.length === 1 ? "is" : "are"} missing from KBS${sampleIds(missing)}`,
        );
      };
      reportMissing("pages", expectedPages, foundPages);
      reportMissing("databases", expectedDatabases, foundDatabases);
      reportMissing("properties", expectedProperties, foundProperties);
      reportMissing("records", expectedRecords, foundRecords);

      const expectedRelationKeys = this.model.relations.map((relation) =>
        relationKey(relation.sourceRecordId, relation.propertyId, relation.targetRecordId),
      );
      const missingRelations = expectedRelationKeys.filter((key) => !foundRelations.has(key));
      if (missingRelations.length > 0) {
        mismatches.push(
          `${missingRelations.length} of ${expectedRelationKeys.length} record relations ${missingRelations.length === 1 ? "is" : "are"} missing from KBS`,
        );
      }

      reportMissing(
        "attachments",
        expectedFiles.map((file) => file.id),
        foundAttachments,
      );

      // The bytes are checked independently of the row: a missing row and a
      // missing file are different repairs and both matter.
      const missingFiles: string[] = [];
      const wrongSizes: string[] = [];
      for (const file of expectedFiles) {
        const filePath = path.join(attachmentsDirectory(), file.id);
        const info = await stat(filePath).catch(() => null);
        if (!info) {
          missingFiles.push(file.id);
        } else if (info.size !== file.size) {
          wrongSizes.push(
            `${file.id} is ${info.size} bytes on disk but Notion's copy is ${file.size}`,
          );
        }
      }
      if (missingFiles.length > 0) {
        mismatches.push(
          `${missingFiles.length} of ${expectedFiles.length} attachment files ${missingFiles.length === 1 ? "is" : "are"} missing from ${attachmentsDirectory()}${sampleIds(missingFiles)}`,
        );
      }
      if (wrongSizes.length > 0) {
        const sample = wrongSizes.slice(0, 3).join("; ");
        mismatches.push(
          `${wrongSizes.length} attachment ${wrongSizes.length === 1 ? "file has" : "files have"} a different size (${sample}${wrongSizes.length > 3 ? "; …" : ""})`,
        );
      }

      const lines = [
        "",
        "Verification against KBS (counts are what this conversion would import)",
        `  pages:              ${foundPages.size} of ${expectedPages.length}`,
        `  databases:          ${foundDatabases.size} of ${expectedDatabases.length}`,
        `  properties:         ${foundProperties.size} of ${expectedProperties.length}`,
        `  records:            ${foundRecords.size} of ${expectedRecords.length}`,
        `  relations:          ${foundRelations.size} of ${expectedRelationKeys.length}`,
        `  files:              ${foundAttachments.size} of ${expectedFiles.length} recorded, ${expectedFiles.length - missingFiles.length} of ${expectedFiles.length} on disk`,
      ];

      if (mismatches.length === 0) {
        lines.push("", "No mismatches: every row and file this import would create is present.");
      } else {
        lines.push("", "Mismatches:");
        for (const mismatch of mismatches) lines.push(`  - ${mismatch}`);
      }

      console.log(lines.join("\n"));
      return mismatches.length === 0;
    } finally {
      await client.end();
    }
  }

  private warn(where: string, message: string) {
    if (this.warnings.length < MAX_WARNINGS) this.warnings.push(`[${where}] ${message}`);
  }

  private noteNotionObject(
    kind: NotionObjectRow["kind"],
    notionId: string,
    id: string,
    label: string,
    parentNotionId: string | null,
  ) {
    const normalized = notionId.toLowerCase();
    const row: NotionObjectRow = {
      notionId: normalized,
      kind,
      kbsId: id,
      label: truncate(label || "Untitled", 200),
      parentNotionId: parentNotionId ? parentNotionId.toLowerCase() : null,
    };
    const key = `${kind}:${normalized}:${id}`;
    const index = this.notionObjectIndex.get(key);
    if (index === undefined) {
      this.notionObjectIndex.set(key, this.model.objects.length);
      this.model.objects.push(row);
    } else {
      this.model.objects[index] = row;
    }
  }

  private noteTrashed(kind: TrashedNotion["kind"], id: string, label: string) {
    this.trashed.set(`${kind}:${id}`, {
      kind,
      id,
      label: truncate(label || "Untitled", 200),
    });
  }

  /**
   * The warnings the walk collected (an unreadable body, a failed download, a
   * snapshot, …). Every write mode prints them, so a quiet summary never hides
   * something the update or retry could not bring over.
   */
  /** One line for every hosted video/audio block the walk had to keep as a link. */
  private hostedMediaWarning(): string | null {
    const count = this.hostedMedia.length;
    if (count === 0) return null;
    const video = this.hostedMedia.filter((block) => block.type === "video").length;
    const audio = count - video;
    const kinds = [
      video > 0 ? `${video} video` : "",
      audio > 0 ? `${audio} audio` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return [
      `${count} Notion-hosted video/audio ${count === 1 ? "block" : "blocks"}`,
      `kept as ${count === 1 ? "an expiring link" : "expiring links"} (${kinds});`,
      `--retry-files cannot refresh ${count === 1 ? "it" : "them"}.`,
    ].join(" ");
  }

  private warningLines(): string[] {
    const summary = this.hostedMediaWarning();
    if (this.warnings.length === 0 && !summary) return [];
    const lines = ["", "Warnings:"];
    for (const warning of this.warnings) lines.push(`  - ${warning}`);
    if (this.warnings.length >= MAX_WARNINGS) {
      lines.push(`  - … only the first ${MAX_WARNINGS} are shown`);
    }
    if (summary) lines.push(`  - ${summary}`);
    return lines;
  }

  private printSummary(elapsedMs: number) {
    const attachmentBytes = [...this.model.attachments.values()].reduce(
      (total, attachment) => total + attachment.size,
      0,
    );
    const warningCount = this.warnings.length + (this.hostedMediaWarning() ? 1 : 0);
    const lines = [
      "",
      this.options.verify
        ? "Notion → KBS import (verify)"
        : this.options.dryRun
          ? "Notion → KBS import (dry run)"
          : "Notion → KBS import",
      `  roots:              ${this.rootCount}`,
      `  pages:              ${this.model.pages.length}`,
      `  databases:          ${this.model.databases.length}`,
      `  properties:         ${this.model.properties.length}`,
      `  views:              ${this.model.views.length}${this.boardViews > 0 ? ` (${this.boardViews} board)` : ""}`,
      ...(this.rollupsMapped + this.rollupsSnapshotted > 0
        ? [
            `  rollups:            ${this.rollupsMapped} mapped, ${this.rollupsSnapshotted} snapshotted`,
          ]
        : []),
      ...(this.formulasMapped + this.formulasSnapshotted > 0
        ? [
            `  formulas:           ${this.formulasMapped} mapped, ${this.formulasSnapshotted} snapshotted`,
          ]
        : []),
      ...(this.buttonsSkipped > 0
        ? [
            `  buttons:            ${this.buttonsSkipped} skipped (Notion does not expose their actions)`,
          ]
        : []),
      `  records:            ${this.model.records.length}`,
      `  record relations:   ${this.model.relations.length}`,
      `  page links:         ${this.model.pageLinks.length}`,
      `  files:              ${this.model.attachments.size} (${(attachmentBytes / (1024 * 1024)).toFixed(1)} MB)`,
      `  warnings:           ${warningCount}${this.warnings.length >= MAX_WARNINGS ? " (first " + MAX_WARNINGS + " kept)" : ""}`,
      `  elapsed:            ${(elapsedMs / 1000).toFixed(1)}s`,
    ];

    lines.push(...this.warningLines());

    if (this.options.verify) {
      lines.push("", "Verification only: no rows and no files were written.");
    } else if (this.options.dryRun) {
      lines.push("", "Dry run: no rows and no files were written.");
    }

    console.log(lines.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// Database writer
// ---------------------------------------------------------------------------

type InsertResult = {
  inserted: number;
  created: Json[];
};

/**
 * Inserts the rows that do not exist yet and reports back exactly the ones this
 * run created, so an import manifest can list nothing but its own rows.
 */
async function insertRows(
  client: Client,
  table: string,
  rows: Record<string, unknown>[],
  returning: string,
): Promise<InsertResult> {
  const CHUNK = 400;
  let inserted = 0;
  const created: Json[] = [];

  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const result = await client.query(
      `INSERT INTO "${table}"
       SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING ${returning}`,
      [JSON.stringify(chunk)],
    );
    inserted += result.rowCount ?? 0;
    created.push(...(result.rows as Json[]));
  }

  return { inserted, created };
}

function relationKey(sourceRecordId: string, propertyId: string, targetRecordId: string) {
  return `${sourceRecordId}:${propertyId}:${targetRecordId}`;
}

/**
 * The part of a Notion file URL that identifies the file. Its query string is
 * the signature, which Notion changes every time it signs the URL, so stripping
 * it is what lets a retry recognise the expired URL a page still holds.
 */
function attachmentSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** Rewrites the Notion file URLs a stored document holds. */
function replaceDocumentUrls(
  node: DocNode,
  replacements: ReadonlyMap<string, AttachmentReplacement>,
): boolean {
  let changed = false;
  const swap = (value: string) => {
    const next = replacements.get(attachmentSourceUrl(value));
    if (!next) return value;
    changed = true;
    return next.url;
  };

  if (node.attrs) {
    for (const key of ["src", "href"]) {
      const value = node.attrs[key];
      if (typeof value === "string") node.attrs[key] = swap(value);
    }
  }
  for (const mark of node.marks ?? []) {
    const href = mark.attrs?.href;
    if (mark.attrs && typeof href === "string") mark.attrs.href = swap(href);
  }
  for (const child of node.content ?? []) {
    if (replaceDocumentUrls(child, replacements)) changed = true;
  }

  return changed;
}

/**
 * Compares two JSON values the way PostgreSQL stores them: object key order
 * carries no meaning, and a key whose value is `undefined` is simply absent
 * (jsonb drops it). Page documents and record values use this so an unchanged
 * row is not rewritten only because its keys came back reordered.
 */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (typeof left !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameJson(value, right[index]));
  }

  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject).filter((key) => leftObject[key] !== undefined);
  const rightKeys = Object.keys(rightObject).filter((key) => rightObject[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) =>
      Object.hasOwn(rightObject, key)
      && rightObject[key] !== undefined
      && sameJson(leftObject[key], rightObject[key]),
  );
}

function batches<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

type StoredAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

async function storedAttachments(
  client: Client,
  ids: string[],
): Promise<Map<string, StoredAttachment>> {
  const stored = new Map<string, StoredAttachment>();
  for (const batch of batches(ids, 2000)) {
    const result = await client.query<{
      id: string;
      filename: string;
      mime_type: string;
      size: number;
    }>(
      `SELECT id, filename, mime_type, size FROM attachments WHERE id = ANY($1::uuid[])`,
      [batch],
    );
    for (const row of result.rows) {
      stored.set(row.id, {
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        size: row.size,
      });
    }
  }
  return stored;
}

/** A short, deterministic sample of ids so a warning can name a few culprits. */
function sampleIds(ids: string[], limit = 3): string {
  if (ids.length === 0) return "";
  const sample = [...ids].sort().slice(0, limit);
  return ` (${sample.join(", ")}${ids.length > limit ? ", …" : ""})`;
}

async function existingRowIds(
  client: Client,
  table: string,
  ids: string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  const BATCH = 2000;
  for (let start = 0; start < ids.length; start += BATCH) {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM "${table}" WHERE id = ANY($1::uuid[])`,
      [ids.slice(start, start + BATCH)],
    );
    for (const row of result.rows) present.add(row.id);
  }
  return present;
}

async function existingRelationKeys(
  client: Client,
  relations: RelationRow[],
): Promise<Set<string>> {
  const present = new Set<string>();
  const BATCH = 2000;
  for (let start = 0; start < relations.length; start += BATCH) {
    const batch = relations.slice(start, start + BATCH);
    const result = await client.query<{
      source_record_id: string;
      property_id: string;
      target_record_id: string;
    }>(
      `SELECT relation.source_record_id, relation.property_id, relation.target_record_id
       FROM database_record_relations AS relation
       CROSS JOIN unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS expected(source_record_id, property_id, target_record_id)
       WHERE relation.source_record_id = expected.source_record_id
         AND relation.property_id = expected.property_id
         AND relation.target_record_id = expected.target_record_id`,
      [
        batch.map((relation) => relation.sourceRecordId),
        batch.map((relation) => relation.propertyId),
        batch.map((relation) => relation.targetRecordId),
      ],
    );
    for (const row of result.rows) {
      present.add(relationKey(row.source_record_id, row.property_id, row.target_record_id));
    }
  }
  return present;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function linkPageParents(client: Client, pages: PageRow[]): Promise<string[]> {
  const rows = pages
    .filter((page) => page.parentId !== null)
    .map((page) => ({ id: page.id, parent_id: page.parentId }));

  if (rows.length === 0) return [];

  const result = await client.query<{ id: string }>(
    `UPDATE pages AS target
     SET parent_id = source.parent_id
     FROM (
       SELECT id, parent_id
       FROM jsonb_populate_recordset(NULL::pages, $1::jsonb)
       WHERE parent_id IS NOT NULL
     ) AS source
     WHERE target.id = source.id AND target.parent_id IS NULL
     RETURNING target.id`,
    [JSON.stringify(rows)],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Records Notion's id for each object a run wrote. Rows are keyed by Notion id
 * and KBS row because one Notion database can hold several data sources; an
 * existing row only has its label, parent and timestamp refreshed.
 */
async function upsertNotionObjects(client: Client, objects: NotionObjectRow[]) {
  for (const batch of batches(objects, 500)) {
    await client.query(
      `INSERT INTO notion_objects (notion_id, kind, kbs_id, label, parent_notion_id, updated_at)
       SELECT object_id, kind, kbs_id, label, parent_notion_id, now()
       FROM unnest($1::text[], $2::text[], $3::uuid[], $4::text[], $5::text[])
         AS source(object_id, kind, kbs_id, label, parent_notion_id)
       ON CONFLICT (notion_id, kbs_id) DO UPDATE
       SET kind = EXCLUDED.kind,
           label = EXCLUDED.label,
           parent_notion_id = EXCLUDED.parent_notion_id,
           updated_at = now()`,
      [
        batch.map((object) => object.notionId),
        batch.map((object) => object.kind),
        batch.map((object) => object.kbsId),
        batch.map((object) => object.label),
        batch.map((object) => object.parentNotionId),
      ],
    );
  }
}

/** Rewrites Notion file URLs in page documents and covers. */
async function patchPageReferences(
  client: Client,
  pageIds: string[],
  replacements: ReadonlyMap<string, AttachmentReplacement>,
): Promise<number> {
  if (replacements.size === 0 || pageIds.length === 0) return 0;
  let updated = 0;

  for (const ids of batches(pageIds, 500)) {
    const result = await client.query<{
      id: string;
      content_json: DocNode;
      cover_image_url: string | null;
    }>(
      `SELECT id, content_json, cover_image_url FROM pages WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    for (const row of result.rows) {
      const document = asRecord(row.content_json) as DocNode;
      let changed = replaceDocumentUrls(document, replacements);
      let cover = row.cover_image_url;
      if (cover) {
        const replacement = replacements.get(attachmentSourceUrl(cover));
        if (replacement) {
          cover = replacement.url;
          changed = true;
        }
      }
      if (!changed) continue;

      await client.query(
        `UPDATE pages SET content_json = $2::jsonb, content = $3, cover_image_url = $4 WHERE id = $1`,
        [
          row.id,
          JSON.stringify(document),
          documentToPlainText(document).slice(0, 2_000_000),
          cover,
        ],
      );
      updated += 1;
    }
  }

  return updated;
}

/** Rewrites the Notion file URL a file property value still holds. */
async function patchRecordReferences(
  client: Client,
  recordIds: string[],
  replacements: ReadonlyMap<string, AttachmentReplacement>,
): Promise<number> {
  if (replacements.size === 0 || recordIds.length === 0) return 0;
  let updated = 0;

  for (const ids of batches(recordIds, 500)) {
    const result = await client.query<{ id: string; values: Json }>(
      `SELECT id, values FROM database_records WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    for (const row of result.rows) {
      let changed = false;
      for (const [propertyId, rawValue] of Object.entries(asRecord(row.values))) {
        if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) continue;
        const value = asRecord(rawValue);
        const url = asString(value.url);
        if (!url) continue;
        const replacement = replacements.get(attachmentSourceUrl(url));
        if (!replacement) continue;
        row.values[propertyId] = {
          ...value,
          attachmentId: replacement.attachmentId,
          url: replacement.url,
          filename: replacement.filename,
          mimeType: replacement.mimeType,
        };
        changed = true;
      }
      if (!changed) continue;

      // The timestamp stays as it was: `--update` compares Notion's
      // last-edited time with it, and rewriting a URL is not a Notion edit.
      await client.query(
        `UPDATE database_records SET values = $2::jsonb WHERE id = $1`,
        [row.id, JSON.stringify(row.values)],
      );
      updated += 1;
    }
  }

  return updated;
}

/**
 * The pages and records whose JSON holds one of these attachment URLs. Undo
 * uses this to put the Notion URL back before the attachment rows are deleted.
 */
async function attachmentReferenceIds(
  client: Client,
  urls: string[],
): Promise<{ pageIds: string[]; recordIds: string[] }> {
  const pageIds = new Set<string>();
  const recordIds = new Set<string>();
  for (const batch of batches(urls, 100)) {
    const patterns = batch.map((url) => `%${url}%`);
    const pages = await client.query<{ id: string }>(
      `SELECT id FROM pages
       WHERE content_json::text LIKE ANY($1::text[]) OR cover_image_url LIKE ANY($1::text[])`,
      [patterns],
    );
    for (const row of pages.rows) pageIds.add(row.id);

    const records = await client.query<{ id: string }>(
      `SELECT id FROM database_records WHERE values::text LIKE ANY($1::text[])`,
      [patterns],
    );
    for (const row of records.rows) recordIds.add(row.id);
  }
  return { pageIds: [...pageIds], recordIds: [...recordIds] };
}

async function dumpImportModel(model: ImportModel, destination: string, warnings: string[]) {
  const file = path.resolve(process.cwd(), destination);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        format: "kbs-notion-import",
        version: 1,
        pages: model.pages,
        databases: model.databases,
        properties: model.properties,
        views: model.views,
        records: model.records,
        relations: model.relations,
        pageLinks: model.pageLinks,
        attachments: [...model.attachments.values()],
        warnings,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Converted workspace written to ${file}`);
}

export async function writeImportModel(
  model: ImportModel,
  merge: boolean,
  context: { roots: string[]; files: ManifestFile[]; manifestPath: string | null },
): Promise<string | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to write an import. Use --dry-run to preview instead.");
  }

  const client = new Client({
    connectionString,
    application_name: "kbs-notion-import",
  });
  await client.connect();

  let manifestFile: string | null = null;

  try {
    const databaseName = await currentDatabaseName(client);
    const rows = emptyRows();
    const existing = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages",
    );
    const pageCount = existing.rows[0]?.count ?? 0;
    if (pageCount > 0 && !merge) {
      throw new Error(
        `This KBS workspace already contains ${pageCount} page(s). Import into an empty workspace, or re-run with --merge to add only the objects that do not exist yet.`,
      );
    }

    await client.query("BEGIN");
    try {
      const attachments = await insertRows(
        client,
        "attachments",
        [...model.attachments.values()].map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          size: attachment.size,
          created_at: attachment.createdAt,
        })),
        "id",
      );
      rows.attachments = createdIds(attachments.created);

      const pages = await insertRows(
        client,
        "pages",
        model.pages.map((page) => ({
          id: page.id,
          parent_id: null,
          sort_order: page.sortOrder,
          is_favorite: false,
          icon: page.icon,
          cover_image_url: page.coverImageUrl,
          cover_position: 50,
          is_inbox: false,
          source_url: null,
          selected_text: null,
          captured_at: null,
          link_preview: null,
          capture_attachment: null,
          deleted_at: null,
          title: page.title,
          content: page.content,
          content_json: page.contentJson,
          created_at: page.createdAt,
          updated_at: page.updatedAt,
        })),
        "id",
      );
      rows.pages = createdIds(pages.created);
      const linkedParents = await linkPageParents(client, model.pages);
      rows.parentLinks = linkedParents;

      const databases = await insertRows(
        client,
        "databases",
        model.databases.map((database) => ({
          id: database.id,
          page_id: database.pageId,
          name: database.name,
          description: "",
          created_at: database.createdAt,
          updated_at: database.updatedAt,
        })),
        "id",
      );
      rows.databases = createdIds(databases.created);

      const properties = await insertRows(
        client,
        "database_properties",
        model.properties.map((property) => ({
          id: property.id,
          database_id: property.databaseId,
          name: property.name,
          type: property.type,
          options: property.options,
          sort_order: property.sortOrder,
          created_at: property.createdAt,
        })),
        "id",
      );
      rows.databaseProperties = createdIds(properties.created);

      const views = await insertRows(
        client,
        "database_views",
        model.views.map((view) => ({
          id: view.id,
          database_id: view.databaseId,
          name: view.name,
          type: view.type,
          config: view.config,
          sort_order: view.sortOrder,
          created_at: view.createdAt,
        })),
        "id",
      );
      rows.databaseViews = createdIds(views.created);

      const records = await insertRows(
        client,
        "database_records",
        model.records.map((record) => ({
          id: record.id,
          database_id: record.databaseId,
          page_id: record.pageId,
          title: record.title,
          values: record.values,
          sort_order: record.sortOrder,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        })),
        "id",
      );
      rows.databaseRecords = createdIds(records.created);

      const relations = await insertRows(
        client,
        "database_record_relations",
        model.relations.map((relation) => ({
          source_record_id: relation.sourceRecordId,
          property_id: relation.propertyId,
          target_record_id: relation.targetRecordId,
        })),
        "source_record_id, property_id, target_record_id",
      );
      rows.databaseRecordRelations = relations.created.map((relation) => ({
        sourceRecordId: String(relation.source_record_id),
        propertyId: String(relation.property_id),
        targetRecordId: String(relation.target_record_id),
      }));

      const links = await insertRows(
        client,
        "page_links",
        model.pageLinks.map((link) => ({
          source_page_id: link.sourcePageId,
          target_page_id: link.targetPageId,
          origin: link.origin,
        })),
        "source_page_id, target_page_id",
      );
      rows.pageLinks = links.created.map((link) => ({
        sourcePageId: String(link.source_page_id),
        targetPageId: String(link.target_page_id),
      }));

      await upsertNotionObjects(client, model.objects);

      // Written before COMMIT so a failed commit can remove it again; the
      // manifest never describes rows that were rolled back.
      manifestFile = await saveManifest({
        databaseName,
        roots: context.roots,
        rows,
        files: context.files,
        attachmentSources: [],
        run: "import",
        destination: context.manifestPath,
      });

      await client.query("COMMIT");

      console.log(
        [
          "",
          "Written to KBS:",
          `  pages:            ${pages.inserted} of ${model.pages.length}`,
          `  parent links:     ${linkedParents.length}`,
          `  databases:        ${databases.inserted} of ${model.databases.length}`,
          `  properties:       ${properties.inserted} of ${model.properties.length}`,
          `  views:            ${views.inserted} of ${model.views.length}`,
          `  records:          ${records.inserted} of ${model.records.length}`,
          `  relations:        ${relations.inserted} of ${model.relations.length}`,
          `  page links:       ${links.inserted} of ${model.pageLinks.length}`,
          `  attachments:      ${attachments.inserted} of ${model.attachments.size}`,
        ].join("\n"),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (manifestFile) await rm(manifestFile, { force: true });
      throw error;
    }
  } finally {
    await client.end();
  }

  return manifestFile;
}

// ---------------------------------------------------------------------------
// Import manifests and undo
// ---------------------------------------------------------------------------

const MANIFEST_FORMAT = "kbs-import-manifest";
const MANIFEST_VERSION = 1;

function emptyRows(): ManifestRows {
  return {
    pages: [],
    databases: [],
    databaseProperties: [],
    databaseViews: [],
    databaseRecords: [],
    attachments: [],
    databaseRecordRelations: [],
    pageLinks: [],
    parentLinks: [],
  };
}

function createdIds(created: Json[]): string[] {
  return created.map((row) => String(row.id));
}

function countManifestRows(rows: ManifestRows): number {
  return (
    rows.pages.length +
    rows.databases.length +
    rows.databaseProperties.length +
    rows.databaseViews.length +
    rows.databaseRecords.length +
    rows.attachments.length +
    rows.databaseRecordRelations.length +
    rows.pageLinks.length +
    rows.parentLinks.length
  );
}

/**
 * Where the manifests go. IMPORT_MANIFEST_DIR exists because the directory
 * under the working directory is not writable in the container image, and a
 * manifest written inside a one-off container is lost with it: the stack points
 * this at the data volume so `--undo` can still find the manifest later.
 */
function manifestDirectory(): string {
  const configured = process.env.IMPORT_MANIFEST_DIR?.trim();
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.join(process.cwd(), "data", "import-manifests");
}

function defaultManifestPath(run: ManifestRun): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  const prefix = run === "update" ? "notion-update" : run === "retry-files" ? "notion-retry-files" : "notion";
  return path.join(manifestDirectory(), `${prefix}-${stamp}.json`);
}

async function currentDatabaseName(client: Client): Promise<string> {
  const result = await client.query<{ name: string }>("SELECT current_database() AS name");
  return result.rows[0]?.name ?? "";
}

async function saveManifest(input: {
  databaseName: string;
  roots: string[];
  rows: ManifestRows;
  files: ManifestFile[];
  attachmentSources: ManifestAttachmentSource[];
  run: ManifestRun;
  destination: string | null;
}): Promise<string | null> {
  const totals = {
    rows: countManifestRows(input.rows),
    files: input.files.length,
    bytes: input.files.reduce((sum, file) => sum + file.size, 0),
  };
  if (totals.rows === 0 && totals.files === 0) return null;

  const manifest: ImportManifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    kind: "notion",
    run: input.run,
    createdAt: new Date().toISOString(),
    database: input.databaseName,
    roots: input.roots,
    rows: input.rows,
    files: input.files,
    attachmentSources: input.attachmentSources,
    totals,
  };
  const file = input.destination
    ? path.resolve(process.cwd(), input.destination)
    : defaultManifestPath(input.run);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return file;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function manifestRows(value: unknown): ManifestRows {
  const rows = asRecord(value);
  const relations = Array.isArray(rows.databaseRecordRelations)
    ? rows.databaseRecordRelations
    : [];
  const links = Array.isArray(rows.pageLinks) ? rows.pageLinks : [];
  return {
    pages: asStringArray(rows.pages),
    databases: asStringArray(rows.databases),
    databaseProperties: asStringArray(rows.databaseProperties),
    databaseViews: asStringArray(rows.databaseViews),
    databaseRecords: asStringArray(rows.databaseRecords),
    attachments: asStringArray(rows.attachments),
    databaseRecordRelations: relations
      .map((entry) => {
        const relation = asRecord(entry);
        return {
          sourceRecordId: asString(relation.sourceRecordId),
          propertyId: asString(relation.propertyId),
          targetRecordId: asString(relation.targetRecordId),
        };
      })
      .filter(
        (relation) =>
          relation.sourceRecordId && relation.propertyId && relation.targetRecordId,
      ),
    pageLinks: links
      .map((entry) => {
        const link = asRecord(entry);
        return {
          sourcePageId: asString(link.sourcePageId),
          targetPageId: asString(link.targetPageId),
        };
      })
      .filter((link) => link.sourcePageId && link.targetPageId),
    parentLinks: asStringArray(rows.parentLinks),
  };
}

function manifestAttachmentSources(value: unknown): ManifestAttachmentSource[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => asRecord(entry))
    .map((source) => ({
      attachmentId: asString(source.attachmentId),
      url: asString(source.url),
      filename: asString(source.filename),
      mimeType: asString(source.mimeType),
    }))
    .filter((source) => source.attachmentId && source.url);
}

function manifestFiles(value: unknown): ManifestFile[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => asRecord(entry))
    .map((file) => ({
      attachmentId: asString(file.attachmentId),
      path: asString(file.path),
      size: typeof file.size === "number" ? file.size : 0,
    }))
    .filter((file) => file.attachmentId && file.path);
}

async function readManifest(file: string): Promise<ImportManifest> {
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `Could not read the import manifest at ${file}. Pass the path printed at the end of the import.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${file} is not valid JSON.`);
  }

  const value = asRecord(parsed);
  if (value.format !== MANIFEST_FORMAT) {
    throw new Error(`${file} is not a KBS import manifest.`);
  }
  if (value.version !== MANIFEST_VERSION) {
    throw new Error(
      `${file} uses manifest version ${String(value.version)}, but this importer only understands version ${MANIFEST_VERSION}.`,
    );
  }

  const totals = asRecord(value.totals);
  const undoneAt = asString(value.undoneAt);
  const run =
    value.run === "update" || value.run === "retry-files" ? value.run : "import";
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    kind: "notion",
    run,
    createdAt: asString(value.createdAt),
    database: asString(value.database),
    roots: asStringArray(value.roots),
    rows: manifestRows(value.rows),
    files: manifestFiles(value.files),
    attachmentSources: manifestAttachmentSources(value.attachmentSources),
    totals: {
      rows: typeof totals.rows === "number" ? totals.rows : 0,
      files: typeof totals.files === "number" ? totals.files : 0,
      bytes: typeof totals.bytes === "number" ? totals.bytes : 0,
    },
    ...(undoneAt ? { undoneAt } : {}),
  };
}

function describeManifest(manifest: ImportManifest): string {
  const rows = manifest.rows;
  const megabytes = manifest.totals.bytes / (1024 * 1024);
  const fileNote =
    manifest.files.length > 0
      ? ` (${manifest.files.length} file(s), ${megabytes.toFixed(1)} MB)`
      : "";
  const label =
    manifest.run === "update"
      ? "Update manifest"
      : manifest.run === "retry-files"
        ? "File retry manifest"
        : "Import manifest";
  return [
    `${label} for database "${manifest.database}", recorded ${manifest.createdAt}`,
    `  pages:            ${rows.pages.length}`,
    `  databases:        ${rows.databases.length} (${rows.databaseProperties.length} properties, ${rows.databaseViews.length} views)`,
    `  records:          ${rows.databaseRecords.length}`,
    `  relations:        ${rows.databaseRecordRelations.length}`,
    `  page links:       ${rows.pageLinks.length}`,
    `  attachments:      ${rows.attachments.length}${fileNote}`,
  ].join("\n");
}

async function deleteIdRows(client: Client, table: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(`DELETE FROM "${table}" WHERE id = ANY($1::uuid[])`, [ids]);
  return result.rowCount ?? 0;
}

async function deletePageLinkRows(
  client: Client,
  links: ManifestPageLink[],
): Promise<number> {
  if (links.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM page_links AS link
     USING unnest($1::uuid[], $2::uuid[]) AS doomed(source_page_id, target_page_id)
     WHERE link.source_page_id = doomed.source_page_id
       AND link.target_page_id = doomed.target_page_id`,
    [links.map((link) => link.sourcePageId), links.map((link) => link.targetPageId)],
  );
  return result.rowCount ?? 0;
}

async function deleteRelationRows(
  client: Client,
  relations: ManifestRelation[],
): Promise<number> {
  if (relations.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM database_record_relations AS relation
     USING unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS doomed(source_record_id, property_id, target_record_id)
     WHERE relation.source_record_id = doomed.source_record_id
       AND relation.property_id = doomed.property_id
       AND relation.target_record_id = doomed.target_record_id`,
    [
      relations.map((relation) => relation.sourceRecordId),
      relations.map((relation) => relation.propertyId),
      relations.map((relation) => relation.targetRecordId),
    ],
  );
  return result.rowCount ?? 0;
}

/** Clears parent links the run set on pages that survive the undo. */
async function unlinkImportedParents(
  client: Client,
  parentLinks: string[],
  pageIds: string[],
): Promise<number> {
  if (parentLinks.length === 0 || pageIds.length === 0) return 0;
  const result = await client.query(
    `UPDATE pages
     SET parent_id = NULL
     WHERE id = ANY($1::uuid[]) AND parent_id = ANY($2::uuid[])`,
    [parentLinks, pageIds],
  );
  return result.rowCount ?? 0;
}

/**
 * Forgets the Notion ids of the rows an undo removed. The map exists only to
 * find objects Notion trashed, so an id whose row is gone has nothing to find.
 */
async function deleteNotionObjects(client: Client, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    "DELETE FROM notion_objects WHERE kbs_id = ANY($1::uuid[])",
    [ids],
  );
  return result.rowCount ?? 0;
}

/**
 * Attachments that other pages still reference are left alone: an imported file
 * the user later placed somewhere else must not disappear with the import.
 */
async function deleteUnreferencedAttachments(
  client: Client,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM attachments AS attachment
     WHERE attachment.id = ANY($1::uuid[])
       AND NOT EXISTS (
         SELECT 1 FROM attachment_references AS reference
         WHERE reference.attachment_id = attachment.id
       )`,
    [ids],
  );
  return result.rowCount ?? 0;
}

type FileCleanup = {
  deleted: number;
  kept: number;
  missing: number;
  changed: number;
  failed: number;
};

async function removeManifestFiles(
  client: Client,
  files: ManifestFile[],
): Promise<FileCleanup> {
  const cleanup: FileCleanup = { deleted: 0, kept: 0, missing: 0, changed: 0, failed: 0 };
  if (files.length === 0) return cleanup;

  const surviving = new Set(
    (
      await client.query<{ id: string }>(
        "SELECT id FROM attachments WHERE id = ANY($1::uuid[])",
        [files.map((file) => file.attachmentId)],
      )
    ).rows.map((row) => row.id),
  );

  for (const file of files) {
    if (surviving.has(file.attachmentId)) {
      cleanup.kept += 1;
      continue;
    }
    let size: number;
    try {
      size = (await stat(file.path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") cleanup.missing += 1;
      else cleanup.failed += 1;
      continue;
    }
    // A file rewritten since the import is not the file this manifest owns.
    if (size !== file.size) {
      cleanup.changed += 1;
      continue;
    }
    try {
      await rm(file.path, { force: true });
      cleanup.deleted += 1;
    } catch {
      cleanup.failed += 1;
    }
  }

  return cleanup;
}

async function confirmRemoval(word: string, prompt: string, cancelled: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Refusing to delete without confirmation in a non-interactive shell. Re-run with --yes.",
    );
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(prompt);
    if (answer.trim().toLowerCase() !== word) throw new Error(cancelled);
  } finally {
    readline.close();
  }
}

function confirmUndo(): Promise<void> {
  return confirmRemoval(
    "undo",
    '\nType "undo" to delete these rows and files: ',
    "Undo cancelled; nothing was deleted.",
  );
}

function confirmPrune(): Promise<void> {
  return confirmRemoval(
    "prune",
    '\nType "prune" to trash these pages and remove these records and databases: ',
    "Prune cancelled; nothing was removed.",
  );
}

export async function undoImport(manifestArgument: string, options: UndoOptions): Promise<void> {
  const file = path.resolve(process.cwd(), manifestArgument);
  const manifest = await readManifest(file);
  if (manifest.undoneAt) {
    throw new Error(`${file} was already undone at ${manifest.undoneAt}. Nothing was deleted.`);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to undo an import.");

  const client = new Client({ connectionString, application_name: "kbs-notion-undo" });
  await client.connect();

  try {
    const databaseName = await currentDatabaseName(client);
    if (manifest.database && databaseName && manifest.database !== databaseName && !options.force) {
      throw new Error(
        `That manifest was recorded against database "${manifest.database}", but DATABASE_URL points at "${databaseName}". Nothing was deleted; pass --force to undo anyway.`,
      );
    }

    console.log(describeManifest(manifest));
    if (options.dryRun) {
      console.log("\nDry run: nothing was deleted.");
      return;
    }
    if (!options.yes) await confirmUndo();

    const rows = manifest.rows;
    const sources = manifest.attachmentSources;
    const removed: Record<string, number> = {};
    await client.query("BEGIN");
    try {
      // An update or a file retry stored bytes that refreshed content now
      // points at. Put the Notion URL back first, or deleting the attachment
      // would leave the page linked to a file that no longer exists.
      removed.references = 0;
      if (sources.length > 0) {
        const replacements = new Map<string, AttachmentReplacement>();
        for (const source of sources) {
          replacements.set(attachmentUrl(source.attachmentId), {
            attachmentId: null,
            url: source.url,
            filename: source.filename,
            mimeType: source.mimeType,
          });
        }
        const affected = await attachmentReferenceIds(client, [...replacements.keys()]);
        removed.references += await patchPageReferences(client, affected.pageIds, replacements);
        removed.references += await patchRecordReferences(client, affected.recordIds, replacements);
      }

      removed.pageLinks = await deletePageLinkRows(client, rows.pageLinks);
      removed.relations = await deleteRelationRows(client, rows.databaseRecordRelations);
      removed.records = await deleteIdRows(client, "database_records", rows.databaseRecords);
      removed.views = await deleteIdRows(client, "database_views", rows.databaseViews);
      removed.properties = await deleteIdRows(client, "database_properties", rows.databaseProperties);
      removed.databases = await deleteIdRows(client, "databases", rows.databases);
      removed.parentLinks = await unlinkImportedParents(client, rows.parentLinks, rows.pages);
      removed.pages = await deleteIdRows(client, "pages", rows.pages);
      removed.notionObjects = await deleteNotionObjects(client, [
        ...rows.pages,
        ...rows.databases,
        ...rows.databaseRecords,
      ]);
      const restoredIds = new Set(sources.map((source) => source.attachmentId));
      removed.attachments = await deleteIdRows(
        client,
        "attachments",
        sources.map((source) => source.attachmentId),
      );
      removed.attachments += await deleteUnreferencedAttachments(
        client,
        rows.attachments.filter((id) => !restoredIds.has(id)),
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const files = await removeManifestFiles(client, manifest.files);
    manifest.undoneAt = new Date().toISOString();
    manifest.removed = removed;
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const summary = ["", "Undone:"];
    if (rows.pages.length > 0 || removed.pages > 0) {
      summary.push(`  pages:            ${removed.pages} of ${rows.pages.length}`);
    }
    if (rows.databases.length > 0) {
      summary.push(`  databases:        ${removed.databases} of ${rows.databases.length}`);
    }
    if (rows.databaseProperties.length > 0) {
      summary.push(`  properties:       ${removed.properties} of ${rows.databaseProperties.length}`);
    }
    if (rows.databaseViews.length > 0) {
      summary.push(`  views:            ${removed.views} of ${rows.databaseViews.length}`);
    }
    if (rows.databaseRecords.length > 0) {
      summary.push(`  records:          ${removed.records} of ${rows.databaseRecords.length}`);
    }
    if (rows.databaseRecordRelations.length > 0) {
      summary.push(`  relations:        ${removed.relations} of ${rows.databaseRecordRelations.length}`);
    }
    if (rows.pageLinks.length > 0) {
      summary.push(`  page links:       ${removed.pageLinks} of ${rows.pageLinks.length}`);
    }
    if (rows.parentLinks.length > 0) {
      summary.push(`  parent links:     ${removed.parentLinks} restored`);
    }
    if (removed.notionObjects > 0) {
      summary.push(`  notion ids:       ${removed.notionObjects} forgotten`);
    }
    if (rows.attachments.length > 0) {
      summary.push(
        `  attachments:      ${removed.attachments} of ${rows.attachments.length} (the rest are still used elsewhere)`,
      );
    }
    if (removed.references > 0) {
      summary.push(`  content:          ${removed.references} attachment references restored to Notion`);
    }
    summary.push(
      `  files:            ${files.deleted} deleted, ${files.kept} kept (still referenced), ${files.changed} kept (changed on disk), ${files.missing} already gone${files.failed > 0 ? `, ${files.failed} could not be removed` : ""}`,
      `  manifest:         ${file} (marked undone)`,
    );
    console.log(summary.join("\n"));
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Pruning what Notion trashed
// ---------------------------------------------------------------------------

type PruneOptions = {
  dryRun: boolean;
  yes: boolean;
};

/** A recorded Notion object that Notion now reports in its trash. */
type TrashedCandidate = {
  kind: TrashedNotion["kind"];
  notionId: string;
  kbsId: string;
  label: string;
};

/**
 * The label of a Notion object when Notion reports it trashed, otherwise null.
 * A 404 is not trashed: the object was deleted permanently or is no longer
 * shared, and neither is a reason to remove a KBS row.
 */
async function notionTrashLabel(
  notion: NotionClient,
  kind: string,
  notionId: string,
): Promise<string | null> {
  const endpoints =
    kind === "database"
      ? [`/databases/${notionId}`, `/data_sources/${notionId}`]
      : [`/pages/${notionId}`];

  for (const endpoint of endpoints) {
    let payload: Json;
    try {
      payload = await notion.request(endpoint);
    } catch (error) {
      // Notion keeps a trashed object retrievable; a 404 means it is gone or
      // no longer shared, which is not a trash state this mode can act on.
      if (error instanceof NotionApiError && error.status === 404) continue;
      throw error;
    }
    if (!asBoolean(payload.in_trash) && !asBoolean(payload.archived)) return null;
    return kind === "database"
      ? plainTextFromRichText(asArray(payload.title))
      : pageTitle(payload);
  }
  return null;
}

/** The ids among `ids` whose page row is, or is not, already in the KBS trash. */
async function pageIdsByTrashState(
  client: Client,
  ids: string[],
  trashed: boolean,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of batches(ids, 2000)) {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM pages
       WHERE deleted_at IS ${trashed ? "NOT NULL" : "NULL"} AND id = ANY($1::uuid[])`,
      [batch],
    );
    for (const row of result.rows) found.add(row.id);
  }
  return found;
}

/** Soft-deletes pages exactly as the app's trash action does. */
async function trashPageRows(client: Client, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    `UPDATE pages SET deleted_at = now(), updated_at = now()
     WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [ids],
  );
  return result.rowCount ?? 0;
}

/**
 * Removes the pages, records and databases Notion has moved to its trash.
 *
 * `--update` reports those objects but never acts on them; this mode is the
 * explicit opt-in. Candidates come from `notion_objects`, so an object trashed
 * after the import is found even though Notion omits it from search results and
 * from its parent's children, and nothing KBS added on its own is considered.
 * A 404 is ignored: a permanently deleted or unshared object is not something
 * this mode can name, and guessing would remove rows on a revoked integration.
 *
 * Pages are soft-deleted, exactly as the KBS trash button does, so they can be
 * restored. Records and databases have no trash of their own, so their rows are
 * removed; the pages that records own, and the page that groups a database, go
 * to the trash with them. Attachment bytes are left alone: a trashed page still
 * references them, and the trash's permanent delete removes the unused ones.
 */
export async function pruneTrashedImport(options: PruneOptions): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to prune trashed objects.");
  const token = (process.env.NOTION_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("NOTION_TOKEN is required to check which objects Notion has in its trash.");
  }

  const apiBase = (process.env.NOTION_API_BASE ?? DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
  const notion = new NotionClient(token, apiBase);
  const client = new Client({ connectionString, application_name: "kbs-notion-prune" });
  await client.connect();

  try {
    const mapped = (
      await client.query<{
        notion_id: string;
        kind: string;
        kbs_id: string;
        label: string;
      }>("SELECT notion_id, kind, kbs_id, label FROM notion_objects ORDER BY kind, label")
    ).rows;

    if (mapped.length === 0) {
      console.log(
        "No Notion ids are recorded in this database, so there is nothing to compare with Notion's trash. Run the import first.",
      );
      return;
    }

    const idsOf = (kind: string) =>
      mapped.filter((row) => row.kind === kind).map((row) => row.kbs_id);
    const livePages = await pageIdsByTrashState(client, idsOf("page"), false);
    const trashedPages = await pageIdsByTrashState(client, idsOf("page"), true);
    const liveRecords = await existingRowIds(client, "database_records", idsOf("record"));
    const liveDatabases = await existingRowIds(client, "databases", idsOf("database"));

    console.log(`Checking ${mapped.length} recorded Notion object(s) against Notion's trash…`);
    const candidates: TrashedCandidate[] = [];
    let alreadyTrashed = 0;
    let alreadyGone = 0;
    let checked = 0;

    for (const row of mapped) {
      if (row.kind !== "page" && row.kind !== "record" && row.kind !== "database") continue;
      const kind = row.kind;
      const stored =
        kind === "page"
          ? livePages.has(row.kbs_id)
          : kind === "record"
            ? liveRecords.has(row.kbs_id)
            : liveDatabases.has(row.kbs_id);
      if (!stored) {
        if (kind === "page" && trashedPages.has(row.kbs_id)) alreadyTrashed += 1;
        else alreadyGone += 1;
        continue;
      }

      const label = await notionTrashLabel(notion, kind, row.notion_id);
      checked += 1;
      if (checked % 25 === 0) console.log(`  ${checked} checked…`);
      if (label === null) continue;
      candidates.push({
        kind,
        notionId: row.notion_id,
        kbsId: row.kbs_id,
        label: label || row.label,
      });
    }

    // A trashed database takes its records with it, and a removed record takes
    // its page to the KBS trash. The grouping page of a database goes too, so
    // the sidebar never points at a database that no longer exists.
    const removeRecords = new Set<string>();
    const removeDatabases = new Set<string>();
    const trashPages = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.kind === "page") trashPages.add(candidate.kbsId);
      else if (candidate.kind === "record") removeRecords.add(candidate.kbsId);
      else removeDatabases.add(candidate.kbsId);
    }

    if (removeDatabases.size > 0) {
      const databaseIds = [...removeDatabases];
      const grouped = await client.query<{ page_id: string | null }>(
        "SELECT page_id FROM databases WHERE id = ANY($1::uuid[])",
        [databaseIds],
      );
      for (const row of grouped.rows) if (row.page_id) trashPages.add(row.page_id);

      const records = await client.query<{ id: string; page_id: string | null }>(
        "SELECT id, page_id FROM database_records WHERE database_id = ANY($1::uuid[])",
        [databaseIds],
      );
      for (const row of records.rows) {
        removeRecords.add(row.id);
        if (row.page_id) trashPages.add(row.page_id);
      }
    }

    if (removeRecords.size > 0) {
      const records = await client.query<{ page_id: string | null }>(
        "SELECT page_id FROM database_records WHERE id = ANY($1::uuid[])",
        [[...removeRecords]],
      );
      for (const row of records.rows) if (row.page_id) trashPages.add(row.page_id);
    }

    const lines = [
      "",
      options.dryRun ? "Notion → KBS prune (dry run)" : "Notion → KBS prune",
      `  recorded Notion ids:  ${mapped.length}`,
      `  trashed in Notion:    ${candidates.length}`,
      `  pages to trash:       ${trashPages.size}`,
      `  records to remove:    ${removeRecords.size}`,
      `  databases to remove:  ${removeDatabases.size}`,
      `  already in trash:     ${alreadyTrashed}`,
      `  no longer in KBS:     ${alreadyGone}`,
    ];

    if (candidates.length > 0) {
      lines.push("", "Would remove:");
      for (const candidate of candidates.slice(0, 20)) {
        lines.push(`  - ${candidate.kind} "${candidate.label}"`);
      }
      if (candidates.length > 20) lines.push(`  - … and ${candidates.length - 20} more`);
    }

    if (candidates.length === 0) {
      lines.push("", "Nothing to prune: no recorded object is in Notion's trash.");
      console.log(lines.join("\n"));
      return;
    }

    if (options.dryRun) {
      lines.push("", "Dry run: nothing was removed.");
      console.log(lines.join("\n"));
      return;
    }

    console.log(lines.join("\n"));
    if (!options.yes) await confirmPrune();

    const databaseName = await currentDatabaseName(client);
    const removed: Record<string, number> = {};
    const forgottenIds = [...new Set([...trashPages, ...removeRecords, ...removeDatabases])];
    let manifestFile: string | null = null;
    await client.query("BEGIN");
    try {
      // Captured inside the same transaction as the delete, so the manifest
      // describes exactly the rows this run is about to remove.
      const capture = await capturePrunedRows(client, {
        databases: [...removeDatabases],
        records: [...removeRecords],
        pages: [...trashPages],
      });
      removed.notionObjects = await deleteNotionObjects(client, forgottenIds);
      removed.records = await deleteIdRows(client, "database_records", [...removeRecords]);
      removed.databases = await deleteIdRows(client, "databases", [...removeDatabases]);
      removed.pages = await trashPageRows(client, [...trashPages]);
      manifestFile = await savePruneManifest({ databaseName, candidates, capture });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (manifestFile) await rm(manifestFile, { force: true });
      throw error;
    }

    console.log(
      [
        "",
        "Pruned:",
        `  pages:        ${removed.pages} moved to the KBS trash`,
        `  records:      ${removed.records} removed`,
        `  databases:    ${removed.databases} removed`,
        `  notion ids:   ${removed.notionObjects} forgotten`,
        "",
        `Prune manifest: ${manifestFile}`,
        `Restore it with: npm run import:notion -- --restore "${manifestFile}"`,
        "Attachment files are kept until a trashed page is permanently deleted.",
      ].join("\n"),
    );
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Prune manifest and restore
// ---------------------------------------------------------------------------

const PRUNE_MANIFEST_FORMAT = "kbs-prune-manifest";
const PRUNE_MANIFEST_VERSION = 1;

type PrunedPage = { id: string; updatedAt: string };

type PruneManifestRows = {
  databases: Json[];
  databaseProperties: Json[];
  databaseViews: Json[];
  databaseTemplates: Json[];
  databaseRecords: Json[];
  databaseRecordRelations: Json[];
  pageRecordLinks: Json[];
  notionObjects: Json[];
};

type PruneTotals = {
  pages: number;
  databases: number;
  properties: number;
  views: number;
  templates: number;
  records: number;
  relations: number;
  pageLinks: number;
  notionObjects: number;
};

/**
 * Everything a `--prune-trashed` run removed, row by row, plus the pages it
 * soft-deleted and the `notion_objects` ids it forgot. Replaying it with
 * `--restore` puts the rows back and un-trashes the pages.
 */
type PruneManifest = {
  format: typeof PRUNE_MANIFEST_FORMAT;
  version: typeof PRUNE_MANIFEST_VERSION;
  kind: "notion";
  createdAt: string;
  database: string;
  candidates: TrashedCandidate[];
  pages: PrunedPage[];
  rows: PruneManifestRows;
  totals: PruneTotals;
  restoredAt?: string;
  restored?: Record<string, number>;
};

type PruneCapture = { pages: PrunedPage[]; rows: PruneManifestRows };

type RestoreOptions = { dryRun: boolean; force: boolean };

function defaultPruneManifestPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  return path.join(manifestDirectory(), `notion-prune-${stamp}.json`);
}

/**
 * Snapshots every row the prune is about to remove. A deleted database takes
 * its properties, views, templates, records and relations with it, and a
 * deleted record takes its relations and page links, so those are captured
 * through the ids the delete will cascade to.
 */
async function capturePrunedRows(
  client: Client,
  targets: { databases: string[]; records: string[]; pages: string[] },
): Promise<PruneCapture> {
  const select = async (sql: string, parameters: unknown[]): Promise<Json[]> =>
    (await client.query(sql, parameters)).rows as Json[];

  const pageRows = await client.query<{ id: string; updated_at: Date }>(
    "SELECT id, updated_at FROM pages WHERE id = ANY($1::uuid[]) ORDER BY id",
    [targets.pages],
  );
  const databases = await select(
    "SELECT * FROM databases WHERE id = ANY($1::uuid[]) ORDER BY id",
    [targets.databases],
  );
  const properties = await select(
    "SELECT * FROM database_properties WHERE database_id = ANY($1::uuid[]) ORDER BY id",
    [targets.databases],
  );
  const views = await select(
    "SELECT * FROM database_views WHERE database_id = ANY($1::uuid[]) ORDER BY id",
    [targets.databases],
  );
  const templates = await select(
    "SELECT * FROM database_templates WHERE database_id = ANY($1::uuid[]) ORDER BY id",
    [targets.databases],
  );
  const records = await select(
    `SELECT * FROM database_records
     WHERE database_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])
     ORDER BY id`,
    [targets.databases, targets.records],
  );

  const recordIds = records.map((row) => String(row.id));
  const propertyIds = properties.map((row) => String(row.id));
  const relations = await select(
    `SELECT * FROM database_record_relations
     WHERE property_id = ANY($1::uuid[])
        OR source_record_id = ANY($2::uuid[])
        OR target_record_id = ANY($2::uuid[])
     ORDER BY source_record_id, property_id, target_record_id`,
    [propertyIds, recordIds],
  );
  const pageLinks = await select(
    "SELECT * FROM page_record_links WHERE record_id = ANY($1::uuid[]) ORDER BY page_id, record_id",
    [recordIds],
  );
  const notionObjects = await select(
    "SELECT * FROM notion_objects WHERE kbs_id = ANY($1::uuid[]) ORDER BY notion_id",
    [[...targets.pages, ...recordIds, ...targets.databases]],
  );

  return {
    pages: pageRows.rows.map((row) => ({ id: row.id, updatedAt: row.updated_at.toISOString() })),
    rows: {
      databases,
      databaseProperties: properties,
      databaseViews: views,
      databaseTemplates: templates,
      databaseRecords: records,
      databaseRecordRelations: relations,
      pageRecordLinks: pageLinks,
      notionObjects,
    },
  };
}

function pruneTotals(capture: PruneCapture): PruneTotals {
  return {
    pages: capture.pages.length,
    databases: capture.rows.databases.length,
    properties: capture.rows.databaseProperties.length,
    views: capture.rows.databaseViews.length,
    templates: capture.rows.databaseTemplates.length,
    records: capture.rows.databaseRecords.length,
    relations: capture.rows.databaseRecordRelations.length,
    pageLinks: capture.rows.pageRecordLinks.length,
    notionObjects: capture.rows.notionObjects.length,
  };
}

async function savePruneManifest(input: {
  databaseName: string;
  candidates: TrashedCandidate[];
  capture: PruneCapture;
}): Promise<string> {
  const manifest: PruneManifest = {
    format: PRUNE_MANIFEST_FORMAT,
    version: PRUNE_MANIFEST_VERSION,
    kind: "notion",
    createdAt: new Date().toISOString(),
    database: input.databaseName,
    candidates: input.candidates,
    pages: input.capture.pages,
    rows: input.capture.rows,
    totals: pruneTotals(input.capture),
  };
  const file = defaultPruneManifestPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return file;
}

function asJsonRows(value: unknown): Json[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => asRecord(entry))
    .filter((row) => Object.keys(row).length > 0);
}

function numberField(value: Json, key: string): number {
  return typeof value[key] === "number" ? (value[key] as number) : 0;
}

async function readPruneManifest(file: string): Promise<PruneManifest> {
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `Could not read the prune manifest at ${file}. Pass the path printed at the end of --prune-trashed.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${file} is not valid JSON.`);
  }

  const value = asRecord(parsed);
  if (value.format !== PRUNE_MANIFEST_FORMAT) {
    throw new Error(`${file} is not a KBS prune manifest.`);
  }
  if (value.version !== PRUNE_MANIFEST_VERSION) {
    throw new Error(
      `${file} uses prune manifest version ${String(value.version)}, but this importer only understands version ${PRUNE_MANIFEST_VERSION}.`,
    );
  }

  const rows = asRecord(value.rows);
  const totals = asRecord(value.totals);
  const restoredAt = asString(value.restoredAt);
  const restored = asRecord(value.restored);
  const pages = (Array.isArray(value.pages) ? value.pages : [])
    .map((entry) => asRecord(entry))
    .map((page) => ({ id: asString(page.id), updatedAt: asString(page.updatedAt) }))
    .filter((page) => page.id && page.updatedAt);
  const candidates = (Array.isArray(value.candidates) ? value.candidates : [])
    .map((entry) => asRecord(entry))
    .map((candidate) => ({
      kind: asString(candidate.kind) as TrashedCandidate["kind"],
      notionId: asString(candidate.notionId),
      kbsId: asString(candidate.kbsId),
      label: asString(candidate.label),
    }))
    .filter(
      (candidate) =>
        candidate.kind === "page"
        || candidate.kind === "record"
        || candidate.kind === "database",
    )
    .filter((candidate) => candidate.kbsId);

  return {
    format: PRUNE_MANIFEST_FORMAT,
    version: PRUNE_MANIFEST_VERSION,
    kind: "notion",
    createdAt: asString(value.createdAt),
    database: asString(value.database),
    candidates,
    pages,
    rows: {
      databases: asJsonRows(rows.databases),
      databaseProperties: asJsonRows(rows.databaseProperties),
      databaseViews: asJsonRows(rows.databaseViews),
      databaseTemplates: asJsonRows(rows.databaseTemplates),
      databaseRecords: asJsonRows(rows.databaseRecords),
      databaseRecordRelations: asJsonRows(rows.databaseRecordRelations),
      pageRecordLinks: asJsonRows(rows.pageRecordLinks),
      notionObjects: asJsonRows(rows.notionObjects),
    },
    totals: {
      pages: numberField(totals, "pages"),
      databases: numberField(totals, "databases"),
      properties: numberField(totals, "properties"),
      views: numberField(totals, "views"),
      templates: numberField(totals, "templates"),
      records: numberField(totals, "records"),
      relations: numberField(totals, "relations"),
      pageLinks: numberField(totals, "pageLinks"),
      notionObjects: numberField(totals, "notionObjects"),
    },
    ...(restoredAt ? { restoredAt } : {}),
    ...(Object.keys(restored).length > 0
      ? {
          restored: Object.fromEntries(
            Object.entries(restored).map(([key, count]) => [
              key,
              typeof count === "number" ? count : 0,
            ]),
          ),
        }
      : {}),
  };
}

function describePruneManifest(manifest: PruneManifest): string {
  const totals = manifest.totals;
  return [
    `Prune manifest for database "${manifest.database}", recorded ${manifest.createdAt}`,
    `  pages:        ${totals.pages} to un-trash`,
    `  databases:    ${totals.databases} (${totals.properties} properties, ${totals.views} views, ${totals.templates} templates)`,
    `  records:      ${totals.records}`,
    `  relations:    ${totals.relations} (${totals.pageLinks} page links)`,
    `  notion ids:   ${totals.notionObjects}`,
  ].join("\n");
}

/** Inserts captured rows, keeping any row that already exists. */
async function insertJsonRows(client: Client, table: string, rows: Json[]): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const batch of batches(rows, 500)) {
    const result = await client.query(
      `INSERT INTO "${table}"
       SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(batch)],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/** Un-trashes the pages and puts their pre-prune timestamps back. */
async function untrashPageRows(client: Client, pages: PrunedPage[]): Promise<number> {
  if (pages.length === 0) return 0;
  const result = await client.query(
    `UPDATE pages AS page
     SET deleted_at = NULL, updated_at = doomed.updated_at
     FROM unnest($1::uuid[], $2::timestamptz[]) AS doomed(id, updated_at)
     WHERE page.id = doomed.id AND page.deleted_at IS NOT NULL`,
    [pages.map((page) => page.id), pages.map((page) => page.updatedAt)],
  );
  return result.rowCount ?? 0;
}

/**
 * Puts back what a `--prune-trashed` run removed: the captured database,
 * property, view, template, record, relation and page-link rows, the Notion ids
 * it forgot, and the pages it soft-deleted. Rows that already exist (a
 * re-import, or a manual recreate) are kept as they are, so the manifest never
 * overwrites newer work.
 *
 * A page the user permanently deleted from KBS's trash cannot be un-trashed.
 * Its records are restored without a page rather than failing the whole run,
 * and the missing count is reported.
 */
export async function restorePrunedImport(
  manifestArgument: string,
  options: RestoreOptions,
): Promise<void> {
  const file = path.resolve(process.cwd(), manifestArgument);
  const manifest = await readPruneManifest(file);
  if (manifest.restoredAt) {
    throw new Error(`${file} was already restored at ${manifest.restoredAt}. Nothing was changed.`);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to restore a prune.");

  const client = new Client({ connectionString, application_name: "kbs-notion-restore" });
  await client.connect();

  try {
    const databaseName = await currentDatabaseName(client);
    if (manifest.database && databaseName && manifest.database !== databaseName && !options.force) {
      throw new Error(
        `That prune manifest was recorded against database "${manifest.database}", but DATABASE_URL points at "${databaseName}". Nothing was changed; pass --force to restore anyway.`,
      );
    }

    console.log(describePruneManifest(manifest));
    const capturedPages = manifest.pages.map((page) => page.id);
    const existingPages = await existingRowIds(client, "pages", capturedPages);
    const missingPages = capturedPages.length - existingPages.size;

    if (options.dryRun) {
      if (missingPages > 0) {
        console.log(
          `\n${missingPages} page(s) were permanently deleted from the KBS trash and cannot be un-trashed.`,
        );
      }
      console.log("\nDry run: nothing was restored.");
      return;
    }

    const rows = manifest.rows;
    // A row whose page no longer exists is restored without it, so the foreign
    // key stays valid instead of failing the whole manifest.
    const keepPage = (row: Json): Json =>
      row.page_id && !existingPages.has(String(row.page_id))
        ? { ...row, page_id: null }
        : row;
    const databases = rows.databases.map(keepPage);
    const records = rows.databaseRecords.map(keepPage);
    const linkPageIds = rows.pageRecordLinks.map((row) => String(row.page_id));
    const linkedPages = await existingRowIds(client, "pages", linkPageIds);
    const pageLinks = rows.pageRecordLinks.filter((row) => linkedPages.has(String(row.page_id)));
    // A page purged from the trash keeps no Notion id either: the map exists to
    // find stored rows, and that page is no longer one.
    const notionObjects = rows.notionObjects.filter(
      (row) => asString(row.kind) !== "page" || existingPages.has(String(row.kbs_id)),
    );

    const restored: Record<string, number> = {};
    await client.query("BEGIN");
    try {
      restored.databases = await insertJsonRows(client, "databases", databases);
      restored.properties = await insertJsonRows(
        client,
        "database_properties",
        rows.databaseProperties,
      );
      restored.views = await insertJsonRows(client, "database_views", rows.databaseViews);
      restored.templates = await insertJsonRows(
        client,
        "database_templates",
        rows.databaseTemplates,
      );
      restored.records = await insertJsonRows(client, "database_records", records);
      restored.relations = await insertJsonRows(
        client,
        "database_record_relations",
        rows.databaseRecordRelations,
      );
      restored.pageLinks = await insertJsonRows(client, "page_record_links", pageLinks);
      restored.notionObjects = await insertJsonRows(client, "notion_objects", notionObjects);
      restored.pages = await untrashPageRows(client, manifest.pages);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    manifest.restoredAt = new Date().toISOString();
    manifest.restored = restored;
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const summary = ["", "Restored:"];
    const counts: { label: string; count: number; total: number }[] = [
      { label: "pages", count: restored.pages, total: manifest.totals.pages },
      { label: "databases", count: restored.databases, total: manifest.totals.databases },
      { label: "properties", count: restored.properties, total: manifest.totals.properties },
      { label: "views", count: restored.views, total: manifest.totals.views },
      { label: "templates", count: restored.templates, total: manifest.totals.templates },
      { label: "records", count: restored.records, total: manifest.totals.records },
      { label: "relations", count: restored.relations, total: manifest.totals.relations },
      { label: "page links", count: restored.pageLinks, total: manifest.totals.pageLinks },
      { label: "notion ids", count: restored.notionObjects, total: manifest.totals.notionObjects },
    ];
    for (const entry of counts) {
      if (entry.total === 0) continue;
      const suffix = entry.label === "pages" ? " un-trashed" : "";
      summary.push(`  ${`${entry.label}:`.padEnd(14)} ${entry.count} of ${entry.total}${suffix}`);
    }
    if (missingPages > 0) {
      summary.push(
        `  ${"purged pages:".padEnd(14)} ${missingPages} (deleted from Trash; not restored)`,
      );
    }
    summary.push(`  ${"manifest:".padEnd(14)} ${file} (marked restored)`);
    console.log(summary.join("\n"));
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Notion → KBS import

Usage:
  npm run import:notion -- [options]

Options:
  --root <id-or-url>   Import one Notion page, database or data source. Repeatable.
                       Defaults to NOTION_ROOT_IDS, then to every top-level page
                       and database shared with the integration.
  --merge              Add to a workspace that already has pages. Objects that
                       already exist are left as they are.
  --dry-run            Fetch and convert everything, then report. Writes no
                       rows and no files.
  --dump <file>        Also write the converted workspace to a JSON file for
                       review. Combine with --dry-run to skip the database.
  --verify             Fetch Notion and check that every page, database,
                       property, record, relation and file the import would
                       create is present in KBS (and that stored files still
                       have the right size). Writes nothing; exits non-zero
                       when anything is missing or different.
  --retry-files        Re-download the Notion-hosted images and documents an
                       earlier run left as Notion links. Fetches only attachment
                       ids that are missing from KBS, writes them, and repoints
                       the pages, covers and file properties that still hold
                       the Notion URL. Video and audio blocks are always links
                       and are not retried. Records what it stores in a
                       manifest so --undo can put those links back. Exits
                       non-zero when a file still cannot be stored.
  --update             Refresh an existing import in place from Notion: page
                       bodies, titles, icons and covers, record titles and
                       property values, and database names. Only rows Notion
                       edited after their stored timestamp are touched, and
                       nothing is inserted, so it cannot duplicate a page or
                       record. Reports every change by count and records the
                       properties, views, links, relations and files it adds in
                       a manifest so --undo can remove them.
  --prune-trashed      Remove the pages, records and databases Notion has moved
                       to its trash, using the Notion ids the import stored.
                       Pages go to KBS's trash and can be restored; record and
                       database rows are removed and recorded in a prune
                       manifest. Add --dry-run to preview what would go, and
                       --yes to skip the typed confirmation.
  --restore <manifest> Put back exactly what a --prune-trashed run removed:
                       un-trash its pages and re-insert its databases,
                       properties, views, templates, records, relations and
                       Notion ids. Rows that already exist are kept. Add
                       --dry-run to preview.
  --manifest <file>    Where to write this run's manifest. Defaults to
                       data/import-manifests/notion-<timestamp>.json (or to
                       IMPORT_MANIFEST_DIR when that is set). It lists every
                       row and file the run created.
  --undo <manifest>    Delete exactly the rows and files that run created and
                       mark the manifest undone. Add --dry-run to preview.
  --yes                Skip the typed confirmation for --undo or
                       --prune-trashed.
  --force              Undo or restore even if the manifest names another
                       database.
  --help               Show this message.

Environment:
  NOTION_TOKEN         Required. Internal integration secret from
                       https://www.notion.so/my-integrations.
  NOTION_ROOT_IDS      Optional roots, comma- or space-separated.
  DATABASE_URL         KBS connection string (required unless --dry-run;
                       also required by --verify, --retry-files, --update,
                       --prune-trashed and --restore).
  ATTACHMENTS_DIR      Defaults to data/attachments.
  IMPORT_MANIFEST_DIR  Where default manifests are written. Defaults to
                       data/import-manifests.

Before importing, run \`npm run db:migrate\` so the schema is current. Import into
an empty workspace unless you pass --merge.

Every run that adds rows or files writes a manifest of exactly what it added.
Keep it until the result looks right: --undo <manifest> deletes those rows and
the files nothing else uses, so a run can be reverted or retried.`;

type CliOptions = ImportOptions & {
  help: boolean;
  pruneTrashed: boolean;
  restorePath: string | null;
};

function parseOptions(argv: string[]): CliOptions {
  const roots: string[] = [];
  let merge = false;
  let dryRun = false;
  let verify = false;
  let retryFiles = false;
  let update = false;
  let dumpPath: string | null = null;
  let manifestPath: string | null = null;
  let undoPath: string | null = null;
  let restorePath: string | null = null;
  let yes = false;
  let force = false;
  let pruneTrashed = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--merge") {
      merge = true;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--verify") {
      verify = true;
    } else if (argument === "--retry-files") {
      retryFiles = true;
    } else if (argument === "--update") {
      update = true;
    } else if (argument === "--prune-trashed") {
      pruneTrashed = true;
    } else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root needs a Notion page, database or data source id.");
      roots.push(normalizeNotionId(value));
      index += 1;
    } else if (argument.startsWith("--root=")) {
      roots.push(normalizeNotionId(argument.slice("--root=".length)));
    } else if (argument === "--dump") {
      const value = argv[index + 1];
      if (!value) throw new Error("--dump needs a file path.");
      dumpPath = value;
      index += 1;
    } else if (argument.startsWith("--dump=")) {
      dumpPath = argument.slice("--dump=".length);
    } else if (argument === "--manifest") {
      const value = argv[index + 1];
      if (!value) throw new Error("--manifest needs a file path.");
      manifestPath = value;
      index += 1;
    } else if (argument.startsWith("--manifest=")) {
      manifestPath = argument.slice("--manifest=".length);
    } else if (argument === "--undo") {
      const value = argv[index + 1];
      if (!value) throw new Error("--undo needs the path of a manifest written by an import.");
      undoPath = value;
      index += 1;
    } else if (argument.startsWith("--undo=")) {
      undoPath = argument.slice("--undo=".length);
    } else if (argument === "--restore") {
      const value = argv[index + 1];
      if (!value) throw new Error("--restore needs the path of a manifest written by --prune-trashed.");
      restorePath = value;
      index += 1;
    } else if (argument.startsWith("--restore=")) {
      restorePath = argument.slice("--restore=".length);
    } else if (argument === "--yes") {
      yes = true;
    } else if (argument === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown option: ${argument}\n\n${USAGE}`);
    }
  }

  const fromEnvironment = (process.env.NOTION_ROOT_IDS ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeNotionId);

  return {
    roots: [...new Set([...roots, ...fromEnvironment])],
    merge,
    dryRun,
    verify,
    retryFiles,
    update,
    dumpPath,
    manifestPath,
    undoPath,
    yes,
    force,
    pruneTrashed,
    restorePath,
    help,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (options.pruneTrashed) {
    if (
      options.roots.length > 0
      || options.merge
      || options.verify
      || options.retryFiles
      || options.update
      || options.undoPath
      || options.restorePath
      || options.dumpPath
      || options.manifestPath
      || options.force
    ) {
      throw new Error(
        "--prune-trashed acts on what Notion trashed, so it cannot be combined with --root, --merge, --verify, --retry-files, --update, --undo, --restore, --dump, --manifest or --force.",
      );
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required to prune trashed objects.");
    }
    await pruneTrashedImport({ dryRun: options.dryRun, yes: options.yes });
    return;
  }

  if (options.restorePath) {
    if (
      options.roots.length > 0
      || options.merge
      || options.verify
      || options.retryFiles
      || options.update
      || options.undoPath
      || options.pruneTrashed
      || options.dumpPath
      || options.manifestPath
    ) {
      throw new Error(
        "--restore replays a prune manifest, so it cannot be combined with import options (--root, --merge, --verify, --retry-files, --update, --undo, --prune-trashed, --dump, --manifest).",
      );
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required to restore a prune.");
    }
    await restorePrunedImport(options.restorePath, {
      dryRun: options.dryRun,
      force: options.force,
    });
    return;
  }

  if (options.undoPath) {
    if (
      options.roots.length > 0
      || options.merge
      || options.verify
      || options.retryFiles
      || options.update
      || options.pruneTrashed
      || options.restorePath
      || options.dumpPath
      || options.manifestPath
    ) {
      throw new Error(
        "--undo cannot be combined with import options (--root, --merge, --verify, --retry-files, --update, --prune-trashed, --restore, --dump, --manifest).",
      );
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required to undo an import.");
    }
    await undoImport(options.undoPath, {
      yes: options.yes,
      dryRun: options.dryRun,
      force: options.force,
    });
    return;
  }

  if (options.yes || options.force) {
    throw new Error(
      "--yes is only used with --undo or --prune-trashed, and --force only with --undo or --restore.",
    );
  }

  if (options.verify && (options.merge || options.dryRun || options.dumpPath || options.manifestPath)) {
    throw new Error(
      "--verify checks what is already in KBS, so it cannot be combined with --merge, --dry-run, --dump or --manifest.",
    );
  }

  if (
    options.retryFiles
    && (options.merge || options.dryRun || options.verify || options.update || options.dumpPath || options.manifestPath)
  ) {
    throw new Error(
      "--retry-files stores the missing files itself, so it cannot be combined with --merge, --dry-run, --verify, --update, --dump or --manifest.",
    );
  }

  if (
    options.update
    && (options.merge || options.dryRun || options.verify || options.dumpPath || options.manifestPath)
  ) {
    throw new Error(
      "--update refreshes rows an import created, so it cannot be combined with --merge, --dry-run, --verify, --dump or --manifest.",
    );
  }

  const token = (process.env.NOTION_TOKEN ?? "").trim();
  if (!token) {
    throw new Error(
      "NOTION_TOKEN is required. Create an internal integration, share the pages with it, and export the secret.",
    );
  }

  if (!options.dryRun && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required unless --dry-run is used.");
  }

  const apiBase = (process.env.NOTION_API_BASE ?? DEFAULT_API_BASE).trim() || DEFAULT_API_BASE;
  const importer = new NotionImporter(new NotionClient(token, apiBase), options);
  await importer.run();
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    console.error(`Notion import failed: ${messageOf(error)}`);
    process.exitCode = 1;
  });
}
