"use client";

import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleFollowCategory } from "@/components/engagement/actions";
import { PlusIcon } from "@/components/icons";

export function FollowCategoryButton({
  categoryId,
  categoryName,
  signedIn,
  following,
}: {
  categoryId: string;
  categoryName: string;
  signedIn: boolean;
  following: boolean;
}) {
  return (
    <ToggleButton
      initialActive={following}
      activeLabel={`Following ${categoryName}`}
      inactiveLabel={`Follow ${categoryName}`}
      icon={<PlusIcon size={16} />}
      action={() => toggleFollowCategory(categoryId)}
      disabled={!signedIn}
      disabledTitle="Log in to follow sections"
    />
  );
}
