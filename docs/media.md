# Media: pictures, video and audio, and the rights to publish them

Staff can put three kinds of file in a story: images, video and audio.
Every one goes through the same pipeline before a reader can reach it,
and every one carries a credit and a licence that readers see. This
document is the code-facing description of both halves.

## The pipeline

`src/lib/mediaPipeline.ts` is the single path for an upload, whether it
came through `/api/media/upload` (multipart, local disk) or was PUT
straight to object storage and processed by `/api/media/finalize`.

1. **Identify by magic bytes** (`file-type`), never by extension or the
   client's Content-Type. Accepted: JPEG, PNG, WebP, GIF; MP4, WebM, MOV;
   MP3, M4A, OGG, WAV, FLAC. Size caps: 10 MB images, 200 MB video, 100 MB
   audio.
2. **Re-encode.** Images go through sharp to WebP. Video and audio go
   through ffmpeg (`src/lib/transcode.ts`): video to H.264/AAC MP4 with
   `+faststart`, audio to 128 kbit/s MP3. Both drop every metadata stream
   — a phone's GPS coordinates, an MP3's embedded cover art — and both
   write a fresh file from decoded frames, so the bytes served are never
   the bytes uploaded. A file crafted to be two things at once does not
   survive the round trip. The duration is read from ffmpeg's own
   progress output and stored.
3. **Scan**, when `CLAMAV_HOST` is set, on the re-encoded bytes. A
   configured scanner is final: a positive or an unreachable daemon
   refuses the upload (a scanner that fails open is not a scanner).
4. **Store**, and only then create the `Media` row, marked `CLEAN`.

The rule that decides whether a video or audio file may be stored is: it
was re-encoded by ffmpeg, **or** a configured scanner said clean. With
neither available the upload is refused with a 503 that says so, because
on S3 `Media.url` points straight at the bucket and a stored-but-hidden
file is not hidden at all. Images are always re-encoded, so they never
hit this.

### Where ffmpeg comes from

`FFMPEG_PATH` when set (the Docker image installs the distribution's
package and sets it). Otherwise the binary that the `ffmpeg-static` npm
package downloads for the current platform at `npm install` — which is
what makes video and audio work on a laptop and on a cPanel host with no
system install. `scripts/build-cpanel.mjs` puts the Linux x64 build in
the bundle regardless of the machine that built it. ffmpeg-static ships
GPL-licensed builds; the app only spawns the binary, which the GPL
permits without affecting this codebase's licence.

If neither is present, `isTranscodingConfigured()` is false and video
and audio uploads are refused (images still work).

## Rights: credit, licence, confirmation

`prisma/schema.prisma` gives `Media` these fields:

| Field | What it is |
| --- | --- |
| `title`, `caption` | Shown under the file and in the credits list |
| `altText` | Images only; read aloud to readers who cannot see them |
| `credit` | The creator: photographer, filmmaker, producer |
| `sourceName`, `sourceUrl` | Where it came from: agency, archive, organisation |
| `license` | One of the `MediaLicense` values below |
| `rightsNote` | The basis, where the licence alone does not say (who gave permission and when; why it is public domain; which stock licence) |
| `rightsConfirmedAt` | When the person who added the file confirmed the newsroom may publish it under those terms |
| `transcript` | Audio and video: what is said, for readers who cannot hear it and for search |

The rules live in `src/lib/mediaRights.ts`, which is pure and unit
tested. `rightsProblem(media)` returns the one thing still missing, or
null. **An article cannot be published, scheduled, or edited while live,
until every file it uses passes** — the check is in the article actions
(`publishArticle`, `createArticle`, `updateArticle`) and again in
`src/lib/scheduledPublishing.ts`, which holds back a scheduled story
whose file details were changed after scheduling. A draft may hold
anything.

### Licences

| Code | Shown as | Requires | Readers may download |
| --- | --- | --- | --- |
| `OWN_WORK` | All rights reserved | — | no |
| `PERMISSION` | Used with permission | creator or source, and a note | no |
| `CC0` | CC0 1.0 | — | yes |
| `CC_BY` | CC BY 4.0 | creator or source | yes |
| `CC_BY_SA` | CC BY-SA 4.0 | creator or source | yes |
| `CC_BY_ND` | CC BY-ND 4.0 | creator or source | yes |
| `CC_BY_NC` | CC BY-NC 4.0 | creator or source | yes |
| `CC_BY_NC_SA` | CC BY-NC-SA 4.0 | creator or source | yes |
| `CC_BY_NC_ND` | CC BY-NC-ND 4.0 | creator or source | yes |
| `PUBLIC_DOMAIN` | Public domain | a note saying why | yes |
| `OTHER` | Other licence | creator or source, and a note | no |

Creative Commons and public-domain files link to the deed on
creativecommons.org. "Readers may download" adds a Download link in the
credits and the audio player; `/media/[key]?download=1` serves the file
as an attachment only for those licences and ignores the parameter
otherwise. The NC licences are offered because newsrooms do use them;
whether a given site counts as non-commercial is a question for the
newsroom, which is why the dialog says so.

### How it is asked for

The editor (`src/components/editor/ArticleEditor.tsx`) has Insert image,
Insert video and Insert audio buttons. After the upload finishes, the
details dialog (`MediaDetailsDialog.tsx`) opens and nothing goes into
the story until it is saved with a licence, whatever that licence
requires, and the confirmation ticked. The same dialog opens from the
figure's **Details** button and from the cover image's. The confirmation
writes `media.rights.confirmed` to the audit log with the person's name
and the licence, which is the record a rights query would ask for.

Only the uploader or an admin can set a file's details: the confirmation
is a personal statement and cannot be made on someone else's behalf.

### How readers see it

- Under the file, in the figure's caption: "Photo: Maya Okafor / Reuters
  · CC BY 4.0". The editor writes this into the `<figcaption>`
  (`MediaFigure.tsx`), and the cover shows its own from the `Media` row.
- At the end of the story, **Credits and licences**
  (`src/components/articles/MediaCredits.tsx`), rendered from the `Media`
  rows rather than the body, so a credit cannot be edited out of the
  text. Transcripts fold out here.
- In the page's JSON-LD: a `NewsArticle` whose `associatedMedia` are
  `ImageObject` / `VideoObject` / `AudioObject` with `license`,
  `creditText`, `creator`, `copyrightHolder`, `duration` and
  `transcript`. This is what search engines read for "licensable" image
  results.
- In Open Graph `og:audio` and `og:video`, and in the RSS feed as an
  `<enclosure>` for the story's first audio clip, which is what a podcast
  app needs to treat the item as an episode.

## The audio player

`src/components/articles/AudioPlayers.tsx` upgrades each `<audio>` in
the sanitised body after hydration: play/pause, ±15 seconds, a seek bar,
elapsed and total time, playback speed (1×, 1.25×, 1.5×, 2×, 0.75×) and
a download link where the licence allows one. Without JavaScript the
browser's own controls remain. Video uses the browser's player with
`playsinline` and `preload="metadata"`.

## The markup

`lib/sanitize.ts` allows `figure`, `figcaption`, `img`, `video`, `audio`
and `source`, with `controls`, `preload`, `playsinline`, `poster`, `type`
and `data-*` attributes; it forbids `autoplay` and `loop` outright. A
figure looks like:

```html
<figure data-media-id="cm…" data-kind="audio" class="media-figure">
  <audio src="/media/….mp3" controls preload="metadata"></audio>
  <figcaption>Interview with the council leader — Audio: Priya Natarajan · CC BY 4.0</figcaption>
</figure>
```

`data-media-id` is how the credits, the player and the publish gate find
the row. `src/lib/articleMedia.ts` resolves the body's `src` URLs and the
cover id to `Media` rows and records them on the article's `media`
relation each time it is saved.
