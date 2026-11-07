import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { pageIdFromLinkHref } from "./link";

/**
 * Page IDs that the document still links to inline. Deleting link text, undoing
 * an insertion, or cutting a selection removes an ID here, which is how the
 * editor learns a page connection went away without the link panel being used.
 */
export function collectLinkedPageIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();

  doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "link") continue;
      const targetPageId = pageIdFromLinkHref(mark.attrs.href as string);
      if (targetPageId) ids.add(targetPageId);
    }
  });

  return ids;
}

/** Page links that appeared or disappeared between two document states. */
export function diffLinkedPageIds(
  previous: Iterable<string>,
  current: Iterable<string>,
): { added: string[]; removed: string[] } {
  const before = new Set(previous);
  const after = new Set(current);

  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}
