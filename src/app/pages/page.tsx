
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
  tags: {
    id: string;
    name: string;
  }[];
};

export default function PagesPage() {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allTags, setAllTags] = useState<
  { id: string; name: string }[]
>([]);

  const [selectedTagId, setSelectedTagId] = useState("");

  useEffect(() => {
  let cancelled = false;

  async function fetchTags() {
    try {
      const response = await fetch("/api/tags");

      if (!response.ok) {
        throw new Error("Failed to load tags");
      }

      const data = await response.json();

      if (!cancelled) {
        setAllTags(data);
      }
    } catch (error) {
      console.error("Failed to load tags:", error);
    }
  }

  void fetchTags();

  return () => {
    cancelled = true;
  };
}, []);

  useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(search.trim());
  }, 300);

  return () => {
    clearTimeout(timer);
  };
  }, [search]);

useEffect(() => {
  let cancelled = false;

  async function fetchPages() {
    try {
      const params = new URLSearchParams();

      if (debouncedSearch) {
        params.set("q", debouncedSearch);
      }

      if (selectedTagId) {
        params.set("tagId", selectedTagId);
      }

      const response = await fetch(`/api/pages?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to load pages");
      }

      const data = await response.json();

      if (!cancelled) {
        setPages(data);
        setError("");
      }
    } catch (error) {
      if (!cancelled) {
        console.error("Failed to load pages:", error);
        setError("Failed to load pages. Please try again.");
      }
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  }

  void fetchPages();

  return () => {
    cancelled = true;
  };
}, [debouncedSearch, selectedTagId]);

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
        <div className="relative">
        <input
            type="search"
            placeholder="Search pages..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 pl-9 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
            </svg>
        </span>
        </div>
        <div className="flex items-center gap-3">
        <select
            value={selectedTagId}
            onChange={(event) => setSelectedTagId(event.target.value)}
            className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
        >
            <option value="">All tags</option>

            {allTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
                {tag.name}
            </option>
            ))}
        </select>

        {selectedTagId && (
            <button
            type="button"
            onClick={() => setSelectedTagId("")}
            className="text-sm text-muted-foreground hover:text-foreground"
            >
            Clear filter
            </button>
        )}
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading pages…</p>
        ) : pages.length === 0 ? (
          <div className="rounded-lg border p-8 text-center">
            <p className="font-medium">
            {search.trim() ? "No matching pages" : "No pages yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
            {search.trim()
            ? "Try a different search term."
            : "Create your first note to get started."}
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

                {page.tags.length > 0 && (
                <span className="mt-2 flex flex-wrap gap-2">
                    {page.tags.map((tag) => (
                    <span
                        key={tag.id}
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                        {tag.name}
                    </span>
                    ))}
                </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
