"use client";

import { ToggleButton } from "./ToggleButton";
import { toggleArticleLike, toggleBookmark, toggleFollowAuthor } from "./actions";

export function ArticleEngagement({
  articleId,
  authorId,
  authorName,
  signedIn,
  liked,
  likeCount,
  bookmarked,
  followingAuthor,
  isOwnArticle,
}: {
  articleId: string;
  authorId: string;
  authorName: string;
  signedIn: boolean;
  liked: boolean;
  likeCount: number;
  bookmarked: boolean;
  followingAuthor: boolean;
  isOwnArticle: boolean;
}) {
  const signedOutTitle = "Log in to do that";

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-y border-neutral-200 py-3">
      <ToggleButton
        initialActive={liked}
        initialCount={likeCount}
        activeLabel="Liked"
        inactiveLabel="Like"
        action={() => toggleArticleLike(articleId)}
        disabled={!signedIn}
        disabledTitle={signedOutTitle}
      />
      <ToggleButton
        initialActive={bookmarked}
        activeLabel="Saved"
        inactiveLabel="Save"
        action={() => toggleBookmark(articleId)}
        disabled={!signedIn}
        disabledTitle={signedOutTitle}
      />
      {/* Following yourself is meaningless, so the control isn't offered. */}
      {!isOwnArticle && (
        <ToggleButton
          initialActive={followingAuthor}
          activeLabel={`Following ${authorName}`}
          inactiveLabel={`Follow ${authorName}`}
          action={() => toggleFollowAuthor(authorId)}
          disabled={!signedIn}
          disabledTitle={signedOutTitle}
        />
      )}
    </div>
  );
}
