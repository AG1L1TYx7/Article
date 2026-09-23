import { getI18n } from "@/i18n/server";
import type { ArticleMedia } from "@/lib/articleMedia";
import { LICENSES, allowsDownload, formatDuration } from "@/lib/mediaRights";
import { AudioIcon, DownloadIcon, ImageIcon, VideoIcon } from "@/components/icons";

/**
 * Who made the files in a story, and the terms they are published under.
 *
 * Rendered from the Media rows rather than from anything in the body, so
 * a credit cannot be edited out of the text: what the newsroom recorded
 * when the file was added is what readers see. Transcripts of audio and
 * video live here too, folded up, for readers who cannot hear them.
 */
export async function MediaCredits({ media }: { media: ArticleMedia[] }) {
  if (media.length === 0) return null;
  const { t } = await getI18n();

  const kindLabel = { IMAGE: t("article.kindImage"), VIDEO: t("article.kindVideo"), AUDIO: t("article.kindAudio") } as const;
  const KindIcon = { IMAGE: ImageIcon, VIDEO: VideoIcon, AUDIO: AudioIcon } as const;

  return (
    <section aria-labelledby="credits-heading" className="mt-12 border-t border-line pt-6" data-media-credits>
      <h2 id="credits-heading" className="section-title">
        {t("article.credits")}
      </h2>
      <p className="mt-1 text-sm text-ink-2">{t("article.creditsBlurb")}</p>
      <ol className="mt-4 flex flex-col gap-4">
        {media.map((m) => {
          const Icon = KindIcon[m.type];
          const licence = m.license ? LICENSES[m.license] : null;
          const name = m.title || m.caption || m.altText || null;
          return (
            <li key={m.id} id={`credit-${m.id}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
              <span className="avatar mt-0.5 h-7 w-7 bg-surface-2 text-ink-2 ring-0" aria-hidden="true">
                <Icon size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-ink">
                  <span className="text-ink-3">{kindLabel[m.type]}</span>
                  {name && <> · {name}</>}
                  {m.durationSecs ? <span className="text-ink-3"> · {formatDuration(m.durationSecs)}</span> : null}
                </p>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-2">
                  {m.credit && (
                    <div className="flex gap-1">
                      <dt className="text-ink-3">{t("article.credit")}:</dt>
                      <dd>{m.credit}</dd>
                    </div>
                  )}
                  {m.sourceName && (
                    <div className="flex gap-1">
                      <dt className="text-ink-3">{t("article.source")}:</dt>
                      <dd>
                        {m.sourceUrl ? (
                          <a href={m.sourceUrl} rel="noopener noreferrer nofollow" target="_blank" className="text-link">
                            {m.sourceName}
                          </a>
                        ) : (
                          m.sourceName
                        )}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt className="text-ink-3">{t("article.licence")}:</dt>
                    <dd>
                      {licence?.url ? (
                        <a href={licence.url} rel="license noopener noreferrer" target="_blank" className="text-link">
                          {licence.label}
                        </a>
                      ) : (
                        (licence?.label ?? t("article.allRightsReserved"))
                      )}
                    </dd>
                  </div>
                  {allowsDownload(m.license) && (
                    <div>
                      <a href={`${m.url}?download=1`} className="text-link inline-flex items-center gap-1" download>
                        <DownloadIcon size={12} /> {t("article.download")}
                      </a>
                    </div>
                  )}
                </dl>
                {m.transcript && (
                  <details className="mt-2 rounded-md border border-line bg-surface-2/60 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-ink-2">{t("article.transcript")}</summary>
                    <p className="mt-2 text-sm whitespace-pre-wrap text-ink">{m.transcript}</p>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
