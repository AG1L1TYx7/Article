/**
 * The one card every sign-in page renders into, so the pages differ only
 * in their form.
 */
export function AuthCard({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main id="main-content" className="w-full max-w-md">
      <div className="card p-6 shadow-card sm:p-8">
        <h1 className="headline text-3xl">{title}</h1>
        {intro && <div className="mt-2 text-sm text-ink-2">{intro}</div>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-5 text-center text-sm text-ink-2">{footer}</div>}
    </main>
  );
}
