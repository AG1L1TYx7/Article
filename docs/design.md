# Design system

How the interface is put together, so a new page looks like the rest of
the site without copying class strings around.

## The idea

A newspaper, not a web app. Headlines and article text are set in a
serif (Newsreader) at reading sizes; controls, bylines and the newsroom
are in a sans (Geist). Paper is warm off-white rather than pure white,
ink is near-black rather than pure black, and the one accent is an
editorial red used only for things that are genuinely urgent: the
Breaking badge, section kickers, unread markers.

Three shells, one root layout:

| Route group | Shell | Used for |
| --- | --- | --- |
| `(public)` | Masthead, section bar, footer | Everything a reader sees |
| `(auth)` | Wordmark and one centred card | Log in, register, reset, verify |
| `(dashboard)` | Sidebar of tools | The newsroom |

## Tokens

Every colour comes from a CSS variable in `src/app/globals.css`, exposed
to Tailwind through `@theme`. Light and dark are the same components
with different variable values — there is no `dark:` variant anywhere,
and adding one is the wrong fix.

| Token | Use |
| --- | --- |
| `paper` | Page background |
| `surface`, `surface-2` | Cards; hover and inset backgrounds |
| `ink`, `ink-2`, `ink-3` | Text: primary, secondary, faint |
| `line`, `line-strong` | Hairlines; borders that need to be seen |
| `accent`, `accent-soft` | Editorial red and its tint |
| `ok`, `warn`, `danger` (+ `-soft`) | Status, each with a tinted background |

So `text-ink-2`, `bg-surface`, `border-line`, `bg-accent` and so on.
Never `text-neutral-600`: it is right in light mode and invisible in dark.

Fonts: `font-sans` (Geist), `font-serif` (Newsreader), `font-mono`.

## Component classes

Defined once in `globals.css` under `@layer components`, so a button is
a button everywhere.

| Class | What it is |
| --- | --- |
| `btn` + `btn-primary` / `btn-secondary` / `btn-ghost` / `btn-danger` / `btn-accent` | Buttons; add `btn-sm` for compact, `btn-icon` for a round icon button |
| `input` | Every text input, select and textarea |
| `field`, `label`, `hint` | A labelled control with optional help text |
| `card`, `card-hover` | A bordered surface; hover lift for clickable ones |
| `headline` | Serif display type for titles |
| `eyebrow` | Small red caps above a headline (section names) |
| `kicker` | Same, in grey (page labels) |
| `section-title` | Caps heading with a rule running to the right |
| `pill` + `pill-neutral` / `pill-ok` / `pill-warn` / `pill-danger` | Status chips |
| `badge-breaking` | The red Breaking marker |
| `alert` + `alert-ok` / `alert-warn` / `alert-danger` / `alert-info` | Inline notices |
| `avatar` | Initials on a disc (there is no photo upload) |
| `table` | Newsroom tables |
| `text-link`, `nav-link` | Links in running text; links in the section bar |
| `prose prose-article` | A published article body |
| `prose prose-editor` | The same styles inside the editor |

## Building blocks

- `ArticleCard` (`components/articles/`) is the one way an article is
  listed. Four variants: `lead`, `featured`, `row`, `compact`. It renders
  an `<li>`, so wrap it in a `<ul>`; spacing between cards belongs on the
  list (`[&>li]:py-6`), not on the card.
- `PageHeader` / `PageBody` (`app/(dashboard)/`) give newsroom pages the
  same title strip and gutters.
- `AuthCard` (`components/`) is the card every sign-in page renders into.
- `ToggleButton` handles like / save / follow with optimistic updates.
- Icons are in `components/icons.tsx`: inline SVG, `currentColor`, no
  dependency.
- Dates go through `lib/format.ts`. Never `toLocaleDateString()` in a
  component — the server and the browser disagree on locale and React
  reports it as a hydration mismatch.

## Images

Uploads are stored once, at up to 1600px. Nothing should ever render
that file at thumbnail size: use `imageVariantUrl(url, width)` for `src`
and `imageSrcSet(url)` for `srcset` (both in `lib/imageUrl.ts`), with a
`sizes` attribute that says how wide the image really is. The local
media route resizes on request (`/media/<key>?w=480`, listed widths only)
and caches each variant under `.local-uploads/_variants/`. A phone at 2×
then fetches ~4KB for a card thumbnail rather than ~20KB+.

With object storage configured, `Media.url` points at the bucket and the
helpers return the plain URL; put an image CDN in front of the bucket to
get the same effect there.

## Small things that are deliberate

- Every tag is a page (`/tag/<slug>`), listed on the article and in the
  sitemap. Tags entered in the editor are never a dead end.
- "Updated <date>" appears on an article only when it was edited more
  than 30 minutes after publishing. View counting uses raw SQL so it
  cannot touch `updatedAt` (`lib/viewCount.ts`).
- Comments sort by oldest / newest / most liked via `?comments=`; replies
  keep their written order, and long reply chains fold after three.
- `app/error.tsx` and `app/global-error.tsx` are the friendly faces of a
  crash; the 404 is `app/not-found.tsx`. All three match the site.
- `app/manifest.ts` and `public/icons/` make the site installable; the
  icons come from `scripts/make-icons.mjs`.

## Newsroom conventions

- Every status action goes through `ActionButton` (`components/`), which
  runs a server action and shows its `{ ok, error }`. Pass the action and
  its arguments separately (`action={publishArticle} args={[id]}`); a
  server component cannot hand a closure to a client component. Anything
  irreversible from the interface gets a `confirm`.
- The article form autosaves 2.5s after a pause once there is a title,
  creates the draft on its first save and moves the address bar to the
  edit page without a navigation. The rail shows the save state; leaving
  with unsaved changes asks first. Publish, unpublish, schedule, preview
  and archive all save first, so nothing typed is lost.
- Scheduled publishing needs no worker: `lib/scheduledPublishing.ts` runs
  after each public response, at most once a minute per process.
- The preview at `/dashboard/articles/<id>/preview` uses the same
  `ArticleView` pieces as the public page, so a draft reads exactly as it
  will live.

## Rules that are easy to break

- One `<nav>` per public page: the section bar. Footer lists are `<ul>`.
  Screen readers offer "jump to navigation", and the e2e suite locates
  the section bar by role.
- One `<main>` per page, with `id="main-content"` for the skip link.
- Keep the visible text of buttons and labels: the e2e tests find things
  by their names (`Save draft`, `Publish`, `Title`, `Post comment`…).
- Don't read the clock during render (`Date.now()`, `new Date()`); the
  purity lint rule rejects it. Use `lib/timeWindow.ts`.

## Seeing it

`npm run seed:demo` fills an empty database with fourteen stories, cover
images and a comment thread so the front page can be judged. Remove them
again with `npm run seed:demo -- --remove`.
