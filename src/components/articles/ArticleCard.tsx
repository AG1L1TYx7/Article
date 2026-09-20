import Link from "next/link";

export interface ArticleCardData {
  id: string;
  slug: string;
  title: string;
  dek: string | null;
  isBreaking?: boolean;
  publishedAt: Date | null;
  author: { name: string; handle?: string };
  category?: { name: string; slug?: string } | null;
}

/**
 * One article in a list. Shared by the homepage, author pages, category
 * pages and the saved list so they can't drift apart — the fields here
 * are exactly what those queries select, and nothing more.
 */
export function ArticleCard({ article }: { article: ArticleCardData }) {
  return (
    <li className="border-b border-neutral-200 pb-8">
      {article.isBreaking && (
        <span className="mb-1 inline-block rounded bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">
          BREAKING
        </span>
      )}
      {article.category && (
        <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
          {article.category.slug ? (
            <Link href={`/category/${article.category.slug}`} className="hover:underline">
              {article.category.name}
            </Link>
          ) : (
            article.category.name
          )}
        </p>
      )}
      <h2 className="mt-1 text-xl font-semibold">
        <Link href={`/article/${article.slug}`} className="hover:underline">
          {article.title}
        </Link>
      </h2>
      {article.dek && <p className="mt-1 text-neutral-600">{article.dek}</p>}
      <p className="mt-2 text-sm text-neutral-500">
        {article.author.handle ? (
          <Link href={`/author/${article.author.handle}`} className="hover:underline">
            {article.author.name}
          </Link>
        ) : (
          article.author.name
        )}
        {article.publishedAt && ` · ${article.publishedAt.toLocaleDateString()}`}
      </p>
    </li>
  );
}
