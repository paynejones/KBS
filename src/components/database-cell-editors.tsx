"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { statusToneClass } from "@/lib/status-tone";

type PopoverPosition = { top: number; left: number };

const POPOVER_WIDTH = 184;
const POPOVER_HEIGHT = 232;

/**
 * Table cells live inside a horizontal scroll container, so the picker is
 * positioned fixed against the viewport instead of the cell. Scrolling or
 * resizing closes it rather than leaving it behind.
 */
function useCellPopover() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  function open() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    setPosition({
      top: Math.max(
        8,
        Math.min(rect.bottom + 4, window.innerHeight - POPOVER_HEIGHT),
      ),
      left: Math.max(
        8,
        Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8),
      ),
    });
  }

  function close() {
    setPosition(null);
  }

  useEffect(() => {
    if (!position) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setPosition(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPosition(null);
    }

    function handleViewportChange() {
      setPosition(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [position]);

  return {
    buttonRef,
    popoverRef,
    position,
    open,
    close,
    isOpen: position !== null,
  };
}

function formatCellDate(value: string): string {
  const text = value.slice(0, 10);
  if (!text) return "";

  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SelectCell({
  label,
  recordTitle,
  value,
  choices,
  onChange,
}: {
  label: string;
  recordTitle: string;
  value: string;
  choices: string[];
  onChange: (value: string) => void;
}) {
  const { buttonRef, popoverRef, position, open, close, isOpen } =
    useCellPopover();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} for ${recordTitle}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        className="flex min-h-9 w-full items-center rounded-md px-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {value ? (
          <span
            className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${statusToneClass(value)}`}
          >
            <span className="size-1 shrink-0 rounded-full bg-current" />
            {value}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Choose…</span>
        )}
      </button>

      {position && (
        <div
          ref={popoverRef}
          role="listbox"
          aria-label={`${label} choices`}
          className="fixed z-50 w-[184px] overflow-hidden rounded-lg border bg-popover p-1 shadow-lg"
          style={{ top: position.top, left: position.left }}
        >
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              role="option"
              aria-selected={choice === value}
              onClick={() => {
                onChange(choice);
                close();
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusToneClass(choice)}`}
              >
                <span className="size-1 rounded-full bg-current" />
                {choice}
              </span>
              {choice === value && (
                <Check
                  size={12}
                  aria-hidden="true"
                  className="ml-auto shrink-0 text-brand"
                />
              )}
            </button>
          ))}
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                close();
              }}
              className="mt-1 w-full border-t px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function DateCell({
  label,
  recordTitle,
  value,
  onChange,
}: {
  label: string;
  recordTitle: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { buttonRef, popoverRef, position, open, close, isOpen } =
    useCellPopover();
  const display = formatCellDate(value);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} for ${recordTitle}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        className="flex min-h-9 w-full items-center rounded-md px-2 text-left text-xs tabular-nums transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {display || (
          <span className="text-muted-foreground">Set date</span>
        )}
      </button>

      {position && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${label} picker`}
          className="fixed z-50 w-56 rounded-lg border bg-popover p-2 shadow-lg"
          style={{ top: position.top, left: position.left }}
        >
          <input
            type="date"
            autoFocus
            aria-label={`${label} date`}
            defaultValue={value.slice(0, 10)}
            onChange={(event) => {
              onChange(event.target.value);
              close();
            }}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onChange("");
                close();
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={close}
              className="text-[11px] font-medium text-brand hover:underline"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
