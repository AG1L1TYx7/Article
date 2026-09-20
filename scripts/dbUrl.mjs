/**
 * Turns DATABASE_URL into the pieces the mysql/mysqldump clients want.
 *
 * Shared by backup-db.mjs and restore-db.mjs so both read the same
 * variable the application does — a backup pointed at a different
 * database than the site is worse than no backup.
 */
export function parseDatabaseUrl(raw = process.env.DATABASE_URL) {
  if (!raw) throw new Error("DATABASE_URL is not set. Put it in .env or the environment.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (!/^mysql:$/.test(url.protocol)) throw new Error("DATABASE_URL must start with mysql://");
  const database = url.pathname.replace(/^\//, "");
  if (!database) throw new Error("DATABASE_URL has no database name.");
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "3306",
    user: decodeURIComponent(url.username || "root"),
    password: decodeURIComponent(url.password || ""),
    database,
  };
}

/** Client arguments common to mysql and mysqldump. The password goes in the environment, not argv. */
export function clientArgs(conn) {
  return ["-h", conn.host, "-P", conn.port, "-u", conn.user, "--protocol=TCP"];
}

export function clientEnv(conn) {
  // MYSQL_PWD keeps the password out of `ps` output and shell history.
  return { ...process.env, ...(conn.password ? { MYSQL_PWD: conn.password } : {}) };
}
