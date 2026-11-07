"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check } from "lucide-react";
import { statusToneClass } from "@/lib/status-tone";

type AnchorRect = { top: number; bottom: number; left: number; right: number };
type OpenMode = "selected" | "last";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

function focusableOptions(
  refs: { current: (HTMLButtonElement | null)[] },
): HTMLButtonElement[] {
  return refs.current.filter((option): option is HTMLButtonElement =>
    Boolean(option),
  );
}

/**
 * Places the picker under its cell, flipping it above when there is no room
 * below and keeping it inside the viewport. The size comes from the rendered
 * popover, because the date picker and a long choice list are very different
 * heights.
 */
function placePopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
): { top: number; left: number } {
  let top = anchor.bottom + ANCHOR_GAP;

  if (top + size.height > window.innerHeight - VIEWPORT_MARGIN) {
    const above = anchor.top - ANCHOR_GAP - size.height;
    top =
      above >= VIEWPORT_MARGIN
        ? above
        : Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - size.height);
  }

  let left = anchor.left;
  if (left + size.width > window.innerWidth - VIEWPORT_MARGIN) {
    left = anchor.right - size.width;
  }
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, window.innerWidth - VIEWPORT_MARGIN - size.width),
  );

  return { top, left };
}

/**
 * Places the rendered popover against the cell's current position and makes it
 * visible. The cell is measured now rather than when it was clicked: focusing a
 * cell or its field can scroll the page before React's effects run, and stale
 * coordinates put the picker in the wrong place. Returns false when the cell
 * has left the viewport.
 */
function applyPlacement(button: HTMLButtonElement, node: HTMLElement): boolean {
  const rect = button.getBoundingClientRect();
  const offscreen =
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth;

  if (offscreen) return false;

  const placement = placePopover(
    { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    node.getBoundingClientRect(),
  );

  node.style.top = `${placement.top}px`;
  node.style.left = `${placement.left}px`;
  node.style.visibility = "visible";
  return true;
}

/**
 * Table cells live inside a horizontal scroll container, so the picker is
 * positioned fixed against the viewport instead of the cell. It follows the
 * cell while the page scrolls and closes once the cell leaves the viewport.
 */
function useCellPopover() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<AnchorRect | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  function setOpenAnchor(next: AnchorRect | null) {
    anchorRef.current = next;
    setAnchor(next);
  }

  function open() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    setOpenAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
  }

  function close() {
    setOpenAnchor(null);
  }

  /**
   * Dismissing with the keyboard or by choosing puts focus back on the cell, so
   * keyboard users are never dropped at the top of the page.
   */
  function closeAndRestoreFocus() {
    setOpenAnchor(null);
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
    setOpenAnchor(null);
  }

  // The popover renders hidden, then this measures it and places it. Writing
  // the position straight to the node keeps the first painted frame from
  // showing at the wrong place.
  useEffect(() => {
    if (!anchor) return;

    const button = buttonRef.current;
    const node = popoverRef.current;
    if (!button || !node) return;

    applyPlacement(button, node);
  }, [anchor]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!anchorRef.current) return;

      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpenAnchor(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !anchorRef.current) return;

      setOpenAnchor(null);
      buttonRef.current?.focus();
    }

    /**
     * Scrolling keeps the picker attached to its cell instead of dismissing it.
     * Focusing a field can scroll the page by a few pixels, which used to read
     * as "the user scrolled away" and closed the picker as it opened.
     */
    function handleViewportChange() {
      if (!anchorRef.current) return;

      const button = buttonRef.current;
      const node = popoverRef.current;
      if (button && node && applyPlacement(button, node)) return;

      setOpenAnchor(null);
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
  }, []);

  return {
    buttonRef,
    popoverRef,
    anchor,
    open,
    close,
    closeAndRestoreFocus,
    handleBlur,
    isOpen: anchor !== null,
  };
}

function formatCellDate(value: string): string {
  const text = value.slice(0, 10);
  if (!text) return "";

  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function popoverStyle(anchor: AnchorRect) {
  return {
    // Pinned inline as well as by class, because the picker's placement is
    // meaningless if the `fixed` utility is ever missing from the stylesheet.
    position: "fixed" as const,
    top: anchor.bottom + ANCHOR_GAP,
    left: anchor.left,
    zIndex: 50,
    visibility: "hidden" as const,
  };
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
    anchor,
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
    if (!anchor) return;

    const options = focusableOptions(optionRefs);
    if (options.length === 0) return;

    if (openModeRef.current === "last") {
      options[options.length - 1].focus();
      return;
    }

    const selectedIndex = choicesRef.current.indexOf(valueRef.current);
    (options[selectedIndex] ?? options[0]).focus({ preventScroll: true });
  }, [anchor]);

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
            (event.key === "ArrowUp" ? options[options.length - 1] : options[0])?.focus({
              preventScroll: true,
            });
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

      {anchor && (
        <div
          ref={popoverRef}
          onKeyDown={handlePopoverKeyDown}
          onBlur={handleBlur}
          className="fixed z-50 w-[184px] overflow-hidden rounded-lg border bg-popover p-1 shadow-lg"
          style={popoverStyle(anchor)}
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
    anchor,
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
    if (!anchor) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [anchor]);

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

      {anchor && (
        <div
          ref={popoverRef}
          id={dialogId}
          role="dialog"
          aria-label={`${label} picker`}
          onBlur={handleBlur}
          className="fixed z-50 w-56 rounded-lg border bg-popover p-2 shadow-lg"
          style={popoverStyle(anchor)}
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
