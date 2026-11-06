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
