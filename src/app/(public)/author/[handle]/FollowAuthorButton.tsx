"use client";

import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleFollowAuthor } from "@/components/engagement/actions";
import { UserPlusIcon } from "@/components/icons";

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
  return (
    <ToggleButton
      initialActive={following}
      activeLabel={`Following ${authorName}`}
      inactiveLabel={`Follow ${authorName}`}
      icon={<UserPlusIcon size={16} />}
      action={() => toggleFollowAuthor(authorId)}
      disabled={!signedIn}
      disabledTitle="Log in to follow authors"
    />
  );
}
