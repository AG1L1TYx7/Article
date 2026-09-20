# Browsing the database

Two options, both against the existing PostgreSQL database. Neither
requires migrating anything.

## Adminer — the phpMyAdmin-style one

phpMyAdmin itself only speaks MySQL. Adminer is the same idea — a single
PHP file, a table browser, a SQL console — and it speaks PostgreSQL too.
It is already installed in the XAMPP you have.

**http://localhost/adminer.php**

| Field | Value |
| --- | --- |
| System | **PostgreSQL** (change this from MySQL in the dropdown) |
| Server | `localhost` |
| Username | `postgres` |
| Password | `postgres` |
| Database | `news_platform_dev` |

Those are the local development credentials from `.env`. Your production
database will have different ones and should never be reachable from a
browser at all — see `docs/deployment.md`.

### If it says the pgsql driver is missing

Apache has to be restarted once to pick up the change. Open the XAMPP
Control Panel, click **Stop** next to Apache, then **Start**. The change
itself is already made: `extension=pgsql` and `extension=pdo_pgsql` are
uncommented in `C:\xampp\php\php.ini` (the original is saved next to it as
`php.ini.backup-before-pgsql`).

## Prisma Studio — the one that understands the schema

```bash
npx prisma studio
```

Opens on **http://localhost:5555**. No install and no configuration: it
reads `prisma/schema.prisma`, so it knows that an Article has an author
and shows the relation as a link rather than a raw foreign key. Better for
looking at application data; Adminer is better for writing SQL.

## Why the database stayed PostgreSQL

Moving to MySQL would have meant rewriting search entirely and losing
quality doing it. Specifically:

- **No weighted ranking.** Search weights the headline above the standfirst
  above the body, so a title match outranks a passing mention. MariaDB
  FULLTEXT has no equivalent.
- **Short words stop being searchable.** MariaDB's
  `innodb_ft_min_token_size` defaults to 3, so "AI", "EU", "US" and "G7"
  would return nothing until that is reconfigured — a real problem for a
  news site.
- **The query parser becomes ours to write.** `websearch_to_tsquery`
  handles whatever a reader types without ever raising a syntax error.
  MariaDB boolean mode throws on stray punctuation.
- **Article bodies lose compression.** PostgreSQL TOAST stores a 19KB body
  in about 559 bytes — measured on this data. MariaDB has no equivalent.

None of that was worth trading for a database browser, which is what was
actually wanted.
