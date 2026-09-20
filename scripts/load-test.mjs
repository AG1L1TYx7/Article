/**
 * Load test: how the site holds up when many readers arrive at once.
 *
 *   npm run load-test                                  # against http://localhost:3000
 *   npm run load-test -- --url https://yourdomain.com   # against the deployed site
 *   npm run load-test -- --connections 100 --duration 60
 *
 * Read-only by design. It fetches the front page, a section, an article
 * and the RSS feed — the pages an ordinary reader hits, and the ones that
 * matter when a story goes viral. It never signs in, comments or posts,
 * so it is safe to run against production; the only side effect is that
 * the article's view count goes up. Run it against your own site only.
 *
 * Pass/fail is decided by the thresholds below, so the CI workflow
 * (.github/workflows/load-test.yml) can fail a run that regressed:
 *   - no non-2xx responses (a 500 under load is a bug, not a capacity limit)
 *   - p99 latency under --p99 milliseconds (default 2000)
 *   - fewer than 1% timeouts or socket errors
 *
 * Numbers to expect: a single cPanel Node process serves the front page
 * at a few hundred requests a second with p99 well under a second, as
 * the pages are one or two indexed queries each. If p99 is over two
 * seconds at 50 connections, look at the database first.
 */
import autocannon from "autocannon";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const base = (arg("--url", process.env.LOAD_TEST_URL ?? "http://localhost:3000")).replace(/\/$/, "");
const connections = Number(arg("--connections", "50"));
const duration = Number(arg("--duration", "30"));
const p99Limit = Number(arg("--p99", "2000"));

/** One published article and one section, found from the sitemap so the test needs no fixtures. */
async function discoverPaths() {
  const paths = ["/", "/feed.xml"];
  try {
    const res = await fetch(`${base}/sitemap.xml`);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    const article = locs.find((p) => p.startsWith("/article/"));
    const category = locs.find((p) => p.startsWith("/category/"));
    if (article) paths.push(article);
    if (category) paths.push(category);
  } catch {
    // No sitemap reachable: the two fixed paths still make a useful test.
  }
  return paths;
}

const paths = await discoverPaths();
console.log(`Load test against ${base}`);
console.log(`  ${connections} connections for ${duration}s over: ${paths.join("  ")}\n`);

// autocannon cycles through the request list, so no single page is favoured.
const result = await autocannon({
  url: base,
  connections,
  duration,
  timeout: 10,
  requests: paths.map((path) => ({ method: "GET", path })),
  setupClient(client) {
    client.setHeaders({ "user-agent": "dispatch-load-test", accept: "text/html,application/xml" });
  },
});

const { requests, latency, non2xx, errors, timeouts } = result;
const total = requests.total;
const errorRate = total ? (errors + timeouts) / total : 1;

const rows = [
  ["requests/sec", requests.average.toFixed(0)],
  ["total requests", String(total)],
  ["latency p50 (ms)", String(latency.p50)],
  ["latency p97.5 (ms)", String(latency.p97_5)],
  ["latency p99 (ms)", String(latency.p99)],
  ["latency max (ms)", String(latency.max)],
  ["non-2xx responses", String(non2xx)],
  ["errors + timeouts", `${errors + timeouts} (${(errorRate * 100).toFixed(2)}%)`],
];
for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${v}`);

const failures = [];
if (non2xx > 0) failures.push(`${non2xx} responses were not 2xx`);
if (latency.p99 > p99Limit) failures.push(`p99 latency ${latency.p99}ms is over the ${p99Limit}ms limit`);
if (errorRate >= 0.01) failures.push(`${(errorRate * 100).toFixed(2)}% of requests errored or timed out`);

if (failures.length) {
  console.error(`\nFAILED:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("\nPASSED: no errors, p99 within limit.");
