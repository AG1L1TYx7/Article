-- Take issue verification off the built-in moderator role.
--
-- src/proxy.ts requires a second factor of anybody holding `issue.verify`,
-- because it carries sight of who filed an anonymous report. Granting it to
-- the default staff role meant every moderator was redirected to two-factor
-- enrolment and could reach nothing else in the dashboard — a lockout for
-- every existing staff member, introduced as a side effect of a security
-- rule rather than as a decision.
--
-- Checking reports is now a deliberate grant: an administrator builds a
-- role for it and accepts the second factor that comes with it. The seed
-- only ever adds permissions, so the rows have to be removed here.
DELETE rp FROM `RolePermission` rp
  JOIN `UserRole` r ON r.`id` = rp.`roleId`
  WHERE r.`key` = 'moderator'
    AND rp.`permission` IN ('issue.verify', 'issue.publish', 'issue.resolve');
