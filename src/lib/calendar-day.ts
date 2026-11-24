import { todayKey } from "@/lib/calendar";

type Listener = () => void;

const listeners = new Set<Listener>();
let timer: number | null = null;
let watchingWake = false;

/**
 * Time until the next local midnight, plus a quarter second so the date has
 * certainly rolled over. A clock jump backwards still waits at least a second.
 */
export function msUntilNextCalendarDay(now: Date = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    250,
  );
  return Math.max(1_000, nextMidnight.getTime() - now.getTime());
}

function notify() {
  for (const listener of listeners) listener();
}

function scheduleNextDay() {
  if (typeof window === "undefined") return;
  if (timer !== null) window.clearTimeout(timer);

  timer = window.setTimeout(() => {
    timer = null;
    notify();
    if (listeners.size > 0) scheduleNextDay();
  }, msUntilNextCalendarDay());
}

/**
 * A sleeping machine can wake past midnight with the timer still pending, so
 * returning to the tab re-reads the day and re-arms the timer.
 */
function handleWake() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  notify();
  scheduleNextDay();
}

function watchWake() {
  if (watchingWake || typeof window === "undefined") return;
  document.addEventListener("visibilitychange", handleWake);
  window.addEventListener("focus", handleWake);
  watchingWake = true;
}

function unwatchWake() {
  if (!watchingWake) return;
  document.removeEventListener("visibilitychange", handleWake);
  window.removeEventListener("focus", handleWake);
  watchingWake = false;
}

/**
 * One timer serves every view that asks for the day, so a page with several
 * databases and embeds still schedules a single wake-up.
 */
export function subscribeToCalendarDay(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    scheduleNextDay();
    watchWake();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;

    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    unwatchWake();
  };
}

/** The browser's current day; React re-reads it when the day rolls over. */
export function getCalendarDaySnapshot(): string {
  return todayKey();
}
