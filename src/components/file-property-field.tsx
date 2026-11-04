"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MediaImage } from "@/components/media-image";
import {
  type FilePropertyValue,
  fileValueSearchText,
  isAllowedMediaUrl,
  isImageMimeType,
  parseFilePropertyValue,
  pickLocalFile,
  uploadAttachment,
} from "@/lib/media";

function asFileValue(value: unknown): FilePropertyValue | null {
  return parseFilePropertyValue(value) ?? null;
}

export function FilePropertyField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  disabled?: boolean;
  onChange: (next: FilePropertyValue | null) => void;
}) {
  const current = asFileValue(value);
  const [urlDraft, setUrlDraft] = useState(current && !current.attachmentId ? current.url : "");
  const [altDraft, setAltDraft] = useState(current?.alt ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload() {
    setBusy(true);
    setError("");
    try {
      const file = await pickLocalFile("image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf");
      if (!file) return;
      const uploaded = await uploadAttachment(file);
      onChange({
        attachmentId: uploaded.id,
        url: uploaded.url,
        alt: altDraft.trim(),
        filename: uploaded.filename,
        mimeType: uploaded.mimeType,
      });
      setUrlDraft("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the file.");
    } finally {
      setBusy(false);
    }
  }

  function saveRemoteUrl() {
    const url = urlDraft.trim();
    if (!url) {
      onChange(null);
      return;
    }
    if (!isAllowedMediaUrl(url) || url.startsWith("/api/attachments/")) {
      setError("Enter an http:// or https:// image URL.");
      return;
    }
    setError("");
    onChange({
      attachmentId: null,
      url,
      alt: altDraft.trim(),
      filename: current?.filename ?? "",
      mimeType: current?.mimeType ?? "",
    });
  }

  function saveAlt() {
    if (!current) return;
    onChange({ ...current, alt: altDraft.trim() });
  }

  const previewIsImage = current && (current.mimeType ? isImageMimeType(current.mimeType) : true);

  return (
    <div className="space-y-2 px-1 py-1">
      {current && previewIsImage && (
        <MediaImage src={current.url} alt={current.alt || label} className="h-20 w-full rounded object-cover" />
      )}
      {current && !previewIsImage && (
        <a href={current.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-primary hover:underline">
          {current.filename || current.url}
        </a>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
        {current && (
          <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={() => { onChange(null); setUrlDraft(""); setAltDraft(""); }}>
            Remove
          </Button>
        )}
      </div>
      <input
        aria-label={`${label} URL`}
        value={urlDraft}
        placeholder="https://…"
        disabled={disabled || busy}
        onChange={(event) => setUrlDraft(event.target.value)}
        onBlur={saveRemoteUrl}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        className="w-full rounded px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <input
        aria-label={`${label} alt text`}
        value={altDraft}
        placeholder="Alt text"
        disabled={disabled || busy || !current}
        onChange={(event) => setAltDraft(event.target.value)}
        onBlur={saveAlt}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        className="w-full rounded px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FilePropertyPreview({ value, fallback }: { value: unknown; fallback: string }) {
  const current = asFileValue(value);
  if (!current) return <span className="text-sm text-muted-foreground">No file</span>;
  if (current.mimeType && !isImageMimeType(current.mimeType)) {
    return (
      <a href={current.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
        {current.filename || fileValueSearchText(current) || fallback}
      </a>
    );
  }
  return <MediaImage src={current.url} alt={current.alt || fallback} className="h-36 w-full object-cover" />;
}
