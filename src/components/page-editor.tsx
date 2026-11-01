
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";
import { EditorToolbar } from "@/components/editor-toolbar";
import { PageTags } from "@/components/page-tags";

type PageData = {
  id: string;
  title: string;
  content: string;
  contentJson: Record<string, unknown>;
  parentId: string | null;
};

type SaveStatus = "loading" | "saved" | "saving" | "error";

export function PageEditor({ id }: { id: string }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInProgress = useRef(false);
  const dirty = useRef(false);
  const latestContent = useRef<{
    content: string;
    contentJson: Record<string, unknown>;
  }>({
    content: "",
    contentJson: {},
  });
  const [parentId, setParentId] = useState<string | null>(null);
  const [allPages, setAllPages] = useState<
    { id: string; title: string; parentId: string | null }[]
  >([]);
  const [moving, setMoving] = useState(false);


  const editor = useEditor({
    extensions: [StarterKit],
    immediatelyRender: false,
    content: "",
    editable: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[400px] outline-none prose prose-neutral max-w-none dark:prose-invert",
      },
    },
  });

  useEffect(() => {
  let cancelled = false;

  async function loadPages() {
    try {
      const response = await fetch("/api/pages");

      if (!response.ok) {
        throw new Error("Unable to load pages.");
      }

      const data = await response.json();

      if (!cancelled) {
        setAllPages(data);
      }
    } catch (error) {
      console.error("Failed to load pages:", error);
    }
  }

  void loadPages();

  return () => {
    cancelled = true;
  };
}, [id]);

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      try {
        setStatus("loading");
        const response = await fetch(`/api/pages/${id}`);

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Page not found."
              : "Unable to load page.",
          );
        }

        const page: PageData = await response.json();

        if (cancelled) return;

        setTitle(page.title);
        setParentId(page.parentId ?? null);
        editor?.commands.setContent(
          page.contentJson?.type
            ? page.contentJson as Parameters<
                typeof editor.commands.setContent
              >[0]
            : page.content || "",
        );
        setLoaded(true);
        setStatus("saved");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unable to load page.");
          setStatus("error");
        }
      }
    }

    if (editor) {
      void loadPage();
    }

    return () => {
      cancelled = true;
    };
  }, [editor, id]);

  const savePage = useCallback(
  async (updates: {
    title?: string;
    content?: string;
    contentJson?: Record<string, unknown>;
  }) => {
    setStatus("saving");
    setError("");

    try {
      const response = await fetch(`/api/pages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Save failed. Please try again.");
      }

      setStatus("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setStatus("error");
    }
  },
  [id],
);

useEffect(() => {
  if (!editor || !loaded) return;

  let cancelled = false;

  async function flushSave() {
    if (saveInProgress.current || !dirty.current) return;

    saveInProgress.current = true;
    dirty.current = false;

    const snapshot = { ...latestContent.current };

    try {
      await savePage(snapshot);
    } finally {
      saveInProgress.current = false;

      if (!cancelled && dirty.current) {
        void flushSave();
      }
    }
  }

  const handleUpdate = () => {
    latestContent.current = {
      content: editor.getText(),
      contentJson: editor.getJSON() as Record<string, unknown>,
    };

    dirty.current = true;
    setStatus("saving");

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 800);
  };

  editor.setEditable(true);
  editor.on("update", handleUpdate);

  return () => {
    cancelled = true;
    editor.off("update", handleUpdate);

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
  };
}, [editor, loaded, savePage]);

async function movePage(newParentId: string) {
  const nextParentId = newParentId || null;

  if (nextParentId === parentId) return;

  setMoving(true);
  setError("");

  try {
    const response = await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: nextParentId,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to move page.");
    }

    setParentId(nextParentId);

    window.dispatchEvent(new Event("pages-updated"));
  } catch (error) {
    setError(
      error instanceof Error ? error.message : "Unable to move page."
    );
  } finally {
    setMoving(false);
  }
}

const unavailableParentIds = new Set([id]);

let foundDescendant = true;

while (foundDescendant) {
  foundDescendant = false;

  for (const page of allPages) {
    if (
      page.parentId &&
      unavailableParentIds.has(page.parentId) &&
      !unavailableParentIds.has(page.id)
    ) {
      unavailableParentIds.add(page.id);
      foundDescendant = true;
    }
  }
}

  if (status === "loading" && !loaded) {
    return <p className="text-sm text-muted-foreground">Loading page…</p>;
  }

  if (!loaded) {
    return <p role="alert">{error || "Unable to open this page."}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void savePage({ title: title.trim() || "Untitled" })}
          aria-label="Page title"
          className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight outline-none"
        />

        <span className="shrink-0 text-xs text-muted-foreground" role="status">
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
          {status === "error" && "Save failed"}
          {status === "loading" && "Loading…"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label
            htmlFor="move-page"
            className="text-sm text-muted-foreground"
        >
            Move to:
        </label>

        <select
            id="move-page"
            value={parentId ?? ""}
            onChange={(event) => void movePage(event.target.value)}
            disabled={moving}
            className="max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
        >
            <option value="">Top level</option>

            {allPages
            .filter((page) => !unavailableParentIds.has(page.id))
            .map((page) => (
                <option key={page.id} value={page.id}>
                {page.title || "Untitled"}
                </option>
            ))}
        </select>

        {moving && (
            <span className="text-xs text-muted-foreground">
            Moving…
            </span>
        )}
        </div>

        <PageTags pageId={id} />

      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() =>
              void savePage({
                title,
                content: editor?.getText() ?? "",
                contentJson: editor?.getJSON() as
                  | Record<string, unknown>
                  | undefined,
              })
            }
          >
            Retry save
          </Button>
        </div>
      )}

      <div className="rounded-lg border p-5 md:p-8">
        <EditorToolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
