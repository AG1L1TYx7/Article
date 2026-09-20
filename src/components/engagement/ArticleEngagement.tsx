"use client";

import { ToggleButton } from "./ToggleButton";
import { toggleArticleLike, toggleBookmark, toggleFollowAuthor } from "./actions";
import { BookmarkIcon, HeartIcon, UserPlusIcon } from "@/components/icons";

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
    <div className="flex flex-wrap items-center gap-2">
      <ToggleButton
        initialActive={liked}
        initialCount={likeCount}
        activeLabel="Liked"
        inactiveLabel="Like"
        icon={<HeartIcon size={16} />}
        action={() => toggleArticleLike(articleId)}
        disabled={!signedIn}
        disabledTitle={signedOutTitle}
      />
      <ToggleButton
        initialActive={bookmarked}
        activeLabel="Saved"
        inactiveLabel="Save"
        icon={<BookmarkIcon size={16} />}
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
          icon={<UserPlusIcon size={16} />}
          action={() => toggleFollowAuthor(authorId)}
          disabled={!signedIn}
          disabledTitle={signedOutTitle}
        />
      )}
    </div>
  );
}
