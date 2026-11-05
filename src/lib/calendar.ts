export type CalendarDay = {
  /** `YYYY-MM-DD` in local date space. */
  key: string;
  day: number;
  inMonth: boolean;
};

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Reads a stored date value as `YYYY-MM-DD`. Plain date inputs already use this
 * shape; full ISO timestamps keep their date part so a timezone offset cannot
 * push a record into the previous day.
 */
export function dateKey(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function shiftMonth(year: number, month: number, delta: number) {
  const shifted = new Date(Date.UTC(year, month + delta, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

function keyFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Six weeks of days covering the month, starting on Monday so weekend days sit
 * together. Leading and trailing cells belong to the adjacent months.
 */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month, 1 - offset));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    return {
      key: keyFromUtc(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month && date.getUTCFullYear() === year,
    };
  });
}

export function groupRecordsByDate<T>(
  records: T[],
  getDate: (record: T) => unknown,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const record of records) {
    const key = dateKey(getDate(record));
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }

  return groups;
}

export function todayKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
