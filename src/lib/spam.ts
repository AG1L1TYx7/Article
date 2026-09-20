/**
 * Cheap heuristics for holding a comment back for a human to look at.
 *
 * This is deliberately not a spam *classifier* — it never rejects anything
 * outright, it only decides "does a moderator need to see this first".
 * Getting it wrong costs a short delay, not a lost comment, which is why
 * crude rules are acceptable here.
 */
const URL_PATTERN = /https?:\/\/\S+|www\.\S+/gi;

// Deliberately short and boring. A long keyword list here would be a
// maintenance burden and a false-positive machine; the real defences are
// rate limiting, the CAPTCHA on registration, and moderation-by-default
// for new accounts.
const SPAM_PHRASES = ["buy now", "click here", "casino", "crypto giveaway", "free money"];

const MAX_LINKS_BEFORE_REVIEW = 2;
const SHOUTING_MIN_LENGTH = 20;

export interface SpamAssessment {
  needsReview: boolean;
  reason?: string;
}

export function assessComment(body: string): SpamAssessment {
  const links = body.match(URL_PATTERN) ?? [];
  if (links.length > MAX_LINKS_BEFORE_REVIEW) {
    return { needsReview: true, reason: `contains ${links.length} links` };
  }

  const lower = body.toLowerCase();
  const phrase = SPAM_PHRASES.find((p) => lower.includes(p));
  if (phrase) return { needsReview: true, reason: `matched phrase "${phrase}"` };

  // All-caps past a sentence's worth of text. Short shouts like "THIS!"
  // are fine and common, so only flag sustained shouting.
  const letters = body.replace(/[^a-z]/gi, "");
  if (letters.length >= SHOUTING_MIN_LENGTH && letters === letters.toUpperCase()) {
    return { needsReview: true, reason: "all caps" };
  }

  return { needsReview: false };
}

/**
 * How many approved comments an account needs before its comments post
 * without review. New accounts are the cheap attack surface, so they go
 * through a moderator; established ones have earned the benefit of the
 * doubt.
 */
export const TRUSTED_AFTER_APPROVED_COMMENTS = 3;
