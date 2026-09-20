"use client";

import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleFollowAuthor } from "@/components/engagement/actions";

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
      action={() => toggleFollowAuthor(authorId)}
      disabled={!signedIn}
      disabledTitle="Log in to follow authors"
    />
  );
}
