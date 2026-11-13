"use client";

import { useState } from "react";
import { Trash2, Upload, X } from "lucide-react";
import { AttachmentFileLink } from "@/components/attachment-preview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  LINKED_FILE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  parseFilePropertyValue,
  pickLocalFile,
  uploadAttachment,
  type FilePropertyValue,
} from "@/lib/media";

/**
 * A database file property with upload, replace, and remove controls. Shared by
 * the database table, board cards, and the full record page so all three save
 * the same value shape.
 */
export function FileCell({
  label,
  value,
  onChange,
  compact = false,
  disabled = false,
  readOnly = false,
}: {
  label: string;
  value: unknown;
  onChange: (next: FilePropertyValue | null) => void;
  compact?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const file = parseFilePropertyValue(value);

  async function chooseFile() {
    const picked = await pickLocalFile(LINKED_FILE_MIME_TYPES.join(","));
    if (!picked) return;
    if (!LINKED_FILE_MIME_TYPES.includes(picked.type)) {
      setError("That file type is not supported.");
      return;
    }
    if (picked.size > MAX_ATTACHMENT_BYTES) {
      setError("Files must be 10 MB or smaller.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const uploaded = await uploadAttachment(picked);
      onChange({
        attachmentId: uploaded.id,
        url: uploaded.url,
        alt: "",
        filename: uploaded.filename,
        mimeType: uploaded.mimeType,
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload this file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={compact ? "space-y-1" : "px-2 py-1.5"}>
      {file ? (
        <AttachmentFileLink
          url={file.url}
          filename={file.filename || file.alt}
          mimeType={file.mimeType}
        />
      ) : (
        <span className="block text-xs text-muted-foreground">
          {value === null || value === undefined || value === ""
            ? "No file"
            : "This file value can’t be displayed."}
        </span>
      )}
      {!readOnly && (
      <div className="mt-1 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void chooseFile()}
          disabled={disabled || uploading}
          aria-label={`${file ? "Replace" : "Upload"} ${label} file`}
        >
          <Upload size={13} aria-hidden="true" />
          {uploading ? "Uploading…" : file ? "Replace" : "Upload"}
        </Button>
        {file && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setConfirmRemove(true)}
            disabled={disabled || uploading}
            aria-label={`Remove ${label} file`}
            title="Remove file"
          >
            <X size={13} aria-hidden="true" />
          </Button>
        )}
      </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      {!readOnly && <AlertDialog open={confirmRemove} onOpenChange={(open) => setConfirmRemove(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              {file?.filename ? `“${file.filename}”` : "This file"} will be removed from {label}. The property stays ready for a new upload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                setError("");
                onChange(null);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Remove file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
  );
}
