"use client";

import { useSyncExternalStore } from "react";
import {
  getCalendarDaySnapshot,
  subscribeToCalendarDay,
} from "@/lib/calendar-day";

/**
 * The local calendar day, re-read when the clock passes midnight so relative
 * date filters and date windows follow the date instead of freezing it.
 */
export function useCalendarDay(): string {
  return useSyncExternalStore(
    subscribeToCalendarDay,
    getCalendarDaySnapshot,
    getCalendarDaySnapshot,
  );
}
