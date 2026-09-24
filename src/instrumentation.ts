import type { Instrumentation } from "next";

/**
 * Runs once when a server instance starts, before it takes requests.
 *
 * In production it checks the configuration and refuses to start on a
 * blocker — a missing email provider, a placeholder AUTH_SECRET, a
 * localhost public address — because each of those is a site that looks
 * fine and fails the first reader who needs to reset a password. The
 * same report is available before deploying as `npm run check:production`.
 *
 * ALLOW_PRODUCTION_FALLBACKS=1 downgrades blockers to warnings. It exists
 * for a staging box and for the test suite's production build; the real
 * site should never set it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  // A deploy signals "new version in place" by touching tmp/restart.txt;
  // see lib/restartOnDeploy.ts for why the app, not the deploy, restarts it.
  const { restartOnDeploy } = await import("./lib/restartOnDeploy");
  restartOnDeploy();

  const { assessReadiness, formatReadiness } = await import("./lib/productionReadiness");
  const { isTranscodingConfigured } = await import("./lib/transcode");
  const report = assessReadiness(process.env, { ffmpegAvailable: isTranscodingConfigured() });
  const text = formatReadiness(report);

  if (report.blockers.length === 0) {
    console.log(`[startup] ${text}`);
    return;
  }
  if (process.env.ALLOW_PRODUCTION_FALLBACKS) {
    console.warn(`[startup] ALLOW_PRODUCTION_FALLBACKS is set — starting anyway.\n${text}`);
    return;
  }
  console.error(`[startup] Refusing to start.\n${text}\n\nFix the blockers above, or set ALLOW_PRODUCTION_FALLBACKS=1 on a staging server only.`);
  // Exit rather than throw: a thrown error leaves Next.js bound to the
  // port with a server it never finished preparing, which a process
  // manager reads as "up". A dead process is what makes it restart or
  // alert, and what makes the failure impossible to miss.
  process.exit(1);
}

/**
 * Every unhandled error in a request, on one log line with the route it
 * came from. Without this a production server prints a stack and nothing
 * else; with it, a log search for "[request error]" finds what broke and
 * where. Hand `error` to an error-tracking service here when one is
 * adopted.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const message = error instanceof Error ? error.message : String(error);
  const digest = error && typeof error === "object" && "digest" in error ? (error as { digest?: string }).digest : undefined;
  console.error(
    `[request error] ${request.method} ${request.path} (${context.routeType}${context.routePath ? ` ${context.routePath}` : ""}): ${message}${digest ? ` [digest ${digest}]` : ""}`
  );
};
