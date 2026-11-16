"use client";

import { useState, useSyncExternalStore } from "react";
import { Database, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  clearDatabaseDisplayPreferences,
  getDatabaseDisplayPreferencesSnapshot,
  getEmptySettingsPreferencesSnapshot,
  subscribeToSettingsPreferences,
} from "@/lib/settings-preferences";

export function DatabaseDisplaySettings() {
  const count = useSyncExternalStore(
    subscribeToSettingsPreferences,
    getDatabaseDisplayPreferencesSnapshot,
    getEmptySettingsPreferencesSnapshot,
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState("");

  function resetPreferences() {
    const removed = clearDatabaseDisplayPreferences();
    setConfirmReset(false);
    setNotice(
      removed > 0
        ? `Cleared ${removed} saved database display setting${removed === 1 ? "" : "s"}.`
        : "There were no saved database display settings to clear.",
    );
  }

  return (
    <SettingsSection
      id="database-display"
      title="Database display"
      icon={<Database size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="The view a database opens on, hidden view tabs, and hidden entry-page properties are reading choices kept in this browser."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">
            {count} saved database display setting{count === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reset to let every database start from its default view and show all tabs and
            properties.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={count === 0}
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw size={15} /> Reset preferences
        </Button>
      </div>

      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset database display preferences?</AlertDialogTitle>
            <AlertDialogDescription>
              Clear {count} saved database display setting{count === 1 ? "" : "s"} across every
              database in this browser? Database content is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={resetPreferences}>
              <RotateCcw size={14} aria-hidden="true" /> Reset preferences
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
