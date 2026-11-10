import type { Editor } from "@tiptap/core";

/** Copies the attributes that give a rebuilt list its styling and numbering. */
function copyPresentationalAttributes(source: HTMLElement, target: HTMLElement) {
  target.className = source.className;
  for (const attribute of Array.from(source.attributes)) {
    if (attribute.name === "class" || attribute.name === "contenteditable") continue;
    target.setAttribute(attribute.name, attribute.value);
  }
}

/** Clones a block without editor-only state such as selection or editing flags. */
function cloneBlock(dom: HTMLElement): HTMLElement {
  const clone = dom.cloneNode(true) as HTMLElement;
  clone.removeAttribute("contenteditable");
  clone.classList.remove("ProseMirror-selectednode");
  for (const element of Array.from(clone.querySelectorAll("[contenteditable]"))) {
    element.removeAttribute("contenteditable");
  }
  for (const element of Array.from(clone.querySelectorAll(".ProseMirror-selectednode"))) {
    element.classList.remove("ProseMirror-selectednode");
  }
  return clone;
}

/**
 * Builds the off-screen element a browser uses as the drag ghost, cloning every
 * block whose start position is given so a multi-block drag previews the whole
 * group instead of just the block under the pointer.
 *
 * The ghost carries the editor's `tiptap` class context, so callouts, toggles,
 * task items, and tables keep their scoped styles. List items are rebuilt inside
 * a list copied from their source parent, which preserves markers, indentation,
 * and the task-list layout. Margins are left alone so block spacing matches the
 * page instead of collapsing into a flat stack.
 *
 * Returns null when none of the positions resolve to an element. The caller owns
 * the returned element and must remove it once the drag ends.
 */
export function buildBlockDragImage(
  editor: Editor,
  positions: readonly number[],
): HTMLElement | null {
  const wrapper = document.createElement("div");
  wrapper.className = "tiptap prose prose-neutral max-w-none dark:prose-invert";
  wrapper.dataset.kbsDragImage = "true";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.position = "absolute";
  wrapper.style.top = "-10000px";
  wrapper.style.left = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.background = "var(--background)";
  // Match the editor's width so lines wrap in the ghost as they do on the page.
  const width = editor.view.dom.clientWidth;
  if (width > 0) wrapper.style.width = `${width}px`;

  let list: HTMLElement | null = null;
  let listSource: HTMLElement | null = null;
  let added = false;

  for (const position of positions) {
    const dom = editor.view.nodeDOM(position);
    if (!(dom instanceof HTMLElement)) {
      list = null;
      listSource = null;
      continue;
    }

    const sourceList = dom.tagName === "LI" ? dom.parentElement : null;
    if (sourceList && (sourceList.tagName === "UL" || sourceList.tagName === "OL")) {
      // A list item only keeps its marker and indentation inside a list, so the
      // covered items share one rebuilt list instead of floating as bare `li`s.
      if (!list || listSource !== sourceList) {
        listSource = sourceList;
        list = document.createElement(sourceList.tagName.toLowerCase());
        copyPresentationalAttributes(sourceList, list);
        wrapper.append(list);
      }
      list.append(cloneBlock(dom));
      added = true;
      continue;
    }

    list = null;
    listSource = null;
    wrapper.append(cloneBlock(dom));
    added = true;
  }

  if (!added) return null;
  document.body.append(wrapper);
  return wrapper;
}
