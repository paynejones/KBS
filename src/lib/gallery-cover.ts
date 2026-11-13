import {
  isAllowedMediaUrl,
  isImageMimeType,
  parseFilePropertyValue,
} from "./media";

type GalleryCoverRecord = {
  title: string;
  values: Record<string, unknown>;
  pageCoverImageUrl?: string | null;
};

type GalleryCoverOptions = {
  /** The view's chosen file property, tried before the other file properties. */
  chosenPropertyId?: string;
  filePropertyIds: readonly string[];
};

export type GalleryCover = {
  url: string;
  alt: string;
  /** Empty when the cover comes from the record's page instead of a property. */
  propertyId: string;
};

/**
 * Picks the image a gallery card shows. A file property still wins so the
 * existing cover picker and per-record remove action keep working; the record
 * page's cover is the fallback for databases that keep images there instead.
 */
export function galleryCoverForRecord(
  record: GalleryCoverRecord,
  options: GalleryCoverOptions,
): GalleryCover | null {
  const chosenPropertyId = options.chosenPropertyId ?? "";
  const propertyIds = chosenPropertyId && options.filePropertyIds.includes(chosenPropertyId)
    ? [chosenPropertyId, ...options.filePropertyIds.filter((id) => id !== chosenPropertyId)]
    : options.filePropertyIds;

  for (const propertyId of propertyIds) {
    const file = parseFilePropertyValue(record.values[propertyId]);
    if (file && isImageMimeType(file.mimeType)) {
      return {
        url: file.url,
        alt: file.alt || file.filename || record.title,
        propertyId,
      };
    }
  }

  const pageCoverUrl = record.pageCoverImageUrl?.trim();
  if (pageCoverUrl && isAllowedMediaUrl(pageCoverUrl)) {
    return { url: pageCoverUrl, alt: record.title, propertyId: "" };
  }

  return null;
}
