const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Turns what someone typed into a link target. Bare domains get `https://`,
 * site-relative paths and `#fragment` links pass through, and unsafe schemes
 * (`javascript:`, `data:`, protocol-relative `//host`) are rejected before
 * anything reaches the editor.
 */
export function normalizeLinkHref(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith("#")) return raw;
  if (raw.startsWith("/")) return raw.startsWith("//") ? null : raw;

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol === "mailto:" || url.protocol === "tel:") {
      return raw.slice(raw.indexOf(":") + 1).trim() ? url.toString() : null;
    }
    return url.hostname ? url.toString() : null;
  }

  try {
    const url = new URL(`https://${raw}`);
    return url.hostname.includes(".") || url.hostname === "localhost" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Returns the target page ID when a link points at an in-app page
 * (`/pages/<id>`), so the link panel can show the page instead of its path.
 */
export function pageIdFromLinkHref(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const match = /^\/pages\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
    input.trim(),
  );
  return match ? match[1].toLowerCase() : null;
}
