# Operations: backups, restore drills, load tests

The three things that only matter on the day they matter. Each is a
single command, and each should be practised once before launch and then
on a schedule — a backup that has never been restored is a hope, not a
backup.

## Backups

```bash
npm run db:backup                 # → backups/news_platform-2026-09-20T22-30-00Z.sql.gz
npm run db:backup -- --keep 14    # and delete dumps beyond the newest 14
npm run db:backup -- --out /somewhere/else
```

Reads `DATABASE_URL` from `.env` or the environment, so it backs up
whatever the site actually uses. Uses `mysqldump` (or `mariadb-dump`);
set `MYSQLDUMP=/path/to/it` if it is not on `PATH`. The dump is taken in
a single transaction, so it is consistent and does not lock a live site.

What is in it: every table, including `_prisma_migrations`, so a
restored database knows exactly which migrations it has and
`prisma migrate deploy` afterwards reports nothing to do. What is not:
uploaded images. Those live in S3 (versioned buckets are the backup) or,
without S3, in `.local-uploads/` on the server, which needs copying
separately.

### On cPanel

cPanel → Terminal, in the application root:

```bash
node --env-file=.env scripts/backup-db.mjs --out ~/backups --keep 14
```

(`scripts/` is not in the bundle; copy `scripts/backup-db.mjs` and
`scripts/dbUrl.mjs` up once, or use cPanel's own **Backup** tool, which
dumps the database too.) To automate it, cPanel → Cron Jobs, daily:

```
0 3 * * * cd ~/dispatch && node --env-file=.env scripts/backup-db.mjs --out ~/backups --keep 14 >> ~/logs/backup.log 2>&1
```

Then copy `~/backups` somewhere that is not the same server — rclone to
any cloud drive, or cPanel's Backup Configuration if the host offers
remote destinations. A backup on the disk that fails is lost with it.

### With Docker

```bash
docker compose exec -T db mariadb-dump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction news_platform | gzip > backup.sql.gz
```

or run `npm run db:backup` from any machine that can reach the database.

## Restore drill

Do this before launch and then quarterly. It takes ten minutes and it is
the only way to know the backups work.

1. Create an empty scratch database (locally: `CREATE DATABASE news_restore_test;`).
2. Point at it and restore the newest dump:

   ```bash
   DATABASE_URL="mysql://root@127.0.0.1:3307/news_restore_test" npm run db:restore -- --file backups/<newest>.sql.gz
   DATABASE_URL="mysql://root@127.0.0.1:3307/news_restore_test" npm run db:restore -- --file backups/<newest>.sql.gz --confirm
   ```

   The first run is a dry run that says what it will do; the second does
   it and finishes with a line like `Restored: 27 tables, 8 applied migrations recorded.`
3. Prove it is usable, not just present: start the site against it
   (`DATABASE_URL=... npm run dev`), log in, open an article, open the
   dashboard. Or, quicker, `DATABASE_URL=... npx prisma migrate status`
   should say the database is up to date.
4. Drop the scratch database. Note the date in whatever you use for
   operational notes.

**A real restore** is the same command pointed at the real database,
with `--confirm`. Stop the app first (cPanel → Setup Node.js App → Stop),
restore, then start it. Every table is replaced by the dump's contents;
anything written since that backup is gone, which is why the schedule
above is daily and why the audit log is the first thing to read after.

## Load test

```bash
npm run load-test                                   # http://localhost:3000
npm run load-test -- --url https://yourdomain.com   # the live site
npm run load-test -- --connections 100 --duration 60 --p99 1500
```

Or from GitHub: Actions → **Load test** → Run workflow → enter the URL.
That runs it from a GitHub runner, which is a more honest test than your
own machine on the same network.

It is read-only — front page, a section, an article, the RSS feed,
discovered from the sitemap — so it is safe against production. It fails
if any response is not 2xx, if p99 latency is over the limit (default
2 s), or if 1% or more of requests error or time out.

What to expect from a single cPanel Node process: several hundred
requests per second on the front page and p99 well under a second,
because every public page is one or two indexed queries. If it is far
off that:

- **p99 high, errors zero** — the database. Check `innodb_ft_min_token_size`
  is set (unrelated to speed, but the same support ticket), that the host
  has not put the database on a different, slow server, and that the
  `Article(status, publishedAt)` index exists (`node setup.js check`
  confirms migrations are applied).
- **non-2xx under load** — Passenger's process limit or memory cap. Setup
  Node.js App shows the limit; shared hosting is often 1–2 processes,
  which is enough for a small site and not for a viral story. Put
  Cloudflare in front: it caches the static assets and absorbs most of
  the spike, and it is also how the analytics get country data.
- **timeouts** — usually the host's per-request limit, not the app. Ask.

Run it before launch, after any hosting change, and whenever the
homepage feels slow. Numbers from the launch run are worth keeping so
later runs have something to be compared with.
