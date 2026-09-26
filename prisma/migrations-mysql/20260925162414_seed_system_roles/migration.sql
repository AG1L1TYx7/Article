-- ---------------------------------------------------------------------------
-- Seed the three system roles and move every existing account onto one.
--
-- In the migration rather than the seed script because it is not optional:
-- an account whose roleId is null has no permissions at all, so skipping
-- this would silently lock the newsroom out. `npm run seed` reconciles the
-- same rows afterwards, which is how a permission added to the catalogue
-- later reaches the roles that should have it.
--
-- Ids are fixed and readable rather than generated: they are referenced by
-- the seed and by the tests, and a stable id is what makes this migration
-- re-runnable and those references safe.

INSERT INTO `UserRole` (`id`, `key`, `name`, `description`, `tier`, `isSystem`, `isProtected`, `createdAt`, `updatedAt`) VALUES
  ('role_reader', 'reader', 'Reader',
   'Everybody who registers. Can read, comment, react, save and follow — and nothing in the newsroom.',
   'READER', 1, 0, now(3), now(3)),
  ('role_moderator', 'moderator', 'Moderator',
   'Newsroom staff. Writes and publishes articles, and works the comment queue. Cannot manage people, sections or settings.',
   'MODERATOR', 1, 0, now(3), now(3)),
  ('role_admin', 'admin', 'Administrator',
   'Everything, including who else may do what. Two-factor authentication is mandatory for this tier.',
   'ADMIN', 1, 1, now(3), now(3));

INSERT INTO `RolePermission` (`roleId`, `permission`) VALUES
  ('role_reader', 'comment.create'),

  ('role_moderator', 'dashboard.access'),
  ('role_moderator', 'analytics.view'),
  ('role_moderator', 'article.create'),
  ('role_moderator', 'article.edit.own'),
  ('role_moderator', 'article.publish'),
  ('role_moderator', 'article.delete'),
  ('role_moderator', 'media.upload'),
  ('role_moderator', 'comment.create'),
  ('role_moderator', 'comment.moderate'),

  ('role_admin', 'dashboard.access'),
  ('role_admin', 'analytics.view'),
  ('role_admin', 'article.create'),
  ('role_admin', 'article.edit.own'),
  ('role_admin', 'article.edit.any'),
  ('role_admin', 'article.publish'),
  ('role_admin', 'article.delete'),
  ('role_admin', 'media.upload'),
  ('role_admin', 'comment.create'),
  ('role_admin', 'comment.moderate'),
  ('role_admin', 'category.manage'),
  ('role_admin', 'settings.manage'),
  ('role_admin', 'user.manage'),
  ('role_admin', 'role.manage'),
  ('role_admin', 'auditlog.view');

-- Every existing account keeps exactly the abilities it had this morning.
UPDATE `User` SET `roleId` = 'role_admin'     WHERE `role` = 'ADMIN'     AND `roleId` IS NULL;
UPDATE `User` SET `roleId` = 'role_moderator' WHERE `role` = 'MODERATOR' AND `roleId` IS NULL;
UPDATE `User` SET `roleId` = 'role_reader'    WHERE `role` = 'READER'    AND `roleId` IS NULL;
