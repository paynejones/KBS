import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LinkPreviewMetadata } from "@/db/schema";

export type LinkPreview = LinkPreviewMetadata;

export type PreviewFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ResolveHost = (hostname: string) => Promise<{ address: string }[]>;

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 4000;
const USER_AGENT = "KBS link preview";

const TAG_PATTERN = /<(meta|link)\b([^>]*)>/gi;
const ATTRIBUTE_PATTERN = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * The server reads pages people capture, so every hop must land on a public
 * address. Loopback, private ranges, link-local metadata endpoints, and
 * hostnames that resolve to one of those are refused before any request goes
 * out — including after a redirect.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4) return false;
    if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
    const [first, second] = octets;
    if (first === 0 || first === 10 || first === 127) return false;
    if (first === 169 && second === 254) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && (second === 168 || second === 0)) return false;
    if (first === 100 && second >= 64 && second <= 127) return false;
    if (first === 198 && (second === 18 || second === 19)) return false;
    if (first >= 224) return false;
    return true;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return false;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
    if (normalized.startsWith("ff")) return false;
    return true;
  }
  return false;
}

async function defaultResolve(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

const PRIVATE_HOSTNAMES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Returns the target when it is an HTTP(S) URL that resolves to public addresses only. */
export async function resolvePublicUrl(raw: string, resolve: ResolveHost = defaultResolve): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) return null;
  if (hostname === "localhost" || PRIVATE_HOSTNAMES.some((suffix) => hostname.endsWith(suffix))) return null;
  if (isIP(hostname)) return isPublicAddress(hostname) ? url : null;

  let addresses: { address: string }[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return null;
  }
  if (addresses.length === 0) return null;
  return addresses.every((entry) => isPublicAddress(entry.address)) ? url : null;
}

function attributes(raw: string) {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (name in result) continue;
    result[name] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return result;
}

function cleanText(value: string | undefined, limit: number) {
  if (!value) return null;
  const text = decodeEntities(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const clipped = text.slice(0, limit).trim();
  return clipped || null;
}

function absoluteUrl(value: string | undefined, base: string) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Reads the metadata a page offers to link previews, preferring Open Graph and
 * Twitter tags over the plain document title. Relative image and icon URLs are
 * resolved against the page that was actually fetched.
 */
export function extractLinkPreview(html: string, baseUrl: string): LinkPreview {
  const meta: Record<string, string> = {};
  let iconHref: string | undefined;
  let touchIconHref: string | undefined;

  for (const match of html.matchAll(TAG_PATTERN)) {
    const attrs = attributes(match[2]);
    if (match[1].toLowerCase() === "meta") {
      const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").trim().toLowerCase();
      const content = (attrs.content ?? "").trim();
      if (key && content && !(key in meta)) meta[key] = content;
      continue;
    }
    const rel = (attrs.rel ?? "").toLowerCase();
    const href = (attrs.href ?? "").trim();
    if (!href) continue;
    if (rel.split(/\s+/).includes("apple-touch-icon")) {
      touchIconHref ??= href;
    } else if (rel.split(/\s+/).includes("icon")) {
      iconHref ??= href;
    }
  }

  const metaValue = (...keys: string[]) => keys.map((key) => meta[key]).find((value) => Boolean(value));
  const documentTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  return {
    title: cleanText(metaValue("og:title", "twitter:title", "title"), 300) ?? cleanText(documentTitle, 300),
    description: cleanText(metaValue("og:description", "twitter:description", "description"), 500),
    siteName: cleanText(metaValue("og:site_name", "application-name"), 120),
    imageUrl: absoluteUrl(metaValue("og:image:url", "og:image", "twitter:image", "twitter:image:src"), baseUrl),
    faviconUrl: absoluteUrl(iconHref ?? touchIconHref ?? "/favicon.ico", baseUrl),
  };
}

async function readLimited(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = MAX_BYTES - total;
      chunks.push(value.byteLength > remaining ? value.subarray(0, remaining) : value);
      total += Math.min(value.byteLength, remaining);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * Fetches a captured URL and returns what the page says about itself. Every
 * failure — offline, refused target, non-HTML, timeout — returns null so a
 * capture always succeeds, just without a preview.
 */
export async function fetchLinkPreview(
  raw: string,
  options: { fetchImpl?: PreviewFetch; resolve?: ResolveHost; timeoutMs?: number } = {},
): Promise<LinkPreview | null> {
  const fetcher: PreviewFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const resolve = options.resolve ?? defaultResolve;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  let target = await resolvePublicUrl(raw, resolve);
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetcher(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return null;
        target = await resolvePublicUrl(new URL(location, target).toString(), resolve);
        if (!target) return null;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      return extractLinkPreview(await readLimited(response), target.toString());
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
