import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  Calculator,
  Check,
  CircleDot,
  Hash,
  Link2,
  Minus,
  MousePointerClick,
  Paperclip,
  Share2,
  Sigma,
  SquareCheck,
  Tags,
  Type,
} from "lucide-react";
import {
  DATABASE_PROPERTY_TYPE_LABELS,
  type DatabasePropertyType,
} from "@/lib/database-property";
import { statusToneClass } from "@/lib/status-tone";

/**
 * One colour vocabulary for every property type, so a Number reads the same in
 * the table, a gallery card, a record page, and an embed. Tones are deliberately
 * separate from status tones: a type keeps its colour wherever it appears, while
 * a Select choice keeps the colour its word implies.
 */
const PROPERTY_TYPE_TONES: Record<
  DatabasePropertyType,
  { badge: string; icon: string }
> = {
  text: {
    badge:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300",
    icon: "text-slate-400",
  },
  number: {
    badge:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300",
    icon: "text-sky-500",
  },
  checkbox: {
    badge:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
    icon: "text-emerald-500",
  },
  date: {
    badge:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
    icon: "text-amber-500",
  },
  url: {
    badge:
      "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-300",
    icon: "text-cyan-500",
  },
  select: {
    badge:
      "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300",
    icon: "text-violet-500",
  },
  multi_select: {
    badge:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900 dark:bg-fuchsia-950/60 dark:text-fuchsia-300",
    icon: "text-fuchsia-500",
  },
  relation: {
    badge:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300",
    icon: "text-indigo-500",
  },
  rollup: {
    badge:
      "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950/60 dark:text-purple-300",
    icon: "text-purple-500",
  },
  formula: {
    badge:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-300",
    icon: "text-teal-500",
  },
  file: {
    badge:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300",
    icon: "text-orange-500",
  },
  button: {
    badge:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300",
    icon: "text-rose-500",
  },
};

const TYPE_ICONS: Record<DatabasePropertyType, LucideIcon> = {
  text: Type,
  number: Hash,
  checkbox: SquareCheck,
  date: CalendarDays,
  url: Link2,
  select: CircleDot,
  multi_select: Tags,
  relation: Share2,
  rollup: Sigma,
  formula: Calculator,
  file: Paperclip,
  button: MousePointerClick,
};

const FALLBACK_TONE = PROPERTY_TYPE_TONES.text;

function toneFor(type: string) {
  return PROPERTY_TYPE_TONES[type as DatabasePropertyType] ?? FALLBACK_TONE;
}

export function propertyTypeIcon(type: string): LucideIcon {
  return TYPE_ICONS[type as DatabasePropertyType] ?? Type;
}

export function propertyTypeLabel(type: string): string {
  return DATABASE_PROPERTY_TYPE_LABELS[type as DatabasePropertyType] ?? type;
}

/** A small coloured icon that marks a property's type in headers and labels. */
export function PropertyTypeIcon({
  type,
  size = 13,
  className = "",
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const classes = `shrink-0 ${toneFor(type).icon} ${className}`;
  switch (type) {
    case "number":
      return <Hash size={size} aria-hidden="true" className={classes} />;
    case "checkbox":
      return <SquareCheck size={size} aria-hidden="true" className={classes} />;
    case "date":
      return <CalendarDays size={size} aria-hidden="true" className={classes} />;
    case "url":
      return <Link2 size={size} aria-hidden="true" className={classes} />;
    case "select":
      return <CircleDot size={size} aria-hidden="true" className={classes} />;
    case "multi_select":
      return <Tags size={size} aria-hidden="true" className={classes} />;
    case "relation":
      return <Share2 size={size} aria-hidden="true" className={classes} />;
    case "rollup":
      return <Sigma size={size} aria-hidden="true" className={classes} />;
    case "formula":
      return <Calculator size={size} aria-hidden="true" className={classes} />;
    case "file":
      return <Paperclip size={size} aria-hidden="true" className={classes} />;
    case "button":
      return <MousePointerClick size={size} aria-hidden="true" className={classes} />;
    default:
      return <Type size={size} aria-hidden="true" className={classes} />;
  }
}

/** A compact coloured badge naming the property type. */
export function PropertyTypeBadge({
  type,
  className = "",
}: {
  type: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneFor(type).badge} ${className}`}
    >
      <PropertyTypeIcon type={type} size={10} />
      {propertyTypeLabel(type)}
    </span>
  );
}

/** Select and multi-select values as status-coloured chips. */
export function StatusChips({
  values,
  empty = "—",
}: {
  values: string[];
  empty?: string;
}) {
  if (values.length === 0) {
    return <span className="text-sm text-muted-foreground">{empty}</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {values.map((value) => (
        <span
          key={value}
          className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${statusToneClass(value)}`}
        >
          <span className="size-1 shrink-0 rounded-full bg-current" />
          {value}
        </span>
      ))}
    </span>
  );
}

/** A Yes/No pill, so a checkbox reads as a state rather than a word. */
export function BooleanPill({ value }: { value: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        value
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {value ? (
        <Check size={11} aria-hidden="true" />
      ) : (
        <Minus size={11} aria-hidden="true" />
      )}
      {value ? "Yes" : "No"}
    </span>
  );
}

function shortDate(value: string): string {
  const text = value.slice(0, 10);
  if (!text) return "";

  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** A calendar-marked date instead of a bare ISO string. */
export function DateLabel({ value }: { value: string }) {
  const text = shortDate(value);
  if (!text) return <span className="text-sm text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-center gap-1 text-sm tabular-nums">
      <CalendarDays
        size={12}
        aria-hidden="true"
        className={toneFor("date").icon}
      />
      {text}
    </span>
  );
}

/** A rollup or formula value, marked so it is not mistaken for typed data. */
export function CalculatedValue({ value }: { value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
      <Sigma size={12} aria-hidden="true" className={toneFor("formula").icon} />
      <span className="text-foreground">{value}</span>
    </span>
  );
}
