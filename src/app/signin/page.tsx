import type { Metadata } from "next";
import { BookOpenText } from "lucide-react";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Knowledge Base",
  description: "Sign in to your personal knowledge workspace.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-muted/25 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand/60 text-white shadow-sm">
            <BookOpenText size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Knowledge Base</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the workspace password to continue.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-background p-5 shadow-sm">
          <SignInForm />
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Single-user workspace. Sessions last 30 days.
        </p>
      </div>
    </main>
  );
}
