import Link from "next/link";
import { SITE_NAME } from "@/lib/siteUrl";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-16 items-center justify-center">
        <Link href="/" className="headline text-2xl font-semibold tracking-[-0.02em]">
          {SITE_NAME}
        </Link>
      </header>
      <main id="main-content" className="mx-auto flex max-w-lg flex-1 flex-col items-center px-6 pt-16 text-center">
        <p className="eyebrow">404</p>
        <h1 className="headline mt-3 text-4xl">That page isn&apos;t here.</h1>
        <p className="mt-4 text-ink-2">
          It may have been unpublished, moved, or never existed. The front page has everything
          currently running.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/" className="btn btn-primary">
            Front page
          </Link>
          <Link href="/search" className="btn btn-secondary">
            Search
          </Link>
        </div>
      </main>
    </div>
  );
}
