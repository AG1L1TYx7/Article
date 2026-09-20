# Browsing the database

## Adminer — the phpMyAdmin-style one

Already installed in XAMPP:

**http://localhost/adminer.php**

| Field | Value |
| --- | --- |
| System | MySQL |
| Server | `127.0.0.1:3307` |
| Username | `root` |
| Password | *(empty)* |
| Database | `news_platform` |

The port matters. XAMPP's MariaDB runs on **3307**, not the usual 3306,
because a separately installed MySQL 8 service holds that port — so
connecting to `localhost` without a port reaches the wrong server and the
database appears not to exist. See [database.md](database.md).

## phpMyAdmin

XAMPP's bundled phpMyAdmin is configured for 3306 and will reach the
MySQL 8 service rather than this application's database. To point it at
3307, edit `C:\xampp\phpMyAdmin\config.inc.php`:

```php
$cfg['Servers'][$i]['host'] = '127.0.0.1';
$cfg['Servers'][$i]['port'] = '3307';
```

Adminer is easier, since the port is just part of the login form.

## Prisma Studio — the one that understands the schema

```bash
npx prisma studio
```

Opens on **http://localhost:5555**. No install and no configuration: it
reads `prisma/schema.prisma`, so it knows an Article has an author and
shows the relation as a link rather than a raw foreign key. Better for
looking at application data; Adminer is better for writing SQL.

## A note on the PostgreSQL setup this replaced

The project ran on PostgreSQL until the move to MySQL. If you still have
that database, it holds the old development data — the move does not
copy anything across, and the MySQL database started empty.

The PHP PostgreSQL drivers were enabled in `C:\xampp\php\php.ini` for
Adminer at the time. They are harmless to leave on; the original file is
saved beside it as `php.ini.backup-before-pgsql`.
