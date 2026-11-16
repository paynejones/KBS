"use client";

import { Settings2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { DatabaseDisplaySettings } from "@/components/settings/database-display-settings";
import { DataSafetySettings } from "@/components/settings/data-safety-settings";
import { EditorDraftsSettings } from "@/components/settings/editor-drafts-settings";
import { HomeLayoutSettings } from "@/components/settings/home-layout-settings";
import { NavigationSettings } from "@/components/settings/navigation-settings";
import { PasswordSettings } from "@/components/settings/password-settings";
import { SecuritySettings } from "@/components/settings/security-settings";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Settings2 size={22} aria-hidden="true" /> Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workspace and browser preferences. Changes save automatically.
          </p>
        </header>

        <AppearanceSettings />
        <NavigationSettings />
        <HomeLayoutSettings />
        <DatabaseDisplaySettings />
        <EditorDraftsSettings />
        <DataSafetySettings />
        <SecuritySettings />
        <PasswordSettings />
      </div>
    </AppShell>
  );
}
