"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check } from "lucide-react";
import { statusToneClass } from "@/lib/status-tone";

type PopoverPosition = { top: number; left: number };
type OpenMode = "selected" | "last";

const POPOVER_WIDTH = 184;
const POPOVER_HEIGHT = 232;

function focusableOptions(
  refs: { current: (HTMLButtonElement | null)[] },
): HTMLButtonElement[] {
  return refs.current.filter((option): option is HTMLButtonElement =>
    Boolean(option),
  );
}

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

  /**
   * Dismissing with the keyboard or by choosing puts focus back on the cell, so
   * keyboard users are never dropped at the top of the page.
   */
  function closeAndRestoreFocus() {
    setPosition(null);
    buttonRef.current?.focus();
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (
      popoverRef.current?.contains(next) ||
      buttonRef.current?.contains(next)
    ) {
      return;
    }
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
      if (event.key === "Escape") {
        setPosition(null);
        buttonRef.current?.focus();
      }
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
    closeAndRestoreFocus,
    handleBlur,
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
  const {
    buttonRef,
    popoverRef,
    position,
    open,
    close,
    closeAndRestoreFocus,
    handleBlur,
    isOpen,
  } = useCellPopover();

  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openModeRef = useRef<OpenMode>("selected");
  const choicesRef = useRef(choices);
  const valueRef = useRef(value);
  const listId = useId();

  useEffect(() => {
    choicesRef.current = choices;
    valueRef.current = value;
  }, [choices, value]);

  // Move focus into the menu as soon as it opens, so the whole list is
  // reachable with the arrow keys and nothing is announced into the void.
  useEffect(() => {
    if (!position) return;

    const options = focusableOptions(optionRefs);
    if (options.length === 0) return;

    if (openModeRef.current === "last") {
      options[options.length - 1].focus();
      return;
    }

    const selectedIndex = choicesRef.current.indexOf(valueRef.current);
    (options[selectedIndex] ?? options[0]).focus();
  }, [position]);

  function handlePopoverKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = focusableOptions(optionRefs);
    if (options.length === 0) return;

    const index = options.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        index === -1
          ? step === 1
            ? 0
            : options.length - 1
          : (index + step + options.length) % options.length;
      options[next].focus();
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? options[0] : options[options.length - 1]).focus();
      return;
    }

    // Type-ahead, the way a native select behaves.
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      /\S/.test(event.key)
    ) {
      const character = event.key.toLowerCase();
      const start = index === -1 ? 0 : index + 1;
      for (let offset = 0; offset < options.length; offset += 1) {
        const positionInList = (start + offset) % options.length;
        if (
          choicesRef.current[positionInList]
            ?.toLowerCase()
            .startsWith(character)
        ) {
          event.preventDefault();
          options[positionInList].focus();
          return;
        }
      }
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} for ${recordTitle}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => {
          openModeRef.current = "selected";
          if (isOpen) close();
          else open();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openModeRef.current = event.key === "ArrowUp" ? "last" : "selected";

          if (isOpen) {
            const options = focusableOptions(optionRefs);
            (event.key === "ArrowUp" ? options[options.length - 1] : options[0])?.focus();
          } else {
            open();
          }
        }}
        onBlur={handleBlur}
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
          onKeyDown={handlePopoverKeyDown}
          onBlur={handleBlur}
          className="fixed z-50 w-[184px] overflow-hidden rounded-lg border bg-popover p-1 shadow-lg"
          style={{ top: position.top, left: position.left }}
        >
          <div id={listId} role="listbox" aria-label={`${label} choices`}>
            {choices.map((choice, index) => (
            <button
              key={choice}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={choice === value}
              tabIndex={-1}
              onClick={() => {
                onChange(choice);
                closeAndRestoreFocus();
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
          </div>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                closeAndRestoreFocus();
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
  const {
    buttonRef,
    popoverRef,
    position,
    open,
    close,
    closeAndRestoreFocus,
    handleBlur,
    isOpen,
  } = useCellPopover();
  const dialogId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const display = formatCellDate(value);

  // The field is focused from an effect rather than with `autoFocus`, which
  // runs before the popover refs exist and so looked like focus leaving the
  // cell — closing the picker the moment it opened.
  useEffect(() => {
    if (!position) return;
    inputRef.current?.focus();
  }, [position]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} for ${recordTitle}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!isOpen) open();
        }}
        onBlur={handleBlur}
        className="flex min-h-9 w-full items-center rounded-md px-2 text-left text-xs tabular-nums transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {display || <span className="text-muted-foreground">Set date</span>}
      </button>

      {position && (
        <div
          ref={popoverRef}
          id={dialogId}
          role="dialog"
          aria-label={`${label} picker`}
          onBlur={handleBlur}
          className="fixed z-50 w-56 rounded-lg border bg-popover p-2 shadow-lg"
          style={{ top: position.top, left: position.left }}
        >
          <input
            ref={inputRef}
            type="date"
            aria-label={`${label} date`}
            defaultValue={value.slice(0, 10)}
            onChange={(event) => {
              onChange(event.target.value);
              closeAndRestoreFocus();
            }}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onChange("");
                closeAndRestoreFocus();
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
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
