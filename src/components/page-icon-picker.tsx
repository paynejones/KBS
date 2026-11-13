"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

const PAGE_ICONS = [
  { emoji: "📄", label: "Page" },
  { emoji: "📝", label: "Note" },
  { emoji: "📌", label: "Pin" },
  { emoji: "📚", label: "Books" },
  { emoji: "🗂️", label: "Files" },
  { emoji: "📁", label: "Folder" },
  { emoji: "🗓️", label: "Calendar" },
  { emoji: "✅", label: "Done" },
  { emoji: "🎯", label: "Goal" },
  { emoji: "💡", label: "Idea" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "⚙️", label: "Settings" },
  { emoji: "🔧", label: "Tools" },
  { emoji: "🧪", label: "Experiment" },
  { emoji: "📊", label: "Chart" },
  { emoji: "📈", label: "Growth" },
  { emoji: "🗒️", label: "List" },
  { emoji: "📋", label: "Clipboard" },
  { emoji: "🏷️", label: "Tag" },
  { emoji: "🔖", label: "Bookmark" },
  { emoji: "🏠", label: "Home" },
  { emoji: "🌱", label: "Seedling" },
  { emoji: "🌿", label: "Plant" },
  { emoji: "🌊", label: "Wave" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "⭐", label: "Star" },
  { emoji: "🌟", label: "Sparkle" },
  { emoji: "☀️", label: "Sun" },
  { emoji: "🌙", label: "Moon" },
  { emoji: "☁️", label: "Cloud" },
  { emoji: "🌈", label: "Rainbow" },
  { emoji: "❄️", label: "Snow" },
  { emoji: "💻", label: "Laptop" },
  { emoji: "🖥️", label: "Desktop" },
  { emoji: "📱", label: "Phone" },
  { emoji: "🎧", label: "Headphones" },
  { emoji: "📷", label: "Camera" },
  { emoji: "🎨", label: "Art" },
  { emoji: "🎵", label: "Music" },
  { emoji: "🎬", label: "Film" },
  { emoji: "🕹️", label: "Game" },
  { emoji: "🧩", label: "Puzzle" },
  { emoji: "🛠️", label: "Repair" },
  { emoji: "🧭", label: "Compass" },
  { emoji: "🗺️", label: "Map" },
  { emoji: "🔑", label: "Key" },
  { emoji: "🕯️", label: "Candle" },
  { emoji: "🪴", label: "Potted plant" },
  { emoji: "👤", label: "Person" },
  { emoji: "👥", label: "Team" },
  { emoji: "🧠", label: "Brain" },
  { emoji: "💬", label: "Chat" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "✨", label: "Sparkles" },
  { emoji: "🎉", label: "Party" },
  { emoji: "🏆", label: "Trophy" },
  { emoji: "🥇", label: "Medal" },
  { emoji: "🔔", label: "Bell" },
  { emoji: "☕", label: "Coffee" },
  { emoji: "🍵", label: "Tea" },
  { emoji: "🍎", label: "Apple" },
  { emoji: "🍋", label: "Lemon" },
  { emoji: "🥑", label: "Avocado" },
  { emoji: "🍪", label: "Cookie" },
  { emoji: "⚡", label: "Bolt" },
  { emoji: "💎", label: "Gem" },
  { emoji: "🔒", label: "Lock" },
  { emoji: "🔓", label: "Unlock" },
  { emoji: "♻️", label: "Recycle" },
  { emoji: "🧲", label: "Magnet" },
  { emoji: "🪄", label: "Magic wand" },
] as const;

/**
 * The page icon is picked from a curated set rather than typed, so every icon
 * stays a short, renderable emoji. The trigger still shows a stored custom icon
 * from older pages.
 */
export function PageIconPicker({
  value,
  onSelect,
  onRemove,
}: {
  value: string;
  onSelect: (icon: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const needle = query.trim().toLocaleLowerCase();
  const icons = PAGE_ICONS.filter((icon) =>
    needle.length === 0 || `${icon.label} ${icon.emoji}`.toLocaleLowerCase().includes(needle),
  );

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function toggle() {
    if (!open) setQuery("");
    setOpen(!open);
  }

  function choose(emoji: string) {
    onSelect(emoji);
    close(true);
  }

  function remove() {
    onRemove();
    close(true);
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={value ? `Page icon ${value}` : "Add page icon"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose a page icon"
        onClick={toggle}
        className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-muted-foreground">Icon</span>
        <span aria-hidden="true" className="flex min-w-6 max-w-24 justify-center truncate text-lg leading-none">
          {value || "＋"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a page icon"
          className="absolute left-0 z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
            <Search size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search icons"
              placeholder="Search icons"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>

          {icons.length > 0 ? (
            <div
              role="listbox"
              aria-label="Page icons"
              className="mt-2 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto"
            >
              {icons.map((icon) => (
                <button
                  key={icon.label}
                  type="button"
                  role="option"
                  aria-selected={value === icon.emoji}
                  aria-label={icon.label}
                  title={icon.label}
                  onClick={() => choose(icon.emoji)}
                  className="flex size-8 items-center justify-center rounded text-lg leading-none hover:bg-accent aria-selected:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true">{icon.emoji}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              No icons match “{query.trim()}”.
            </p>
          )}

          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <button
              type="button"
              onClick={remove}
              disabled={!value}
              className="rounded px-1 py-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
            >
              Remove icon
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
