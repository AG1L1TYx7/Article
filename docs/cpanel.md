# Running this on cPanel

Yes, with conditions. This page is the honest version: what works, what
does not, and how to tell before you spend an evening on it.

## A correction

Earlier advice in this project said shared and cPanel hosting "generally
cannot" run this app. That is true of classic PHP-only shared hosting —
Apache cannot run a Node process — but **cPanel's "Setup Node.js App"
can**, because it runs Phusion Passenger, which keeps a Node process
alive and proxies to it.

The native dependencies are handled for you. The bundle carries the
**Linux** builds of `argon2` (passwords) and `sharp` (image processing)
no matter which machine ran the build — `npm run build:cpanel` fetches
them and checks they really are Linux binaries — so nothing needs a
compiler on the host.

## Check these four things first

If any of them is a no, stop — the rest will not save you.

| Check | How | Why |
| --- | --- | --- |
| **Node 20.9+** | cPanel → Setup Node.js App → the version dropdown | Next.js 16 refuses to start on anything older. Many hosts still cap at 18. |
| **"Setup Node.js App" exists** | Look for it under Software | Without Passenger there is nothing to keep the process running. |
| **MySQL** | cPanel → MySQL Databases | The app needs it, and you already have it locally. |
| **Terminal, or SSH** | cPanel → Terminal | Migrations and the first admin account are run from a command line. There is a phpMyAdmin-only route for the schema (below), but not for the admin account. |

## What will not work on shared cPanel

Stated plainly so it is not a surprise after you have deployed.

**No malware scanner.** ClamAV has to run as a daemon, and shared
hosting will not give you one. Every upload is still re-encoded — images
by sharp, video and audio by the Linux build of ffmpeg that
`npm run build:cpanel` puts in the bundle — and that re-encode is what
makes a file publishable; the scanner, where one exists, is a second
opinion. See `docs/media.md`. If the bundled ffmpeg cannot run on the
host (a very old glibc, say), video and audio uploads are refused with a
503 that says so; images are unaffected.

**You cannot build on the server.** `next build` wants roughly 2GB of
RAM, and shared hosting usually kills the process well below that, with
no useful error. This is why `npm run build:cpanel` exists: you build on
your own machine and upload the result.

**The rate limiter is per-process.** Fine on cPanel, which runs one. If
you ever scale out, it needs Upstash — see `docs/deployment.md`.

If video matters to you, use the VPS or dedicated server instead. The
Docker setup in `docs/deployment.md` handles all of the above.

## Deploying

### 1. Build locally

```bash
npm run build
npm run build:cpanel
```

That produces `cpanel-dist/` — around 160MB. Inside:

| File | What it is |
| --- | --- |
| `app.js` | The entry point Passenger starts |
| `server.js`, `.next/`, `public/`, `node_modules/` | The site itself |
| `setup.js` | Migrations, starter categories and the first admin — runs with plain `node`, no Prisma CLI needed |
| `migrations/` | The SQL `setup.js` applies |
| `database.sql` | The same schema as one file, for phpMyAdmin's Import tab |

The first run downloads two small packages (the Linux builds of sharp)
into `.cpanel-cache/`; later builds are offline.

### 2. Upload

Upload the **contents** of `cpanel-dist/` into your application root on
the server (not the directory itself). File Manager's zip upload and
extract is far quicker than uploading 160MB of small files individually.

Do **not** upload your local `.env`. It points at `127.0.0.1:3307` and
holds development secrets. (The build strips it from the bundle, so it
is not there by accident either.)

### 3. Create the database

cPanel → MySQL Databases. Create a database and a user, and add the user
to the database with **All Privileges**. Note the names: cPanel prefixes
both with your account name, so `news` becomes something like
`acct_news` and `dbuser` becomes `acct_dbuser`.

### 4. Write .env on the server

Create `.env` in the application root:

```bash
DATABASE_URL="mysql://acct_dbuser:password@localhost:3306/acct_news"

# Generate with: openssl rand -base64 32
# This also encrypts stored MFA secrets — changing it later invalidates
# every enrolled authenticator.
AUTH_SECRET="..."
NEXTAUTH_URL="https://yourdomain.com"
```

If the database password contains `@`, `:`, `/` or `%`, URL-encode it
(`@` becomes `%40`, and so on).

> **Ask your host to set `innodb_ft_min_token_size=2`.** The default is 3,
> which means MySQL indexes no word shorter than three characters —
> searching for "AI", "EU" or "US" silently returns nothing, with no
> error. It can only be set at server startup, so on shared hosting it is
> a support ticket. `node setup.js check` below tells you what it is
> currently set to. See [database.md](database.md).

### 5. Set up the Node app

cPanel → Setup Node.js App → Create Application:

| Field | Value |
| --- | --- |
| Node.js version | 20.9 or newer |
| Application mode | Production |
| Application root | wherever you uploaded to |
| Application URL | your domain |
| Application startup file | `app.js` |

Do not click Run NPM Install — the dependencies are already in the bundle,
and reinstalling on the server risks the memory limit.

### 6. Migrations, categories and the first admin

Open cPanel → Terminal (or SSH in), enter the app's environment using
the `source ...` command that Setup Node.js App shows at the top of the
page, `cd` to the application root, then:

```bash
node setup.js check
# and, from your own machine with the server's .env values:
# npm run check:production
```

It connects with your `.env`, and tells you what is wrong in plain
words — wrong database name, wrong password, Node too old, token size
not set, migrations pending. Fix whatever it lists, then:

```bash
node setup.js migrate
node setup.js seed
node setup.js admin --email you@yourdomain.com
```

That last one prints a generated password **once**. Run `check` again
and it should say everything checks out.

`setup.js` records what it applied in the same `_prisma_migrations`
table, with the same checksums, that Prisma uses — so if you later run
`npx prisma migrate deploy` against this database from your own machine,
the two agree.

**No Terminal?** Some hosts disable it. For the schema, use phpMyAdmin:
open your (empty) database, Import tab, choose `database.sql`, Go. That
gives you every table plus the migration records. It cannot create the
admin account, though — the password hash has to be generated by
`setup.js admin` — so ask your host to enable the Terminal or SSH, which
they almost always will.

### 7. Restart and check

Click Restart in Setup Node.js App, then load your domain.

**If you get a 503 or a Passenger error page**, the log is in
`~/logs/` or shown in the cPanel interface. The usual causes, in order:
Node version too old, `.env` missing or unreadable, and the database
credentials being wrong. `node setup.js check` catches the last two.

**If pages load but logging in fails**, or an image upload returns a
500, the bundle is missing its Linux binaries. Rebuild with
`npm run build:cpanel` — it refuses to finish without them — and upload
`node_modules/argon2` and `node_modules/@img` again.

## Keeping it updated

**Automatically:** once the repository has your server's SSH details,
every push to `main` that passes its tests is built, uploaded, migrated
and restarted by GitHub Actions. Setting that up is a ten-minute job
described in [ci-cd.md](ci-cd.md).

**By hand:** rebuild locally, re-run `npm run build:cpanel`, upload the contents
again, then in the Terminal run `node setup.js migrate` (it does nothing
if there is nothing new) and Restart. `git log --stat` shows whether
`prisma/migrations-mysql/` changed, if you want to know in advance.

## Honestly, should you?

Use cPanel if it is what you have and you can live without video.

Use the VPS or dedicated server if you want video, want Docker to handle
ClamAV and ffmpeg for you, and want `git pull && docker compose up -d
--build` instead of a manual upload every time. That path is in
[deployment.md](deployment.md) and it is the one this project was built
around.
