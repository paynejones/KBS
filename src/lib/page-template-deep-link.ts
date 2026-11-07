const TEMPLATE_HASH_PREFIX = "#template-";

export function getTemplateIdFromHash(hash: string): string | null {
  if (!hash.startsWith(TEMPLATE_HASH_PREFIX)) return null;
  const templateId = hash.slice(TEMPLATE_HASH_PREFIX.length);
  return templateId || null;
}

/** Opens the templates panel and scrolls to the row linked by /pages#template-<id>. */
export function revealTemplateFromHash(
  hash: string,
  getTemplateRow: (templateId: string) => HTMLElement | null,
  templatesPanel: HTMLDetailsElement | null,
): HTMLElement | null {
  const templateId = getTemplateIdFromHash(hash);
  if (!templateId) return null;

  const templateRow = getTemplateRow(templateId);
  if (!templateRow) return null;

  if (templatesPanel) templatesPanel.open = true;
  templateRow.scrollIntoView({ block: "center" });
  return templateRow;
}
