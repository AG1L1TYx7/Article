/**
 * Turning what a reader typed into MySQL boolean-mode syntax.
 *
 * This module exists because MySQL has no equivalent of Postgres's
 * `websearch_to_tsquery`, which accepted anything a person could type and
 * never raised an error. MySQL boolean mode instead assigns meaning to
 * `+ - > < ( ) ~ * " @`, and a stray one either changes the query's
 * meaning or makes it a syntax error. A search box that 500s on an
 * apostrophe is not a search box.
 *
 * So the operators a reader is actually offered are honoured, and every
 * other operator character is stripped rather than passed through:
 *
 *   "quoted phrase"   matched as a phrase
 *   -word             excluded
 *   everything else   optional, contributing to relevance
 *
 * The output is always valid boolean-mode input, including for input that
 * is nothing but punctuation — in which case it is empty, and the caller
 * returns no results rather than running a broken query.
 */

/** Everything MySQL treats as an operator in boolean mode. */
const OPERATORS = /[+\-><()~*"@]/g;

/**
 * A token has to contain something MySQL would actually index.
 *
 * Stripping operators is not enough on its own: "!!!" and "&&&" contain
 * no MySQL operators at all, so they would survive untouched and be sent
 * as search terms that can never match anything.
 */
const HAS_INDEXABLE = /[\p{L}\p{N}]/u;

/**
 * MySQL ignores tokens shorter than innodb_ft_min_token_size, which this
 * deployment sets to 2 so "AI", "EU" and "US" are searchable. Dropping
 * them here too keeps the query honest about what it will match.
 */
const MIN_TOKEN_LENGTH = 2;

export function toBooleanQuery(raw: string): string {
  const parts: string[] = [];
  // Consume quoted phrases first so their contents are not treated as
  // separate words and stripped of the spacing that makes them a phrase.
  const pattern = /"([^"]*)"|(\S+)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const [, phrase, word] = match;

    if (phrase !== undefined) {
      const cleaned = phrase.replace(OPERATORS, " ").replace(/\s+/g, " ").trim();
      // A one-word "phrase" is just a word; quoting it gains nothing and
      // an empty one would produce `""`, which is a syntax error.
      if (cleaned.includes(" ")) parts.push(`"${cleaned}"`);
      else if (cleaned.length >= MIN_TOKEN_LENGTH && HAS_INDEXABLE.test(cleaned)) {
        parts.push(cleaned);
      }
      continue;
    }

    if (word === undefined) continue;

    // A leading minus is the one operator carried through, because it is
    // the one readers are told about.
    const excluded = word.startsWith("-");
    const cleaned = word.replace(OPERATORS, "").trim();
    if (cleaned.length < MIN_TOKEN_LENGTH) continue;
    if (!HAS_INDEXABLE.test(cleaned)) continue;

    parts.push(excluded ? `-${cleaned}` : cleaned);
  }

  // A query of nothing but exclusions matches everything in MySQL, which
  // is the opposite of what someone typing "-spam" expects. Treated as
  // empty instead.
  if (parts.every((part) => part.startsWith("-"))) return "";

  return parts.join(" ");
}
