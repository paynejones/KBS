"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOutButton() {
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
    <button
      type="button"
      onClick={signOut}
      disabled={leaving}
      aria-label="Sign out"
      title="Sign out"
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <LogOut size={14} aria-hidden="true" />
    </button>
  );
}
