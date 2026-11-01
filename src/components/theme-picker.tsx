"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

const themes = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "warm", label: "Warm paper" },
  { value: "forest", label: "Forest" },
] as const;

type Theme = (typeof themes)[number]["value"];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem("kbs:theme");
    } catch {
      // Keep the default theme when browser storage is unavailable.
    }
    const initial = themes.some((candidate) => candidate.value === saved)
      ? (saved as Theme)
      : "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function changeTheme(value: string) {
    if (!themes.some((candidate) => candidate.value === value)) return;
    const nextTheme = value as Theme;
    setTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem("kbs:theme", nextTheme);
    } catch {
      // The selected theme still applies for this session.
    }
  }

  return (
    <label className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm text-muted-foreground">
      <Palette size={15} aria-hidden="true" />
      <span className="sr-only">Color theme</span>
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => changeTheme(event.target.value)}
        className="max-w-28 bg-transparent text-foreground outline-none sm:max-w-none"
      >
        {themes.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
