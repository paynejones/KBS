
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type PageSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export default function PagesPage() {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadPages() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/pages");

      if (!response.ok) throw new Error("Unable to load pages.");

      setPages(await response.json());
    } catch {
      setError("Could not load your pages. Check that the server is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPages();
  }, []);

  async function createPage() {
    setError("");

    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      });

      if (!response.ok) throw new Error("Unable to create page.");

      const page = await response.json();
      router.push(`/pages/${page.id}`);
    } catch {
      setError("Could not create a page. Please try again.");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Pages</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your notes and documents.
            </p>
          </div>

          <Button onClick={() => void createPage()}>
            New page
          </Button>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading pages…</p>
        ) : pages.length === 0 ? (
          <div className="rounded-lg border p-8 text-center">
            <p className="font-medium">No pages yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your first note to get started.
            </p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {pages.map((page) => (
              <Link
                key={page.id}
                href={`/pages/${page.id}`}
                className="block px-4 py-3 hover:bg-accent"
              >
                <span className="font-medium">{page.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Updated {new Date(page.updatedAt).toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
