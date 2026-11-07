"use client";

import { ChangeEvent, useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { FILE_MIME_TYPES, formatFileSize } from "@/lib/media";

/**
 * One file at a time, from the same image and PDF types the attachment route
 * accepts. Selecting a file replaces the previous one; the input keeps its
 * stable label so it stays reachable after a replacement.
 */
export function CaptureFilePicker({
  file,
  onSelect,
  onClear,
  disabled,
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (next) onSelect(next);
    // Allow choosing the same file again after removing it.
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-2">
      {file && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <Paperclip size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove attached file"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
        <Paperclip size={16} aria-hidden="true" />
        {file ? "Replace file" : "Attach an image or PDF"}
        <input
          ref={input}
          type="file"
          accept={FILE_MIME_TYPES.join(",")}
          onChange={choose}
          disabled={disabled}
          aria-label="Attach an image or PDF"
          className="sr-only"
        />
      </label>
    </div>
  );
}
