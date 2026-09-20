# The database

MySQL 8 or MariaDB 10.4+, through Prisma with the
`@prisma/adapter-mariadb` driver adapter. The adapter speaks the same wire
protocol to both.

## One setting you cannot skip

```ini
innodb_ft_min_token_size = 2
```

The default is 3, which means MySQL **does not index any word shorter than
three characters**. On a news site that silently breaks searching for
"AI", "EU", "US", "G7" and "UN" — the query runs, returns nothing, and
nothing in the logs says why.

It can only be set at server startup, so it lives wherever the server is
configured rather than in a migration:

| Where | How |
| --- | --- |
| Docker / production | `command: --innodb-ft-min-token-size=2` in `docker-compose.yml` |
| CI | a service option in `.github/workflows/ci.yml` |
| XAMPP locally | `innodb_ft_min_token_size=2` under `[mysqld]` in `C:\xampp\mysql\bin\my.ini` |

**Changing it does not reindex existing rows.** Set it before loading
data, or rebuild the indexes afterwards with `OPTIMIZE TABLE Article`.

## Local setup with XAMPP

XAMPP's MariaDB runs on **port 3307** here, not the usual 3306, because a
separately installed MySQL 8 service already holds that port. The port is
set in `C:\xampp\mysql\bin\my.ini` (the original is saved beside it as
`my.ini.backup-before-3307`).

```
DATABASE_URL="mysql://root@127.0.0.1:3307/news_platform"
```

If you later remove the MySQL 8 services, you can move XAMPP back to 3306
by restoring that backup — just remember to change `DATABASE_URL` and the
`MYSQL_PORT` the e2e helper defaults to.

## Full-text search

Four FULLTEXT indexes, declared in `schema.prisma`:

| Index | Purpose |
| --- | --- |
| `(title, dek, searchText)` | decides **whether** a row matches |
| `(title)`, `(dek)`, `(searchText)` | score each column so relevance can be **weighted** |

MySQL cannot compute a full-text index at query time the way Postgres
computes a `tsvector`, so they have to exist up front — and `MATCH` must
name exactly the columns some index covers, which is why there are four
rather than one.

The weighting is 3/2/1 across title, dek and body, so an article whose
headline matches outranks one that merely mentions the words halfway
down. Postgres expressed that with `setweight()` on a single vector;
MySQL has no equivalent, so it costs three extra indexes.

### Why queries are sanitised before they reach MySQL

`src/lib/searchQuery.ts` converts what a reader typed into boolean-mode
syntax. This is not decoration. MySQL boolean mode assigns meaning to
`+ - > < ( ) ~ * " @`, and a stray one is a **syntax error** — so a search
box that passed input straight through would return a 500 the first time
somebody typed an apostrophe or an unbalanced bracket.

Postgres had `websearch_to_tsquery`, which accepted anything and never
errored. Nothing in MySQL does that job, so the module does it instead.
Its tests are the cases that would otherwise be 500s.

## Timestamps

Prisma stores `DateTime` as a UTC instant in a `DATETIME(3)` column, while
`NOW()` returns the **server's local time**. Comparing the two shifts
every row by the server's offset.

Raw SQL comparing a stored timestamp against the current time must
therefore use `UTC_TIMESTAMP()`:

```sql
AND a.publishedAt <= UTC_TIMESTAMP()
```

This is the same bug the Postgres version had, where it hid everything
published in the previous few hours on a server set to `America/New_York`.
There is exactly one raw SQL statement in the application — `lib/search.ts`
— so there is exactly one place to get this wrong.

## Identifiers in raw SQL

MySQL quotes identifiers with backticks. A double-quoted token is a
*string literal*, so `"User"` is the text User rather than the table.

The e2e helpers write SQL inside JavaScript template literals, which are
themselves delimited by backticks — so the quoting there has to be
escaped: ``\`User\```.

## Migrations

`prisma/migrations-mysql/`, configured in `prisma7.config.ts`.

A separate directory from the default so the PostgreSQL history is not
mixed in with it. Those migrations are no longer on disk but remain in
git history — `git show main:prisma/migrations/20260917135223_init/migration.sql`
recovers any of them if the old schema ever needs consulting.

The empty `prisma/migrations/` directories left behind are untracked and
harmless; delete them whenever you like.
