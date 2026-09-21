"use client";

import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleFollowAuthor } from "@/components/engagement/actions";
import { UserPlusIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

export function FollowAuthorButton({
  authorId,
  authorName,
  signedIn,
  following,
}: {
  authorId: string;
  authorName: string;
  signedIn: boolean;
  following: boolean;
}) {
  const { t } = useI18n();
  return (
    <ToggleButton
      initialActive={following}
      activeLabel={t("engagement.following", { name: authorName })}
      inactiveLabel={t("engagement.follow", { name: authorName })}
      icon={<UserPlusIcon size={16} />}
      action={() => toggleFollowAuthor(authorId)}
      disabled={!signedIn}
      disabledTitle={t("engagement.loginToFollowAuthors")}
    />
  );
}
