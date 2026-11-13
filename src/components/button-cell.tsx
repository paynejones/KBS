"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ButtonRunResponse, ButtonRunResult } from "@/lib/database-button";

export async function runDatabaseButton(
  databaseId: string,
  recordId: string,
  propertyId: string,
): Promise<ButtonRunResponse> {
  const response = await fetch(`/api/databases/${databaseId}/records/${recordId}/button`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId }),
  });
  const result = await response.json().catch(() => null) as (ButtonRunResponse & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(result?.error || "Could not run this button.");
  }
  if (!result) throw new Error("Could not run this button.");
  return result;
}

export function buttonResultMessage(results: ButtonRunResult[]) {
  if (results.length === 0) return "No actions ran.";
  return results
    .map((result) => `${result.label}: ${result.affected} ${result.affected === 1 ? "record" : "records"}`)
    .join(" · ");
}

export function ButtonCell({
  label,
  onRun,
  compact = false,
  disabled = false,
  onConfigure,
}: {
  label: string;
  onRun: () => Promise<string>;
  compact?: boolean;
  disabled?: boolean;
  onConfigure?: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  async function run() {
    if (running) return;
    setRunning(true);
    setMessage("");
    try {
      setMessage(await onRun());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not run this button.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={compact ? "min-w-0" : "space-y-1"}>
      <div className="flex min-w-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "default"}
          disabled={disabled || running}
          onClick={() => void run()}
          aria-label={`Run ${label}`}
          className={compact ? "h-7 max-w-full truncate px-2 text-xs" : "max-w-full truncate"}
        >
          {running ? "Running…" : label}
        </Button>
        {onConfigure && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || running}
            onClick={onConfigure}
            aria-label={`Configure ${label} button`}
            title="Edit button actions"
            className="size-7 shrink-0 text-muted-foreground"
          >
            <Settings2 size={13} />
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="break-words text-[11px] leading-snug text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
