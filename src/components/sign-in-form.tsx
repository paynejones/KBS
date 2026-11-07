"use client";

import { type FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignInForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const next = new URLSearchParams(window.location.search).get("next");
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      const data: { error?: string; redirectTo?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");

      window.location.assign(data.redirectTo ?? "/");
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={signIn} className="space-y-3">
      <label htmlFor="workspace-password" className="block text-sm font-medium">
        Password
      </label>
      <Input
        id="workspace-password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "sign-in-error" : undefined}
      />
      {error && (
        <p id="sign-in-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={submitting || !password}
      >
        <LockKeyhole size={16} aria-hidden="true" />
        {submitting ? "Signing in…" : "Sign in"}
        {!submitting && <ArrowRight size={16} aria-hidden="true" />}
      </Button>
    </form>
  );
}
