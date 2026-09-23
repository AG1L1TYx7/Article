import { getI18n } from "@/i18n/server";

export interface ReferenceItem {
  id: string;
  position: number;
  title: string;
  author: string | null;
  publication: string | null;
  url: string | null;
  publishedOn: string | null;
  note: string | null;
}

/**
 * The sources a story cites, numbered, at the end of the article.
 *
 * Each entry carries the id a citation in the text links to (#ref-n),
 * so a reader can jump from [3] to the third source and back. Links are
 * nofollow noreferrer for the same reasons as related links: an author
 * must not be able to pass this site's ranking to an arbitrary page, and
 * a reader's path through the site is not handed to the other end.
 */
export async function ReferencesList({ references }: { references: ReferenceItem[] }) {
  if (references.length === 0) return null;
  const { t } = await getI18n();

  return (
    <section className="mt-12" aria-labelledby="references-heading" data-references>
      <h2 id="references-heading" className="section-title">
        {t("article.references")}
      </h2>
      <ol className="mt-4 flex flex-col gap-2 text-sm">
        {references.map((ref) => {
          const detail = [ref.author, ref.publication, ref.publishedOn].filter(Boolean).join(", ");
          return (
            <li key={ref.id} id={`ref-${ref.position}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 scroll-mt-24 target:bg-accent-soft/40">
              <span className="text-ink-3 tabular-nums">{ref.position}.</span>
              <p className="text-ink-2">
                {ref.url ? (
                  <a href={ref.url} rel="nofollow noopener noreferrer" target="_blank" className="text-link">
                    {ref.title}
                  </a>
                ) : (
                  <span className="text-ink">{ref.title}</span>
                )}
                {detail && <span>. {detail}</span>}
                {ref.note && <span className="text-ink-3">. {ref.note}</span>}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
