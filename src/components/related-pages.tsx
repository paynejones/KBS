"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lightbulb, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Suggestion = {
  id: string;
  title: string;
  score: number;
  reasons: string[];
};

/**
 * Optional suggestions built from tags, page links, and record links the
 * workspace already has. Each entry says why it was suggested; connecting one
 * is an explicit action, and dismissing it only hides it for this visit.
 */
export function RelatedPages({ pageId }: { pageId: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSuggestions() {
      try {
        const response = await fetch(`/api/pages/${pageId}/related`);
        if (!response.ok) return;
        const data = (await response.json()) as { suggestions: Suggestion[] };
        if (!cancelled) setSuggestions(data.suggestions);
      } catch {
        // Suggestions are context, not content: a failed fetch hides the panel.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  async function linkSuggestion(targetPageId: string) {
    setLinking(targetPageId);
    setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPageId }),
      });
      if (!response.ok) throw new Error("Could not link this page.");
      setSuggestions((current) => current.filter((item) => item.id !== targetPageId));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not link this page.");
    } finally {
      setLinking("");
    }
  }

  function dismissSuggestion(suggestionId: string) {
    setDismissed((current) => new Set(current).add(suggestionId));
  }

  const visible = suggestions.filter((suggestion) => !dismissed.has(suggestion.id));

  // Nothing to offer is the common case, and the panel should not take space
  // just to say so.
  if (loading || visible.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-labelledby="related-pages-heading"
    >
      <div className="flex items-center gap-2">
        <Lightbulb size={16} className="text-muted-foreground" aria-hidden="true" />
        <h2 id="related-pages-heading" className="font-medium">
          Suggested pages
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Based on shared tags, links, and records. Suggestions are hints: connect one
        only if it helps.
      </p>

      <ul className="space-y-3">
        {visible.map((suggestion) => (
          <li key={suggestion.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Link
                href={`/pages/${suggestion.id}`}
                className="text-sm font-medium hover:underline"
              >
                {suggestion.title || "Untitled"}
              </Link>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void linkSuggestion(suggestion.id)}
              disabled={linking === suggestion.id}
            >
              <Plus size={13} aria-hidden="true" />
              Link
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => dismissSuggestion(suggestion.id)}
              aria-label={`Dismiss ${suggestion.title || "Untitled"}`}
              title="Dismiss suggestion"
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
