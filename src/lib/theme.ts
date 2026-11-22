/**
 * The theme list, in the order the picker shows it. Both the client picker and
 * the pre-hydration script read from here so a new palette cannot be added to
 * one and forgotten in the other.
 */
export const THEMES = [
  { value: "light", label: "Light", dark: false },
  { value: "dark", label: "Dark", dark: true },
  { value: "warm", label: "Warm paper", dark: false },
  { value: "forest", label: "Forest", dark: false },
  { value: "slate", label: "Slate", dark: false },
  { value: "rose", label: "Rose", dark: false },
  { value: "midnight", label: "Midnight", dark: true },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

export const THEME_VALUES: readonly Theme[] = THEMES.map((theme) => theme.value);

/** Dark palettes also get the `.dark` class so dark-only utilities follow them. */
export const DARK_THEMES: ReadonlySet<Theme> = new Set(
  THEMES.filter((theme) => theme.dark).map((theme) => theme.value),
);

export const THEME_STORAGE_KEY = "kbs:theme";
export const THEME_CHANGE_EVENT = "kbs:theme-change";

export function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_VALUES.some((theme) => theme === value);
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  root.classList.toggle("dark", DARK_THEMES.has(theme));
}

/**
 * The saved theme has to be applied before first paint, which means an inline
 * script rather than a bundle. This generator keeps that script derived from
 * `THEMES`/`DARK_THEMES` instead of a hand-written copy, so the allowlist
 * always matches the themes the app actually ships.
 */
export function themeInitializationScript(): string {
  return `try {
  const theme = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (${JSON.stringify(THEME_VALUES)}.includes(theme)) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", ${JSON.stringify([...DARK_THEMES])}.includes(theme));
  }
} catch {}`;
}
