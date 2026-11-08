"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, Plus, Search, X } from "lucide-react";

export type RelationOption = { id: string; title: string };

/**
 * A record's relation property. Linked records are shown as chips that can be
 * removed in place, and adding one opens a searchable list of the target
 * database's records instead of a native multiple-select.
 */
export function RelationCell({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: RelationOption[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = useMemo(() => new Set(value), [value]);
  const titles = useMemo(
    () => new Map(options.map((option) => [option.id, option.title])),
    [options],
  );

  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return options.filter(
      (option) =>
        !selected.has(option.id) &&
        (!needle || option.title.toLocaleLowerCase().includes(needle)),
    );
  }, [options, query, selected]);

  // Move focus into the search field so the list is reachable from the
  // keyboard and Escape has somewhere to return from.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openPicker() {
    if (options.length === 0) return;
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function close(restoreFocus: boolean) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  }

  function add(id: string) {
    if (selected.has(id)) return;
    onChange([...value, id]);
    close(true);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!open) return;

    const next = event.relatedTarget as Node | null;
    // jsdom and some browsers report no related target; keep the picker open
    // rather than closing on a focus change we cannot attribute.
    if (!next || containerRef.current?.contains(next)) return;
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    close(true);
  }

  // Removing a link or narrowing the search can leave the highlight past the
  // end of the list, so the rendered row is clamped instead of stored.
  const activeOption =
    matching.length === 0
      ? undefined
      : matching[Math.min(activeIndex, matching.length - 1)];

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matching.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const current = activeOption ? matching.indexOf(activeOption) : 0;
      setActiveIndex((current + step + matching.length) % matching.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption) add(activeOption.id);
    }
  }

  return (
    <div
      ref={containerRef}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="relative"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const title = titles.get(id) ?? "Missing record";
          return (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              <span className="max-w-40 truncate">{title}</span>
              <button
                type="button"
                aria-label={`Remove ${title}`}
                onClick={() => onChange(value.filter((current) => current !== id))}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          );
        })}

        <button
          ref={triggerRef}
          type="button"
          disabled={options.length === 0}
          aria-label={`${label} relation: add a record`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? close(false) : openPicker())}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            if (!open) openPicker();
          }}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={11} aria-hidden="true" />
          {value.length === 0 ? "Add relation" : "Add"}
        </button>

        {options.length === 0 && (
          <span className="text-xs text-muted-foreground">No records to link</span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Search size={14} className="text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              aria-label={`${label} relation: search records`}
              aria-controls={listId}
              aria-activedescendant={
                activeOption ? `${listId}-${activeOption.id}` : undefined
              }
              placeholder="Search records…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          <div
            id={listId}
            role="listbox"
            aria-label={`${label} relation: available records`}
            className="max-h-56 overflow-y-auto p-1"
          >
            {matching.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {query.trim() ? "No matching records." : "Every record is already linked."}
              </p>
            ) : (
              matching.map((option, index) => (
                <button
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => add(option.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none ${
                    option.id === activeOption?.id ? "bg-accent" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.title}</span>
                  {option.id === activeOption?.id && (
                    <Check size={13} aria-hidden="true" className="shrink-0 text-brand" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
