"use client";

import { useState, useSyncExternalStore } from "react";
import { FileText, Trash2 } from "lucide-react";
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
  clearPageDrafts,
  getEmptySettingsPreferencesSnapshot,
  getPageDraftsSnapshot,
  subscribeToSettingsPreferences,
} from "@/lib/settings-preferences";

export function EditorDraftsSettings() {
  const draftCount = useSyncExternalStore(
    subscribeToSettingsPreferences,
    getPageDraftsSnapshot,
    getEmptySettingsPreferencesSnapshot,
  );
  const [confirmClearDrafts, setConfirmClearDrafts] = useState(false);
  const [notice, setNotice] = useState("");

  function discardSavedDrafts() {
    const removed = clearPageDrafts();
    setConfirmClearDrafts(false);
    setNotice(
      removed > 0
        ? `Removed ${removed} recoverable page draft${removed === 1 ? "" : "s"}.`
        : "There were no saved drafts to remove.",
    );
  }

  return (
    <SettingsSection
      id="editor"
      title="Editor & drafts"
      icon={<FileText size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="Page edits save automatically, with a local recovery copy kept while a save is in progress."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">
            {draftCount} recoverable draft{draftCount === 1 ? "" : "s"} in this browser
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Discarding removes only the unsaved recovery copies. Saved pages are not affected.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={draftCount === 0}
          onClick={() => setConfirmClearDrafts(true)}
        >
          <Trash2 size={15} /> Discard drafts
        </Button>
      </div>

      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <AlertDialog open={confirmClearDrafts} onOpenChange={setConfirmClearDrafts}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard saved drafts?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently remove {draftCount} recoverable page draft
              {draftCount === 1 ? "" : "s"} from this browser? Saved pages are not affected, and
              this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discardSavedDrafts}>
              <Trash2 size={14} aria-hidden="true" /> Discard drafts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
