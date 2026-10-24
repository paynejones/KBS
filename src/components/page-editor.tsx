
"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";

type PageData = {
  id: string;
  title: string;
  content: string;
  contentJson: Record<string, unknown>;
};

type SaveStatus = "loading" | "saved" | "saving" | "error";

export function PageEditor({ id }: { id: string }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);


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

    let timer: ReturnType<typeof setTimeout> | undefined;

    const handleUpdate = () => {
      setStatus("saving");
      if (timer) clearTimeout(timer);

      timer = setTimeout(() => {
        void savePage({
          content: editor.getText(),
          contentJson: editor.getJSON() as Record<string, unknown>,
        });
      }, 800);
    };

    editor.setEditable(true);
    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [editor, loaded, savePage]);

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
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
