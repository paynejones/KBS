import { Fragment, Slice, type ResolvedPos } from "@tiptap/pm/model";
import {
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import type { Mappable } from "@tiptap/pm/transform";

/** Nodes whose children are fixed by their parent's shape; moving one breaks it. */
const STRUCTURED_NODES = new Set(["table", "tableRow", "tableCell", "tableHeader"]);

type BlockRange = {
  /** The node whose children the selection covers. */
  ancestor: EditorState["doc"];
  /** Index of the first covered child. */
  first: number;
  /** Index of the last covered child. */
  last: number;
  /** Position directly before the first covered child. */
  groupStart: number;
  /** Combined size of the covered children. */
  groupSize: number;
};

type RangeLookup =
  | { kind: "single" }
  | { kind: "blocked" }
  | { kind: "range"; range: BlockRange };

/**
 * Moves the block or blocks covered by the selection one sibling up or down,
 * inside whatever parent holds them, and returns the transaction that performs
 * the move.
 *
 * A collapsed selection, or a selection that touches only one block, moves that
 * block. When the block is an only child (a paragraph alone in a list item or a
 * quote), the move climbs to the nearest wrapping block that has a sibling, so
 * the shortcut still reorders something. A selection spanning several sibling
 * blocks moves all of them together, keeping the selection over the same text.
 *
 * Tables are left alone because their rows and cells cannot trade places
 * without breaking the table's shape. Returns null when the move is impossible
 * (no sibling in that direction, or a parent that rejects the nodes).
 */
export function moveBlockAtSelection(
  state: EditorState,
  direction: -1 | 1,
): Transaction | null {
  const { selection } = state;

  if (!selection.empty && !(selection instanceof NodeSelection)) {
    const lookup = findBlockRange(state);
    if (lookup.kind === "blocked") return null;
    if (lookup.kind === "range") return moveBlockRange(state, lookup.range, direction);
  }

  return moveSingleBlock(state, direction);
}

/** The covered sibling blocks when a selection spans more than one of them. */
function findBlockRange(state: EditorState): RangeLookup {
  const { selection } = state;
  const $from = selection.$from;
  const sharedDepth = $from.sharedDepth(selection.to);
  const ancestor = $from.node(sharedDepth);

  // Endpoints inside one textblock are a single-block move, whatever the
  // wrapper around them looks like.
  if (ancestor.isTextblock) return { kind: "single" };
  if (STRUCTURED_NODES.has(ancestor.type.name)) return { kind: "blocked" };

  const ancestorStart = $from.start(sharedDepth);
  let first = -1;
  let last = -1;
  let groupStart = 0;
  let groupSize = 0;
  let index = 0;

  ancestor.forEach((child, offset) => {
    const start = ancestorStart + offset;
    const end = start + child.nodeSize;
    // Covered means the selection actually reaches into the block; a selection
    // that merely ends on a block's edge does not take that block along.
    if (end > selection.from && start < selection.to) {
      if (first === -1) {
        first = index;
        groupStart = start;
      }
      last = index;
      groupSize += child.nodeSize;
    }
    index += 1;
  });

  if (first === -1 || first === last) return { kind: "single" };

  return { kind: "range", range: { ancestor, first, last, groupStart, groupSize } };
}

/**
 * A selection over whole sibling blocks. ProseMirror's text and node selections
 * cannot cover several complete blocks, and the drop handler deletes exactly
 * this range before inserting the dragged slice.
 */
class BlockRangeSelection extends Selection {
  constructor($anchor: ResolvedPos, $head: ResolvedPos) {
    super($anchor, $head);
  }

  eq(selection: Selection): boolean {
    return (
      selection instanceof BlockRangeSelection &&
      selection.from === this.from &&
      selection.to === this.to
    );
  }

  map(doc: EditorState["doc"], mapping: Mappable): Selection {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    if (from === this.from && to === this.to) return this;
    return new BlockRangeSelection(doc.resolve(from), doc.resolve(to));
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: "blockRange", anchor: this.anchor, head: this.head };
  }
}

export type BlockGroupDrag = {
  /** The document the positions belong to; a changed document invalidates them. */
  doc: EditorState["doc"];
  from: number;
  to: number;
  /** Start position of each covered block, for building a drag ghost. */
  positions: number[];
  slice: Slice;
  selection: Selection;
};

/**
 * The whole blocks a multi-block selection covers, ready to hand to a drag: the
 * slice to insert and the selection whose deletion removes exactly those blocks.
 * Returns null unless the selection spans more than one sibling block.
 */
export function selectedBlockGroup(state: EditorState): BlockGroupDrag | null {
  const lookup = findBlockRange(state);
  if (lookup.kind !== "range") return null;

  const { ancestor, first, last, groupStart, groupSize } = lookup.range;
  const nodes: EditorState["doc"][] = [];
  const positions: number[] = [];
  let position = groupStart;
  for (let index = first; index <= last; index += 1) {
    const node = ancestor.child(index);
    nodes.push(node);
    positions.push(position);
    position += node.nodeSize;
  }
  const from = groupStart;
  const to = groupStart + groupSize;

  return {
    doc: state.doc,
    from,
    to,
    positions,
    slice: new Slice(Fragment.fromArray(nodes), 0, 0),
    selection: new BlockRangeSelection(state.doc.resolve(from), state.doc.resolve(to)),
  };
}

function moveBlockRange(
  state: EditorState,
  range: BlockRange,
  direction: -1 | 1,
): Transaction | null {
  const { selection } = state;
  const { ancestor, first, last, groupStart, groupSize } = range;
  const neighborIndex = direction < 0 ? first - 1 : last + 1;
  if (neighborIndex < 0 || neighborIndex >= ancestor.childCount) return null;

  // The far edge of the adjacent block is a stable destination in both
  // directions: deleting the group only shifts what comes after it.
  const neighbor = ancestor.child(neighborIndex);
  const destination =
    direction < 0 ? groupStart - neighbor.nodeSize : groupStart + neighbor.nodeSize;

  const group: EditorState["doc"][] = [];
  for (let index = first; index <= last; index += 1) group.push(ancestor.child(index));

  const transaction = state.tr.delete(groupStart, groupStart + groupSize);
  try {
    transaction.insert(destination, group);
  } catch {
    return null;
  }

  // The group keeps its internal layout, so both endpoints travel the same
  // distance and the selection still covers the same characters.
  const anchor = destination + (selection.anchor - groupStart);
  const head = destination + (selection.head - groupStart);
  try {
    transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
  } catch {
    // A selection that starts exactly on a block boundary cannot be rebuilt as
    // text; put the caret at the start of the moved group instead.
    transaction.setSelection(
      TextSelection.near(transaction.doc.resolve(Math.min(destination + 1, transaction.doc.content.size - 1)), 1),
    );
  }

  transaction.scrollIntoView();
  return transaction;
}

function moveSingleBlock(state: EditorState, direction: -1 | 1): Transaction | null {
  const { selection } = state;
  const $from = selection.$from;
  const nodeSelected = selection instanceof NodeSelection;

  // A node selection resolves before its node, so the node's depth is one level
  // past `$from`; a text selection sits at the textblock's own depth.
  let depth = nodeSelected ? $from.depth + 1 : $from.depth;
  if (depth < 1) return null;

  const nodeAt = (level: number) =>
    nodeSelected && level === $from.depth + 1 ? selection.node : $from.node(level);

  for (let level = Math.min(depth, $from.depth); level >= 1; level -= 1) {
    if (STRUCTURED_NODES.has($from.node(level).type.name)) return null;
  }
  if (nodeSelected && STRUCTURED_NODES.has(selection.node.type.name)) return null;

  while (depth > 1 && $from.node(depth - 1).childCount === 1) depth -= 1;

  const node = nodeAt(depth);
  if (!node.isBlock) return null;

  const blockPos =
    nodeSelected && depth === $from.depth + 1 ? selection.from : $from.before(depth);
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const neighborIndex = index + direction;
  if (neighborIndex < 0 || neighborIndex >= parent.childCount) return null;

  const neighbor = parent.child(neighborIndex);
  const destination =
    direction < 0 ? blockPos - neighbor.nodeSize : blockPos + neighbor.nodeSize;

  const transaction = state.tr.delete(blockPos, blockPos + node.nodeSize);
  try {
    transaction.insert(destination, node);
  } catch {
    // Some parents only accept particular child types; refuse rather than
    // leave a half-moved document.
    return null;
  }

  if (nodeSelected) {
    transaction.setSelection(NodeSelection.create(transaction.doc, destination));
  } else {
    const blockEnd = destination + node.nodeSize;
    const clamp = (position: number) =>
      Math.max(destination + 1, Math.min(position, blockEnd - 1));
    const anchor = clamp(destination + (selection.$anchor.pos - blockPos));
    const head = clamp(destination + (selection.$head.pos - blockPos));
    transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
  }

  transaction.scrollIntoView();
  return transaction;
}
