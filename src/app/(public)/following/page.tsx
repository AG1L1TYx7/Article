import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { followedSources, followingFeed } from "@/lib/followingFeed";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { ArrowRightIcon, UserPlusIcon } from "@/components/icons";
import { initials, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Following",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 40;

/**
 * Everything from the writers and sections a reader follows, newest
 * first. The homepage shows the first few of these; this is the whole list.
 */
export default async function FollowingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/following");

  const sources = await followedSources(session.user.id);
  const articles = await followingFeed(sources, { take: PAGE_SIZE });
  const sourceCount = sources.authors.length + sources.categories.length;

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6">
      <header className="border-b border-line pb-6">
        <p className="kicker">For you</p>
        <h1 className="headline mt-2 text-4xl sm:text-5xl">Following</h1>
        <p className="mt-3 max-w-2xl text-ink-2">
          The latest from the {plural(sources.authors.length, "writer")} and{" "}
          {plural(sources.categories.length, "section")} you follow. Newest first, nothing chosen for you.
        </p>

        {sourceCount > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="What you follow">
            {sources.authors.map((a) => (
              <li key={`a-${a.id}`}>
                <Link href={`/author/${a.handle}`} className="pill pill-neutral gap-1.5 hover:border-ink">
                  <span className="avatar h-4 w-4 text-[8px]">{initials(a.name)}</span>
                  {a.name}
                </Link>
              </li>
            ))}
            {sources.categories.map((c) => (
              <li key={`c-${c.id}`}>
                <Link href={`/category/${c.slug}`} className="pill pill-neutral hover:border-ink">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      {sourceCount === 0 && (
        <div className="card mt-8 flex flex-col items-center px-6 py-12 text-center">
          <span className="avatar h-12 w-12">
            <UserPlusIcon size={20} />
          </span>
          <p className="mt-4 font-medium">You aren&apos;t following anyone yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-2">
            Follow a writer from their byline, or a section from its page, and their new stories will
            collect here and at the top of the front page.
          </p>
          <Link href="/" className="btn btn-secondary mt-5 gap-2">
            Browse the latest <ArrowRightIcon size={16} />
          </Link>
        </div>
      )}

      {sourceCount > 0 && articles.length === 0 && (
        <p className="mt-8 text-ink-2">Nothing published yet by anyone you follow. Check back soon.</p>
      )}

      {articles.length > 0 && (
        <ul className="mt-2 grid gap-x-12 md:grid-cols-2 [&>li]:border-b [&>li]:border-line [&>li]:py-6">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="row" />
          ))}
        </ul>
      )}
    </main>
  );
}
