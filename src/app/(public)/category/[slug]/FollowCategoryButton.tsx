"use client";

import { ToggleButton } from "@/components/engagement/ToggleButton";
import { toggleFollowCategory } from "@/components/engagement/actions";
import { PlusIcon } from "@/components/icons";
import { useI18n } from "@/i18n/client";

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
  const { t } = useI18n();
  return (
    <ToggleButton
      initialActive={following}
      activeLabel={t("engagement.following", { name: categoryName })}
      inactiveLabel={t("engagement.follow", { name: categoryName })}
      icon={<PlusIcon size={16} />}
      action={() => toggleFollowCategory(categoryId)}
      disabled={!signedIn}
      disabledTitle={t("engagement.loginToFollowSections")}
    />
  );
}
