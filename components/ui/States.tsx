import type { ReactNode } from "react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 py-6">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          className="h-[88px] animate-pulse rounded-(--radius-card) border border-line bg-surface"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-(--radius-card) border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h2 className="text-base font-medium text-ink">{title}</h2>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong.",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-(--radius-card) border border-sev-critical/30 bg-sev-critical-soft px-6 py-8"
    >
      <h2 className="text-base font-medium text-sev-critical">{title}</h2>
      {description && (
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[13px] leading-5 text-sev-critical">
      {message}
    </p>
  );
}
