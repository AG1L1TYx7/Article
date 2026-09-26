/**
 * The Content-Security-Policy.
 *
 * The layer that catches an XSS the sanitizer misses. Article bodies are
 * sanitized on save and again on render, but a sanitizer is a denylist of
 * everything anyone has thought of; CSP is the backstop that means a
 * script which does slip through still cannot run.
 *
 * Built here rather than inline in proxy.ts so the directives can be read
 * in one place and asserted in tests.
 */

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** Where uploaded media is served from, when that is not this origin. */
  mediaOrigin?: string;
  /** Whether the Turnstile CAPTCHA script needs to be allowed. */
  turnstile: boolean;
  /** Whether "Continue with Google" can send somebody to Google. */
  google?: boolean;
}

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
/**
 * Where a Google sign-in actually goes.
 *
 * `accounts.google.com` is the authorisation endpoint itself. The other
 * two are where Google bounces a session through on the way, and a
 * redirect chain that leaves the allowlist is blocked just as firmly as a
 * form posting straight there.
 */
const GOOGLE_AUTH_ORIGINS = [
  "https://accounts.google.com",
  "https://accounts.youtube.com",
  "https://www.google.com",
];

/**
 * A note on Turnstile and 'strict-dynamic'.
 *
 * TurnstileWidget loads Cloudflare's script with document.createElement,
 * from code that a nonced bundle already trusts — and 'strict-dynamic'
 * propagates trust to scripts created that way. So the script itself is
 * allowed without naming the origin at all.
 *
 * frame-src is what genuinely needs it: 'strict-dynamic' applies only to
 * script loading, and the widget renders in an iframe. connect-src is
 * needed for the verification call it makes.
 */

export function buildCsp({ nonce, isDev, mediaOrigin, turnstile, google }: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Lets a script this policy trusts load the scripts it needs, without
    // naming each one. Browsers that honour it ignore any host allowlist,
    // which is what makes the policy strict rather than a list of domains
    // somebody could find an open redirect on.
    "'strict-dynamic'",
    // Ignored by any browser that understands 'strict-dynamic'. Present
    // only so a CSP Level 2 browser is not left with no working policy.
    "'unsafe-inline'",
    // Same: only consulted by browsers too old for 'strict-dynamic'.
    "https:",
    // React uses eval in development to rebuild server-side error stacks
    // in the browser. Neither React nor Next.js does in production.
    isDev ? "'unsafe-eval'" : null,
  ].filter(Boolean);

  const imgSrc = ["'self'", "blob:", "data:", mediaOrigin].filter(Boolean);
  const frameSrc = turnstile ? ["'self'", TURNSTILE_ORIGIN] : ["'self'"];
  const connectSrc = ["'self'", turnstile ? TURNSTILE_ORIGIN : null].filter(Boolean);

  const directives: Array<[string, string[] | null]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc as string[]],
    // 'unsafe-inline' rather than a nonce, deliberately. Next.js and
    // next/font inject inline style tags that a nonce does not always
    // reach, and the consequence of getting this wrong is an unstyled
    // site. Inline style is also a far weaker primitive than inline
    // script: it cannot execute, and the data exfiltration tricks it
    // enables are blocked by the img-src and connect-src rules here.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // next/font self-hosts Google Fonts at build time, so no external
    // font origin is needed.
    ["font-src", ["'self'", "data:"]],
    ["img-src", imgSrc as string[]],
    ["media-src", imgSrc as string[]],
    ["connect-src", connectSrc as string[]],
    // The push service worker (public/sw.js). Needed explicitly: without
    // a worker-src the browser falls back to script-src, and
    // 'strict-dynamic' makes script-src ignore 'self', so registration
    // would be blocked.
    ["worker-src", ["'self'"]],
    ["frame-src", frameSrc],
    // No plugins, ever.
    ["object-src", ["'none'"]],
    // Stops an injected <base> tag silently repointing every relative URL
    // on the page at an attacker's origin.
    ["base-uri", ["'none'"]],
    // A form that posts credentials somewhere else is phishing from
    // inside your own page — so this stays as tight as the site allows.
    //
    // Google is named here only when sign-in is configured, and it has to
    // be: "Continue with Google" is a form whose server action ends in a
    // redirect to Google's authorisation endpoint, and Chrome and Safari
    // apply form-action to the redirects that follow a form submission,
    // not just to its immediate target. Without this the button is
    // silently blocked with "Sending form data to '<URL>' violates the
    // following Content Security Policy directive" in the console, and
    // nothing at all on screen.
    ["form-action", google ? ["'self'", ...GOOGLE_AUTH_ORIGINS] : ["'self'"]],
    // The modern replacement for X-Frame-Options, and the one that
    // actually supports more than one value.
    ["frame-ancestors", ["'none'"]],
    ["upgrade-insecure-requests", isDev ? null : []],
  ];

  return directives
    .filter(([, values]) => values !== null)
    .map(([name, values]) => (values!.length ? `${name} ${values!.join(" ")}` : name))
    .join("; ");
}

/** A fresh, unpredictable nonce. Must be different on every request. */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
