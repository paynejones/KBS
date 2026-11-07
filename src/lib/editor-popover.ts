export type EditorPopoverAnchor = { x: number; y: number };
export type EditorPopoverSize = { width: number; height: number };
export type EditorPopoverViewport = { width: number; height: number };

export type EditorPopoverPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

const MARGIN = 8;
const CARET_GAP = 6;

/**
 * Places the slash and wiki menus near the caret while keeping them inside the
 * visible viewport. On phones the on-screen keyboard shrinks that viewport, so a
 * menu anchored below the caret can otherwise open under the keyboard.
 */
export function clampEditorPopover(
  anchor: EditorPopoverAnchor,
  size: EditorPopoverSize,
  viewport: EditorPopoverViewport,
): EditorPopoverPlacement {
  const width = Math.min(size.width, Math.max(viewport.width - MARGIN * 2, 0));
  const left = Math.max(MARGIN, Math.min(anchor.x, viewport.width - width - MARGIN));
  const maxHeight = Math.min(size.height, Math.max(viewport.height - MARGIN * 2, 0));
  const fitsBelow = anchor.y + maxHeight + MARGIN <= viewport.height;
  const preferredTop = fitsBelow
    ? Math.max(MARGIN, anchor.y)
    : Math.max(MARGIN, anchor.y - maxHeight - CARET_GAP);
  const top = Math.min(preferredTop, Math.max(MARGIN, viewport.height - maxHeight - MARGIN));

  return { left, top, width, maxHeight };
}
