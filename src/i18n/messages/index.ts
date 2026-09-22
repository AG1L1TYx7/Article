import type { Locale } from "../config";
import { flatten, type FlatMessages, type Messages } from "../t";
import { en } from "./en";
import { es } from "./es";

/**
 * Every dictionary, typed against English so a translation cannot be
 * missing a key. Flattened once at module load; `t()` then does a single
 * object lookup per call.
 */
const TREES: Record<Locale, Messages> = { en, es };

export const MESSAGES: Record<Locale, FlatMessages> = Object.fromEntries(
  Object.entries(TREES).map(([locale, tree]) => [locale, flatten(tree)])
) as Record<Locale, FlatMessages>;
