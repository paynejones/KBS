import { FileArchive, FileImage, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { attachmentKind, attachmentTypeLabel, type AttachmentKind } from "@/lib/media";

const ATTACHMENT_ICONS: Record<AttachmentKind, typeof FileText> = {
  image: FileImage,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  text: FileText,
  file: FileText,
};

/** The icon for a stored file's type, so rows never look like broken images. */
export function AttachmentTypeIcon({
  mimeType,
  size = 16,
  className,
}: {
  mimeType: string;
  size?: number;
  className?: string;
}) {
  const Icon = ATTACHMENT_ICONS[attachmentKind(mimeType)];
  return <Icon size={size} aria-hidden="true" className={className} />;
}

/** A linked attachment that names its file and shows what kind of file it is. */
export function AttachmentFileLink({
  url,
  filename,
  mimeType,
  className = "",
}: {
  url: string;
  filename: string;
  mimeType: string;
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`group flex min-w-0 items-center gap-2 text-primary ${className}`}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <AttachmentTypeIcon mimeType={mimeType} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium group-hover:underline">
          {filename || "Open file"}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {attachmentTypeLabel(mimeType, filename)}
        </span>
      </span>
    </a>
  );
}
