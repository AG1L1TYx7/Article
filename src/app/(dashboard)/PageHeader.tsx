/**
 * The title strip at the top of every newsroom page: title on the left,
 * the page's primary action on the right, an optional line beneath.
 */
export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-6 sm:px-8">
        <div className="min-w-0">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1 className="headline mt-1 text-3xl">{title}</h1>
          {description && <div className="mt-2 max-w-2xl text-sm text-ink-2">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Page body with the same gutters as the header. */
export function PageBody({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={`mx-auto px-4 py-8 sm:px-8 ${narrow ? "max-w-3xl" : "max-w-6xl"}`}>{children}</div>
  );
}
