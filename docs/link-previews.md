# Link previews

An author attaches a related link to an article; the server fetches that
page and caches its title, description and site name.

That one sentence contains the whole problem. "The server fetches a URL the
user supplied" is the definition of server-side request forgery. Everything
in [`src/lib/linkPreview/`](../src/lib/linkPreview/) exists to make that
sentence safe.

| Piece | Where |
| --- | --- |
| Address classification | [`ssrf.ts`](../src/lib/linkPreview/ssrf.ts) |
| The guarded fetch | [`fetch.ts`](../src/lib/linkPreview/fetch.ts) |
| Metadata extraction | [`parse.ts`](../src/lib/linkPreview/parse.ts) |
| Attach / remove actions | `app/(dashboard)/dashboard/articles/actions.ts` |
| Reader-facing cards | [`RelatedLinks.tsx`](../src/components/articles/RelatedLinks.tsx) |

## What an attacker would try, and what stops it

**`http://169.254.169.254/latest/meta-data/`** — the cloud metadata service,
the single most valuable SSRF target on any hosted machine. Blocked: the
whole of `169.254.0.0/16` is refused.

**`http://127.0.0.1:6379/`** — reach Redis, or any internal admin panel.
Blocked, and this is where the design earns its keep: Node **skips the
`lookup` hook entirely when a URL's host is already an IP address**, because
there is nothing to resolve. An early version checked addresses only inside
the resolver hook, so literal IPs sailed straight past it and were genuinely
dialled — `http://127.0.0.1:5432/` was reaching Postgres and only failed
because Postgres does not speak HTTP. Literal hosts are now classified
before the request is built.

**A hostname that resolves to a private address** — `localhost`, or an
attacker's own domain with an `A` record of `10.0.0.1`. Blocked in the
resolver hook. *Every* address the name resolves to must be public; a name
answering with both a public and a private address is refused outright
rather than filtered down to the public one.

**DNS rebinding** — resolve to a public address for the security check,
then to `127.0.0.1` for the connection a moment later. This is why the code
uses `node:http` rather than `fetch`. The `lookup` option supplies the
address the socket actually connects to, so the address that passes the
check *is* the address that gets dialled. Validating separately and then
handing `fetch` a hostname leaves exactly that window open.

**A redirect to somewhere private** — the first hop being safe says nothing
about the second. Every hop is re-validated, with a limit of 3.

**`file:///etc/passwd`, `gopher://127.0.0.1:6379/_INFO`** — non-web schemes
are refused. `gopher:` in particular is a classic way to speak arbitrary
protocols through an HTTP client.

**`javascript:alert(1)`** — this one is not about the fetch at all. The URL
is rendered into an anchor's `href` for every reader, and Zod's `z.url()`
accepts `javascript:` happily. The scheme is checked in
`addArticleLinkSchema` for that reason, separately from the fetch.

**A response that never ends, or a 4GB file** — 5 second timeout, 256KB cap,
and the response is destroyed rather than drained once the cap is hit.
`Accept-Encoding: identity` is requested so the byte cap means something: a
small gzip stream can inflate to gigabytes, and a cap applied before
decompression would not be a cap at all.

**Using failures as a port scanner** — "connection refused" and "timed out"
and "blocked address" all tell an attacker something about the internal
network. The caller only ever learns one of `blocked`, `unreachable`,
`not-html` or `too-large`, and the author only sees "nothing could be read
from that page".

**Volume** — the fetch is rate limited per user, because it spends *our*
outbound bandwidth, not just a database write.

## Testing

`isBlockedAddress` is pure and covered exhaustively in
`tests/unit/ssrf.test.ts` — every private range, the ranges people forget
(carrier-grade NAT, `0.0.0.0/8`, TEST-NET), IPv4-mapped IPv6, 6to4, NAT64,
and non-decimal octet spellings like `0177.0.0.1`.

`tests/unit/linkPreviewFetch.test.ts` calls the real `fetchHtml` against
loopback and private targets. That distinction matters: **the literal-IP
bypass described above could not have been caught by a unit test of
`isBlockedAddress`**, because that function was right the whole time — it
was simply never consulted. One of its assertions checks that a refusal
takes under 500ms, since a refusal that takes as long as the request
timeout means a connection was actually attempted.

Not covered offline: the successful path. Fetching a real page needs a real
public URL, and a test that reaches the internet is not worth having here.
The parsing half is covered exhaustively against fixture HTML.

## Deliberate omissions

**No preview images.** `og:image` is parsed by nobody here and stored
nowhere. Rendering a remote image hands every reader's IP address to
whichever host the author linked to, and fetching it server-side to avoid
that would mean a second SSRF surface plus storage for something a text
card does not need. If images are wanted later, they should go through the
existing media pipeline — fetched once, re-encoded by `sharp`, and served
from this site — not hotlinked.

**The stored URL is the one the author typed**, not the final URL after
redirects. A link that quietly becomes a different address than the one the
author chose is worse than one that redirects in the reader's own browser.
