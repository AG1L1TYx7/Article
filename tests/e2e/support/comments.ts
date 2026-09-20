import type { Page } from "@playwright/test";

/**
 * A comment as actually rendered in the thread.
 *
 * Use this instead of `page.getByText(body)` for anything the test itself
 * typed. Playwright treats a textarea's value as text, so `getByText` will
 * happily match the compose box — which means the assertion passes while
 * the post is still in flight, and passes again if the post fails and the
 * box keeps its contents. That made "the comment posted" assertions
 * unfalsifiable until it was found.
 *
 * Anchored on the `data-comment-body` element rather than the surrounding
 * `<li>`, because replies nest inside their parent's `<li>`: filtering
 * list items by text matches the ancestor as well as the reply and trips
 * strict mode.
 */
export function commentInThread(page: Page, body: string) {
  return page.locator("[data-comment-body]").filter({ hasText: body });
}
