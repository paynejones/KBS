"use client";

import { useState } from "react";

export function MediaImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (!src || failed) {
    return (
      <p role="status" className="rounded-md border border-destructive/30 bg-muted/30 px-3 py-8 text-center text-sm text-muted-foreground">
        {alt ? `Could not load image: ${alt}` : "Image could not be loaded."}
      </p>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
