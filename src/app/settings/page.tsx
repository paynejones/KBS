"use client";

import { type FormEvent, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (newPassword.trim().length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`);
      return;
    }

    if (newPassword !== confirmation) {
      setError("The new password and its confirmation do not match.");
      return;
    }

    if (newPassword === currentPassword) {
      setError("The new password must be different from the current one.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data: { error?: string } = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data.error ?? "Could not change the password.");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setStatus(
        "Password changed. This browser stays signed in and every other browser has been signed out.",
      );
    } catch (changeError) {
      setError(
        changeError instanceof Error ? changeError.message : "Could not change the password.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl space-y-10">
        <header>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
            WORKSPACE
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
          <p className="mt-2 text-muted-foreground">
            Controls for reaching this workspace. Changes apply immediately, with no restart.
          </p>
        </header>

        <section aria-labelledby="password-heading" className="rounded-xl border bg-card p-5">
          <h2
            id="password-heading"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <KeyRound size={17} className="text-muted-foreground" aria-hidden="true" />
            Workspace password
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            The new password is stored as a salted hash and takes effect on the next request.
            Because a session is tied to the current password, every other browser is signed out.
          </p>

          <form onSubmit={changePassword} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="current-password" className="block text-sm font-medium">
                Current password
              </label>
              <Input
                id="current-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={MAX_PASSWORD_LENGTH}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="new-password" className="block text-sm font-medium">
                New password
              </label>
              <Input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-describedby="new-password-hint"
              />
              <p id="new-password-hint" className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="block text-sm font-medium">
                Confirm new password
              </label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-describedby={error ? "password-error" : undefined}
                aria-invalid={error ? true : undefined}
              />
            </div>

            {error && (
              <p id="password-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {status && (
              <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldCheck
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                {status}
              </p>
            )}

            <Button
              type="submit"
              disabled={saving || !currentPassword || !newPassword || !confirmation}
            >
              {saving ? "Saving…" : "Change password"}
            </Button>
          </form>

          <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
            The new password is kept in{" "}
            <code className="rounded bg-muted px-1 py-0.5">data/auth-credential.json</code> (or the
            file named by{" "}
            <code className="rounded bg-muted px-1 py-0.5">KBS_AUTH_CREDENTIAL_PATH</code>). Keep{" "}
            <code className="rounded bg-muted px-1 py-0.5">KBS_AUTH_PASSWORD</code> set on the
            server: removing the credential file falls back to it, which is the way back in if the
            new password is forgotten.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
