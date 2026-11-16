export type BoardColumn<T> = {
  key: string;
  label: string;
  records: T[];
};

type BoardGroupProperty = {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
};

type BoardRecord = {
  values: Record<string, unknown>;
  relations?: Record<string, string[]>;
};

/**
 * The columns a board shows for its group property.
 *
 * A Select groups by its configured choices, keeping one "No value" column.
 * A relation groups by the records it links to, so a record with two links
 * appears in both columns, and one extra column keeps the records that link to
 * nothing in view rather than hiding them.
 */
export function boardColumnsFor<T extends BoardRecord>({
  property,
  records,
  relationTargets = [],
}: {
  property: BoardGroupProperty;
  records: T[];
  /** Target records for a relation group, in the order the columns appear. */
  relationTargets?: { id: string; title: string }[];
}): BoardColumn<T>[] {
  if (property.type === "relation") {
    return [
      ...relationTargets.map((target) => ({
        key: target.id,
        label: target.title || "Untitled",
        records: records.filter((record) =>
          (record.relations?.[property.id] ?? []).includes(target.id)),
      })),
      {
        key: "__unlinked",
        label: `No ${property.name}`,
        records: records.filter((record) =>
          (record.relations?.[property.id] ?? []).length === 0),
      },
    ];
  }

  const choices = Array.isArray(property.options?.choices)
    ? property.options.choices.filter((choice): choice is string => typeof choice === "string")
    : [];

  return ["", ...choices].map((choice) => ({
    key: choice || "__empty",
    label: choice || "No value",
    records: records.filter((record) =>
      String(record.values[property.id] ?? "") === choice),
  }));
}

export type BoardSection<T> = BoardColumn<T> & {
  /** Present when the board stacks a second property inside each column. */
  groups?: BoardColumn<T>[];
};

/**
 * The board's columns, plus the stacked sections a second group property adds
 * inside each column. Both levels group the same way, so a Select or a relation
 * works at either level, and a record still appears wherever it belongs.
 */
export function boardSectionsFor<T extends BoardRecord>({
  property,
  records,
  relationTargets,
  secondary,
}: {
  property: BoardGroupProperty;
  records: T[];
  relationTargets?: { id: string; title: string }[];
  secondary?: {
    property: BoardGroupProperty;
    relationTargets?: { id: string; title: string }[];
  };
}): BoardSection<T>[] {
  const columns = boardColumnsFor({ property, records, relationTargets });
  if (!secondary) return columns;
  return columns.map((column) => ({
    ...column,
    groups: boardColumnsFor({
      property: secondary.property,
      records: column.records,
      relationTargets: secondary.relationTargets,
    }),
  }));
}
