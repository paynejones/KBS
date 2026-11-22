"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import {
  THEMES,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  type Theme,
} from "@/lib/theme";

let volatileTheme: Theme = "light";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function getThemeSnapshot(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(saved) ? saved : "light";
  } catch {
    return volatileTheme;
  }
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

export function ThemePicker() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function changeTheme(value: string) {
    if (!isTheme(value)) return;
    volatileTheme = value;
    applyTheme(value);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // The selected theme still applies for this session.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <label className="flex shrink-0 items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm text-muted-foreground">
      <Palette size={15} aria-hidden="true" />
      <span className="size-2 rounded-full bg-primary ring-2 ring-primary/15" aria-hidden="true" />
      <span className="sr-only">Color theme</span>
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => changeTheme(event.target.value)}
        className="max-w-28 bg-transparent text-foreground outline-none sm:max-w-none"
      >
        {THEMES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
