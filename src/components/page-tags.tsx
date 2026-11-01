
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Tag = {
  id: string;
  name: string;
};

export function PageTags({ pageId }: { pageId: string }) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assignedTags, setAssignedTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadTags() {
    try {
      const [allResponse, assignedResponse] = await Promise.all([
        fetch("/api/tags"),
        fetch(`/api/pages/${pageId}/tags`),
      ]);

      if (!allResponse.ok || !assignedResponse.ok) {
        throw new Error("Failed to load tags.");
      }

      const [allData, assignedData] = await Promise.all([
        allResponse.json(),
        assignedResponse.json(),
      ]);

      setAllTags(allData);
      setAssignedTags(assignedData);
    } catch (error) {
      console.error("Failed to load tags:", error);
      setError("Could not load tags.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchTags() {
      try {
        const [allResponse, assignedResponse] = await Promise.all([
          fetch("/api/tags"),
          fetch(`/api/pages/${pageId}/tags`),
        ]);

        if (!allResponse.ok || !assignedResponse.ok) {
          throw new Error("Failed to load tags.");
        }

        const [allData, assignedData] = await Promise.all([
          allResponse.json(),
          assignedResponse.json(),
        ]);

        if (!cancelled) {
          setAllTags(allData);
          setAssignedTags(assignedData);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load tags:", error);
          setError("Could not load tags.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchTags();

    return () => {
      cancelled = true;
    };
  }, [pageId]);

  async function assignTag(tagId: string) {
    const response = await fetch(`/api/pages/${pageId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    });

    if (!response.ok) {
      throw new Error("Failed to assign tag.");
    }

    await loadTags();
  }

  async function createTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const name = newTagName.trim();

    if (!name) return;

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error("Failed to create tag.");
      }

      const tag: Tag = await response.json();

      await assignTag(tag.id);

      setNewTagName("");
    } catch (error) {
      console.error("Failed to create tag:", error);
      setError("Could not create or assign tag.");
    }
  }

  async function removeTag(tagId: string) {
    setError("");

    try {
      const response = await fetch(`/api/pages/${pageId}/tags`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });

      if (!response.ok) {
        throw new Error("Failed to remove tag.");
      }

      await loadTags();
    } catch (error) {
      console.error("Failed to remove tag:", error);
      setError("Could not remove tag.");
    }
  }

  const availableTags = allTags.filter(
    (tag) => !assignedTags.some((assigned) => assigned.id === tag.id)
  );

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading tags...</p>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Tags</h2>

      <div className="flex flex-wrap gap-2">
        {assignedTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tags assigned.
          </p>
        ) : (
          assignedTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => void removeTag(tag.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${tag.name} tag`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={selectedTagId}
          onChange={(event) => setSelectedTagId(event.target.value)}
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Choose an existing tag...</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        <Button
          type="button"
          variant="outline"
          disabled={!selectedTagId}
          onClick={async () => {
            try {
              setError("");
              await assignTag(selectedTagId);
              setSelectedTagId("");
            } catch {
              setError("Could not assign tag.");
            }
          }}
        >
          Add tag
        </Button>
      </div>

      <form onSubmit={createTag} className="flex flex-wrap gap-2">
        <input
          value={newTagName}
          onChange={(event) => setNewTagName(event.target.value)}
          placeholder="Create a new tag..."
          maxLength={50}
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />

        <Button type="submit" variant="outline" disabled={!newTagName.trim()}>
          Create tag
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
