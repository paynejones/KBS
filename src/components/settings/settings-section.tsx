import type { ReactNode } from "react";

export function SettingsSection({
  id,
  title,
  icon,
  description,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl border bg-card p-5">
      <h2
        id={`${id}-heading`}
        className="flex items-center gap-2 text-lg font-semibold tracking-tight"
      >
        {icon}
        {title}
      </h2>
      {description && (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}
