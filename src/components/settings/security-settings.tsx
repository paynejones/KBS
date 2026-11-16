"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";

export function SecuritySettings() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/signin");
      router.refresh();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <SettingsSection
      id="security"
      title="Security"
      icon={<ShieldCheck size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="Sign out of this browser when you are finished."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">Sign out</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            End this browser session. Local appearance preferences stay on this device.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void signOut()}
          disabled={leaving}
        >
          <LogOut size={15} aria-hidden="true" /> {leaving ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </SettingsSection>
  );
}
