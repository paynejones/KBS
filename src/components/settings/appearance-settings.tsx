"use client";

import { Palette } from "lucide-react";
import { ThemePicker } from "@/components/theme-picker";
import { SettingsSection } from "@/components/settings/settings-section";

export function AppearanceSettings() {
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      icon={<Palette size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="Choose how the workspace looks in this browser."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Color theme</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Light, dark, and five reading palettes.
          </p>
        </div>
        <ThemePicker />
      </div>
    </SettingsSection>
  );
}
