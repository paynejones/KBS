/**
 * Status is colour: select values used by database views and dashboard widgets
 * share one tone map, so the same word always reads the same way.
 */
const STATUS_TONES: { pattern: RegExp; className: string }[] = [
  {
    pattern: /^(done|complete|completed|read|finished|shipped|paid)$/i,
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    pattern:
      /(in progress|in review|doing|active|reading|watching|playing|started)/i,
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  },
  {
    pattern: /(blocked|waiting|on hold|paused|stuck)/i,
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    pattern: /(to review|needs review|overdue|dropped|abandoned)/i,
    className: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
  {
    pattern: /(planned|backlog|todo|queued|idea|someday|not started)/i,
    className: "bg-muted text-muted-foreground",
  },
];

const NEUTRAL_TONE = "bg-muted text-muted-foreground";

export function statusToneClass(value: string): string {
  return (
    STATUS_TONES.find((tone) => tone.pattern.test(value))?.className ??
    NEUTRAL_TONE
  );
}
