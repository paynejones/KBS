"use client";

import { AttachmentTypeIcon } from "@/components/attachment-preview";
import { MediaImage } from "@/components/media-image";
import {
  attachmentTypeLabel,
  formatFileSize,
  isImageMimeType,
  type CapturedAttachment,
} from "@/lib/media";

/** The stored file behind an inbox capture, rendered as an image or a file row. */
export function InboxAttachmentPreview({ attachment }: { attachment: CapturedAttachment }) {
  if (isImageMimeType(attachment.mimeType)) {
    return (
      <figure className="mt-4 overflow-hidden rounded-lg border bg-muted/20">
        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block bg-background">
          <MediaImage
            src={attachment.url}
            alt={attachment.filename}
            className="mx-auto max-h-72 w-auto max-w-full object-contain"
          />
        </a>
        <figcaption className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <AttachmentTypeIcon mimeType={attachment.mimeType} size={14} />
          <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
          <span className="shrink-0">{formatFileSize(attachment.size)}</span>
        </figcaption>
      </figure>
    );
  }

  const label = attachmentTypeLabel(attachment.mimeType, attachment.filename);

  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <AttachmentTypeIcon mimeType={attachment.mimeType} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attachment.filename}</p>
        <p className="text-xs text-muted-foreground">
          {label} · {formatFileSize(attachment.size)}
        </p>
      </div>
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${attachment.filename} in a new tab`}
        className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
      >
        Open {label}
      </a>
    </div>
  );
}
