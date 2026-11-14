"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buttonExpressionError,
  defaultButtonActionValue,
  isButtonActionExpression,
  isButtonExpressionWritableProperty,
  isButtonWritableProperty,
  type ButtonAction,
  type ButtonActionExpression,
  type ButtonActionValue,
} from "@/lib/database-button";

type ActionProperty = {
  id: string;
  name: string;
  type: string;
  options: { choices?: string[] };
};
type RelationOption = {
  id: string;
  name: string;
  relatedDatabaseId: string;
};
type DatabaseOption = {
  id: string;
  name: string;
};
type DatabaseRecordOption = {
  id: string;
  title: string;
};

function highlightedTitle(title: string, query: string): ReactNode {
  if (!query) return title;
  const lowerTitle = title.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = lowerTitle.indexOf(lowerQuery);
  while (match !== -1) {
    if (match > cursor) parts.push(title.slice(cursor, match));
    parts.push(
      <mark key={`${match}-${cursor}`} className="rounded bg-primary/20 px-0.5 text-foreground">
        {title.slice(match, match + lowerQuery.length)}
      </mark>,
    );
    cursor = match + lowerQuery.length;
    match = lowerTitle.indexOf(lowerQuery, cursor);
  }
  if (cursor < title.length) parts.push(title.slice(cursor));
  return parts.length > 0 ? parts : title;
}

function ExistingRecordPicker({
  records,
  value,
  onChange,
}: {
  records: DatabaseRecordOption[];
  value: string;
  onChange: (recordId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const query = search.trim();
  const lowerQuery = query.toLocaleLowerCase();
  const filtered = lowerQuery
    ? records.filter((record) => (record.title || "Untitled").toLocaleLowerCase().includes(lowerQuery))
    : records;
  const selected = records.find((record) => record.id === value);
  const options = selected && !filtered.some((record) => record.id === selected.id)
    ? [selected, ...filtered]
    : filtered;
  const lastIndex = Math.max(options.length - 1, 0);
  const safeActiveIndex = Math.min(activeIndex, lastIndex);
  const activeOption = options[safeActiveIndex];

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex, search]);

  function selectRecord(recordId: string) {
    onChange(recordId);
    setSearch("");
    setActiveIndex(0);
  }

  function handleSearchChange(next: string) {
    setSearch(next);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (options.length === 0) return;
      event.preventDefault();
      setActiveIndex(Math.min(safeActiveIndex + 1, lastIndex));
    } else if (event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setActiveIndex(Math.max(safeActiveIndex - 1, 0));
    } else if (event.key === "Home") {
      if (options.length === 0) return;
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      if (options.length === 0) return;
      event.preventDefault();
      setActiveIndex(lastIndex);
    } else if (event.key === "Enter") {
      if (!activeOption) return;
      event.preventDefault();
      selectRecord(activeOption.id);
    } else if (event.key === "Escape" && search) {
      event.preventDefault();
      handleSearchChange("");
    }
  }

  return (
    <div className="grid gap-2 rounded-md border bg-background p-2 sm:col-span-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        Search records
        <input
          type="search"
          role="combobox"
          aria-label="Search existing records"
          aria-autocomplete="list"
          aria-expanded={records.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Filter by record title…"
          disabled={records.length === 0}
          className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selected
          ? <>Selected record: <strong className="text-foreground">{selected.title || "Untitled"}</strong></>
          : "No record chosen yet."}
        {selected && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear selected record"
            className="ml-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </p>

      {records.length === 0 ? (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          This database has no records yet.
        </p>
      ) : (
        <>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Existing records"
            className="max-h-44 overflow-y-auto rounded-md border bg-background"
          >
            {options.map((record, index) => {
              const isActive = index === safeActiveIndex;
              const isSelected = record.id === value;
              return (
                <button
                  key={record.id}
                  ref={isActive ? activeOptionRef : undefined}
                  type="button"
                  role="option"
                  id={`${listboxId}-${record.id}`}
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectRecord(record.id)}
                  className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs ${isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                >
                  <span className="min-w-0 break-words">
                    {highlightedTitle(record.title || "Untitled", query)}
                  </span>
                  {isSelected && <Check size={13} className="shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {query
              ? `${filtered.length} of ${records.length} records match “${query}”.`
              : `${records.length} ${records.length === 1 ? "record" : "records"} available. Use arrow keys to browse.`}
          </p>
          {filtered.length === 0 && !selected && (
            <p className="text-xs text-muted-foreground">No records match “{query}”.</p>
          )}
        </>
      )}
    </div>
  );
}

function literalEditor(
  property: ActionProperty | undefined,
  value: ButtonActionValue,
  onChange: (value: ButtonActionValue) => void,
  label = "Button action value",
) {
  if (!property) {
    return <span className="text-xs text-muted-foreground">Choose a property first.</span>;
  }

  if (property.type === "checkbox") {
    return (
      <label className="flex min-h-9 items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm">
        <input
          type="checkbox"
          aria-label={label}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="size-4 accent-primary"
        />
        {value ? "Checked" : "Unchecked"}
      </label>
    );
  }

  if (property.type === "select") {
    return (
      <select
        aria-label={label}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        <option value="">No value</option>
        {(property.options.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>{choice}</option>
        ))}
      </select>
    );
  }

  if (property.type === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <select
        multiple
        aria-label={label}
        value={selected}
        onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
        className="min-h-20 min-w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {(property.options.choices ?? []).map((choice) => (
          <option key={choice} value={choice}>{choice}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={property.type === "number" ? "number" : property.type === "date" ? "date" : property.type === "url" ? "url" : "text"}
      aria-label={label}
      value={typeof value === "string" || typeof value === "number" ? value : ""}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        if (property.type === "number") {
          onChange(raw === "" ? null : Number(raw));
        } else {
          onChange(raw);
        }
      }}
      placeholder="Value"
      className="min-h-9 min-w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
    />
  );
}

function defaultExpression(property: ActionProperty): ButtonActionExpression {
  const reference = `{${property.name}}`;
  return { expression: property.type === "number" ? `${reference} + 1` : reference };
}

function ExpressionValueEditor(
  property: ActionProperty,
  value: ButtonActionExpression,
  onChange: (value: ButtonActionValue) => void,
  label: string,
  properties: ActionProperty[],
) {
  const valueNames = properties
    .filter((candidate) =>
      candidate.type === "number" || candidate.type === "rollup" || candidate.type === "formula")
    .map((candidate) => `{${candidate.name}}`);
  const error = buttonExpressionError(value.expression, properties);

  return (
    <div className="grid gap-1">
      <input
        aria-label={label}
        value={value.expression}
        onChange={(event) => onChange({ expression: event.currentTarget.value })}
        placeholder="{Count} + 1"
        spellCheck={false}
        className="min-h-9 min-w-32 rounded-md border bg-background px-2 py-1.5 font-mono text-sm"
      />
      <p className="text-[11px] text-muted-foreground">
        {valueNames.length > 0
          ? <>Reads this record’s current values: {valueNames.join(", ")}. Try {"{"}Count{"}"} + 1.</>
          : "Add a number, rollup, or formula property to this database to read a current value here."}
      </p>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <button
        type="button"
        onClick={() => onChange(defaultButtonActionValue(property.type))}
        className="justify-self-start text-[11px] text-muted-foreground underline hover:text-foreground"
      >
        Use a fixed value
      </button>
    </div>
  );
}

function valueEditor(
  property: ActionProperty | undefined,
  value: ButtonActionValue,
  onChange: (value: ButtonActionValue) => void,
  label = "Button action value",
  properties: ActionProperty[] = [],
) {
  if (!property) {
    return <span className="text-xs text-muted-foreground">Choose a property first.</span>;
  }

  if (isButtonActionExpression(value) && isButtonExpressionWritableProperty(property)) {
    return ExpressionValueEditor(property, value, onChange, label, properties);
  }

  const literal = literalEditor(property, value, onChange, label);
  if (!isButtonExpressionWritableProperty(property)) return literal;

  return (
    <div className="grid gap-1">
      {literal}
      <button
        type="button"
        onClick={() => onChange(defaultExpression(property))}
        className="justify-self-start text-[11px] text-muted-foreground underline hover:text-foreground"
      >
        Use current values
      </button>
    </div>
  );
}

export function ButtonActionsEditor({
  actions,
  onChange,
  properties,
  relationProperties,
  relatedProperties,
  currentDatabaseId,
  databases,
  databaseProperties,
  databaseRecords,
  onLoadDatabase,
}: {
  actions: ButtonAction[];
  onChange: (actions: ButtonAction[]) => void;
  properties: ActionProperty[];
  relationProperties: RelationOption[];
  relatedProperties: Record<string, ActionProperty[]>;
  currentDatabaseId: string;
  databases: DatabaseOption[];
  databaseProperties: Record<string, ActionProperty[]>;
  databaseRecords: Record<string, DatabaseRecordOption[]>;
  onLoadDatabase: (databaseId: string) => void;
}) {
  const writableProperties = properties.filter(isButtonWritableProperty);

  function replace(index: number, next: ButtonAction) {
    onChange(actions.map((action, actionIndex) => actionIndex === index ? next : action));
  }

  function actionProperties() {
    return writableProperties;
  }

  function relatedActionProperties(action: Extract<ButtonAction, { type: "set_related_property" }>) {
    return (relatedProperties[action.relationPropertyId] ?? []).filter(isButtonWritableProperty);
  }

  function createActionProperties(action: Extract<ButtonAction, { type: "create_record" }>) {
    if (action.databaseId === currentDatabaseId) return writableProperties;
    return (databaseProperties[action.databaseId] ?? []).filter(isButtonWritableProperty);
  }

  function addAction() {
    const first = writableProperties[0];
    onChange([...actions, {
      type: "set_property",
      propertyId: "",
      value: first ? defaultButtonActionValue(first.type) : "",
    }]);
  }

  return (
    <section className="basis-full rounded-lg border bg-background p-3" aria-label="Button actions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Actions</p>
          <p className="text-xs text-muted-foreground">Each click runs these actions in order. Values are checked again on the server.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addAction}>
          <Plus size={14} /> Add action
        </Button>
      </div>

      {actions.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Add at least one action. A button without actions cannot be created.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {actions.map((action, index) => {
            const targetProperties = action.type === "set_property"
              ? actionProperties()
              : action.type === "set_related_property"
                ? relatedActionProperties(action)
                : action.type === "set_record_property"
                  ? (databaseProperties[action.databaseId] ?? []).filter(isButtonWritableProperty)
                  : [];
            const targetProperty = action.type === "create_record"
              ? undefined
              : targetProperties.find((property) => property.id === action.propertyId);
            const newRecordProperties = action.type === "create_record"
              ? createActionProperties(action)
              : [];
            const unusedNewRecordProperties = action.type === "create_record"
              ? newRecordProperties.filter((property) => !(property.id in action.values))
              : [];
            return (
              <div key={index} className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Action {index + 1}
                  <select
                    value={action.type}
                    onChange={(event) => {
                      const type = event.target.value as ButtonAction["type"];
                      if (type === "set_related_property") {
                        const relationId = relationProperties[0]?.id ?? "";
                        const nextProperty = (relatedProperties[relationId] ?? []).find(isButtonWritableProperty);
                        replace(index, {
                          type,
                          relationPropertyId: relationId,
                          propertyId: "",
                          value: nextProperty ? defaultButtonActionValue(nextProperty.type) : "",
                        });
                      } else if (type === "create_record") {
                        const databaseId = databases[0]?.id ?? "";
                        if (databaseId) onLoadDatabase(databaseId);
                        replace(index, {
                          type,
                          databaseId,
                          title: "Untitled",
                          values: {},
                        });
                      } else if (type === "set_record_property") {
                        const databaseId = databases[0]?.id ?? "";
                        if (databaseId) onLoadDatabase(databaseId);
                        replace(index, {
                          type,
                          databaseId,
                          recordId: databaseRecords[databaseId]?.[0]?.id ?? "",
                          propertyId: "",
                          value: "",
                        });
                      } else {
                        const nextProperty = writableProperties[0];
                        replace(index, {
                          type,
                          propertyId: "",
                          value: nextProperty ? defaultButtonActionValue(nextProperty.type) : "",
                        });
                      }
                    }}
                    className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value="set_property">Set a property on this record</option>
                    <option value="set_related_property">Set a property on linked records</option>
                    <option value="set_record_property">Set a property on an existing record</option>
                    <option value="create_record">Create a record in a database</option>
                  </select>
                </label>

                {action.type === "set_related_property" && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Through relation
                    <select
                      value={action.relationPropertyId}
                      onChange={(event) => {
                        const relationId = event.target.value;
                        const nextProperty = (relatedProperties[relationId] ?? []).find(isButtonWritableProperty);
                        replace(index, {
                          type: "set_related_property",
                          relationPropertyId: relationId,
                          propertyId: "",
                          value: nextProperty ? defaultButtonActionValue(nextProperty.type) : "",
                        });
                      }}
                      className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                    >
                      <option value="">Choose a relation…</option>
                      {relationProperties.map((relation) => (
                        <option key={relation.id} value={relation.id}>{relation.name}</option>
                      ))}
                    </select>
                  </label>
                )}

                {action.type === "create_record" ? (
                  <>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Database
                      <select
                        value={action.databaseId}
                        onChange={(event) => {
                          const databaseId = event.target.value;
                          if (databaseId) onLoadDatabase(databaseId);
                          replace(index, {
                            type: "create_record",
                            databaseId,
                            title: action.title,
                            values: {},
                          });
                        }}
                        className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="">Choose a database…</option>
                        {databases.map((database) => (
                          <option key={database.id} value={database.id}>{database.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Record title
                      <input
                        aria-label="New record title"
                        maxLength={200}
                        value={action.title}
                        onChange={(event) => replace(index, {
                          ...action,
                          title: event.target.value,
                        })}
                        className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm"
                      />
                    </label>

                    <div className="sm:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">Initial values</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={unusedNewRecordProperties.length === 0}
                          onClick={() => {
                            const property = unusedNewRecordProperties[0];
                            if (!property) return;
                            replace(index, {
                              ...action,
                              values: {
                                ...action.values,
                                [property.id]: defaultButtonActionValue(property.type),
                              },
                            });
                          }}
                        >
                          <Plus size={14} /> Add initial value
                        </Button>
                      </div>
                      {Object.keys(action.values).length === 0 ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {action.databaseId
                            ? "The record starts with no property values."
                            : "Choose a database to add initial values."}
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {Object.entries(action.values).map(([propertyId, value]) => {
                            const property = newRecordProperties.find((candidate) => candidate.id === propertyId);
                            return (
                              <div key={propertyId} className="grid items-end gap-2 rounded-md border bg-background p-2 sm:grid-cols-[1fr_1fr_auto]">
                                <label className="grid gap-1 text-xs text-muted-foreground">
                                  Property
                                  <select
                                    value={propertyId}
                                    onChange={(event) => {
                                      const nextId = event.target.value;
                                      const nextProperty = newRecordProperties.find((candidate) => candidate.id === nextId);
                                      const nextValues = { ...action.values };
                                      delete nextValues[propertyId];
                                      if (nextId) {
                                        nextValues[nextId] = nextProperty
                                          ? defaultButtonActionValue(nextProperty.type)
                                          : "";
                                      }
                                      replace(index, { ...action, values: nextValues });
                                    }}
                                    className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                                  >
                                    <option value="">Choose a property…</option>
                                    {newRecordProperties
                                      .filter((candidate) => candidate.id === propertyId || !(candidate.id in action.values))
                                      .map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                      ))}
                                  </select>
                                </label>
                                <div className="grid gap-1 text-xs text-muted-foreground">
                                  Value
                                  {valueEditor(
                                    property,
                                    value,
                                    (next) => replace(index, {
                                      ...action,
                                      values: { ...action.values, [propertyId]: next },
                                    }),
                                    `Initial value for ${property?.name ?? "new record"}`,
                                    properties,
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove initial value${property ? ` for ${property.name}` : ""}`}
                                  onClick={() => {
                                    const nextValues = { ...action.values };
                                    delete nextValues[propertyId];
                                    replace(index, { ...action, values: nextValues });
                                  }}
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : action.type === "set_record_property" ? (
                  <>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Record database
                      <select
                        value={action.databaseId}
                        onChange={(event) => {
                          const databaseId = event.target.value;
                          if (databaseId) onLoadDatabase(databaseId);
                          replace(index, {
                            ...action,
                            databaseId,
                            recordId: "",
                            propertyId: "",
                            value: "",
                          });
                        }}
                        className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="">Choose a database…</option>
                        {databases.map((database) => (
                          <option key={database.id} value={database.id}>{database.name}</option>
                        ))}
                      </select>
                    </label>

                    <ExistingRecordPicker
                      key={action.databaseId}
                      records={databaseRecords[action.databaseId] ?? []}
                      value={action.recordId}
                      onChange={(recordId) => replace(index, { ...action, recordId })}
                    />

                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Property to update
                      <select
                        value={action.propertyId}
                        onChange={(event) => {
                          const property = targetProperties.find((candidate) => candidate.id === event.target.value);
                          const next = property
                            ? defaultButtonActionValue(property.type)
                            : "";
                          replace(index, { ...action, propertyId: event.target.value, value: next });
                        }}
                        className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="">Choose a property…</option>
                        {targetProperties.map((property) => (
                          <option key={property.id} value={property.id}>{property.name}</option>
                        ))}
                      </select>
                    </label>

                    <div className="grid gap-1 text-xs text-muted-foreground">
                      New value
                      {valueEditor(
                        targetProperty,
                        action.value,
                        (value) => replace(index, { ...action, value }),
                        "Existing record value",
                        properties,
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Property to set
                      <select
                        value={action.propertyId}
                        onChange={(event) => {
                          const property = targetProperties.find((candidate) => candidate.id === event.target.value);
                          const next = property
                            ? defaultButtonActionValue(property.type)
                            : "";
                          replace(index, { ...action, propertyId: event.target.value, value: next });
                        }}
                        className="min-h-9 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                      >
                        <option value="">Choose a property…</option>
                        {targetProperties.map((property) => (
                          <option key={property.id} value={property.id}>{property.name}</option>
                        ))}
                      </select>
                    </label>

                    <div className="grid gap-1 text-xs text-muted-foreground">
                      New value
                      {valueEditor(targetProperty, action.value, (value) => replace(index, { ...action, value }), "Button action value", properties)}
                    </div>
                  </>
                )}

                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(actions.filter((_, actionIndex) => actionIndex !== index))}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={14} /> Remove action
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
