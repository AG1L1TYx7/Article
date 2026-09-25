import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { sessionHas } from "@/lib/auth/rbac";
import { listRoles } from "@/lib/auth/roleService";
import { PERMISSION_GROUPS } from "@/lib/auth/permissions";
import { PageBody, PageHeader } from "../../PageHeader";
import { RoleList } from "./RoleList";

export const metadata: Metadata = { title: "Roles", robots: { index: false, follow: false } };

/**
 * Roles and permissions.
 *
 * Gated on the permission rather than the tier, because this is the page
 * that makes roles mean anything — checking `session.user.role === "ADMIN"`
 * here would say that the built-in tier still decides who administers the
 * site, which is exactly what these roles exist to stop being true.
 */
export default async function RolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/dashboard/roles");
  if (!sessionHas(session, "role.manage")) redirect("/dashboard");

  const roles = await listRoles();

  return (
    <main id="main-content">
      <PageHeader
        kicker="People"
        title="Roles and permissions"
        description="A role is a named set of things somebody may do. Build as many as the work needs — a section moderator, a verifier who can publish but not edit, a contributor who can only draft — and assign them from the People page. The three built-in roles cannot be deleted, and the administrator role always keeps the permissions that administer the site."
      />
      <PageBody>
        <RoleList
          roles={roles}
          groups={PERMISSION_GROUPS}
          currentUserId={session.user.id}
        />
      </PageBody>
    </main>
  );
}
