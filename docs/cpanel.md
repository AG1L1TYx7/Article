# Running this on cPanel

Yes, with conditions. This page is the honest version: what works, what
does not, and how to tell before you spend an evening on it.

## A correction

Earlier advice in this project said shared and cPanel hosting "generally
cannot" run this app. That is true of classic PHP-only shared hosting —
Apache cannot run a Node process — but **cPanel's "Setup Node.js App"
can**, because it runs Phusion Passenger, which keeps a Node process
alive and proxies to it.

The native dependencies are also less of a problem than they look.
`argon2` ships prebuilt binaries for `linux-x64` and `sharp` installs a
prebuilt `@img/sharp-linux-x64`, so neither needs a compiler on a normal
Linux host.

## Check these four things first

If any of them is a no, stop — the rest will not save you.

| Check | How | Why |
| --- | --- | --- |
| **Node 20.9+** | cPanel → Setup Node.js App → the version dropdown | Next.js 16 refuses to start on anything older. Many hosts still cap at 18. |
| **"Setup Node.js App" exists** | Look for it under Software | Without Passenger there is nothing to keep the process running. |
| **MySQL** | cPanel → MySQL Databases | The app needs it, and you already have it locally. |
| **SSH, or a terminal** | cPanel → Terminal, or SSH access | Migrations and the first admin account are command-line only. |

## What will not work on shared cPanel

Stated plainly so it is not a surprise after you have deployed.

**Video uploads are refused.** Not degraded — refused, with a 503
explaining why. Video cannot be re-encoded the way images are, so malware
scanning is its whole defence, and that needs ClamAV running as a daemon.
Shared hosting will not give you one. Images are unaffected and work
normally.

**No ffmpeg**, so even if scanning were available, video would be stored
in whatever container it arrived in rather than normalised.

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

That produces `cpanel-dist/` — around 140MB, containing the server, the
traced dependencies, the static assets and `app.js`.

### 2. Upload

Upload the **contents** of `cpanel-dist/` into your application root on
the server (not the directory itself). File Manager's zip upload and
extract is far quicker than uploading 140MB of small files individually.

Do **not** upload your local `.env`. It points at `127.0.0.1:3307` and
holds development secrets.

### 3. Create the database

cPanel → MySQL Databases. Create a database and a user, and grant the
user all privileges on it. Note the names: cPanel prefixes both with your
account name, so `news` becomes something like `acct_news`.

### 4. Write .env on the server

Create `.env` in the application root:

```bash
DATABASE_URL="mysql://acct_user:password@localhost:3306/acct_news"

# Generate with: openssl rand -base64 32
# This also encrypts stored MFA secrets — changing it later invalidates
# every enrolled authenticator.
AUTH_SECRET="..."
NEXTAUTH_URL="https://yourdomain.com"
```

> **Ask your host to set `innodb_ft_min_token_size=2`.** The default is 3,
> which means MySQL indexes no word shorter than three characters —
> searching for "AI", "EU" or "US" silently returns nothing, with no
> error. It can only be set at server startup, so on shared hosting it is
> a support ticket. See [database.md](database.md).

### 5. Set up the Node app

cPanel → Setup Node.js App → Create Application:

| Field | Value |
| --- | --- |
| Node.js version | 20.9 or newer |
| Application root | wherever you uploaded to |
| Application URL | your domain |
| Application startup file | `app.js` |

Do not click Run NPM Install — the dependencies are already in the bundle,
and reinstalling on the server risks the memory limit.

### 6. Migrations and the first admin

Open the virtual environment cPanel shows you (it prints a `source ...`
command), then:

```bash
npx prisma migrate deploy
npm run seed
npm run bootstrap:staff -- --email you@yourdomain.com --role ADMIN
```

That last one prints a generated password **once**.

If `npx prisma` is not available — the bundle carries only the traced
runtime dependencies, not the CLI — run the migrations from your own
machine against the server's database instead, if your host allows remote
MySQL. Otherwise upload a full `node_modules` temporarily, migrate, and
remove it.

### 7. Restart and check

Click Restart in Setup Node.js App, then load your domain.

**If you get a 503 or a Passenger error page**, the log is in
`~/logs/` or shown in the cPanel interface. The usual causes, in order:
Node version too old, `.env` missing or unreadable, and the database
credentials being wrong.

## Keeping it updated

Rebuild locally, re-run `npm run build:cpanel`, upload the contents
again, and Restart. Run `npx prisma migrate deploy` if the update
included a migration — `git log --stat` shows whether
`prisma/migrations-mysql/` changed.

## Honestly, should you?

Use cPanel if it is what you have and you can live without video.

Use the VPS or dedicated server if you want video, want Docker to handle
ClamAV and ffmpeg for you, and want `git pull && docker compose up -d
--build` instead of a manual upload every time. That path is in
[deployment.md](deployment.md) and it is the one this project was built
around.
