"use client";

import { ToggleButton } from "./ToggleButton";
import { toggleArticleLike, toggleBookmark, toggleFollowAuthor } from "./actions";
import { BookmarkIcon, HeartIcon, UserPlusIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

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
  anonymous = false,
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
  /** No follow control on an anonymous story: it would name the author. */
  anonymous?: boolean;
}) {
  const { t } = useI18n();
  const signedOutTitle = t("engagement.loginToDoThat");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleButton
        initialActive={liked}
        initialCount={likeCount}
        activeLabel={t("engagement.liked")}
        inactiveLabel={t("engagement.like")}
        icon={<HeartIcon size={16} />}
        action={() => toggleArticleLike(articleId)}
        disabled={!signedIn}
        disabledTitle={signedOutTitle}
      />
      <ToggleButton
        initialActive={bookmarked}
        activeLabel={t("engagement.saved")}
        inactiveLabel={t("engagement.save")}
        icon={<BookmarkIcon size={16} />}
        action={() => toggleBookmark(articleId)}
        disabled={!signedIn}
        disabledTitle={signedOutTitle}
      />
      {/* Following yourself is meaningless, so the control isn't offered. */}
      {!isOwnArticle && !anonymous && (
        <ToggleButton
          initialActive={followingAuthor}
          activeLabel={t("engagement.following", { name: authorName })}
          inactiveLabel={t("engagement.follow", { name: authorName })}
          icon={<UserPlusIcon size={16} />}
          action={() => toggleFollowAuthor(authorId)}
          disabled={!signedIn}
          disabledTitle={signedOutTitle}
        />
      )}
    </div>
  );
}
