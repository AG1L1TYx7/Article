-- Breaking-news alerts reuse the Notification table.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BREAKING_NEWS';

-- CreateIndex
--
-- The existing (userId, type, commentId) constraint cannot deduplicate an
-- article notification: commentId is NULL for those, and Postgres allows
-- NULLs to repeat in a unique index. Without this, somebody following both
-- an author and the section they published in is told twice.
CREATE UNIQUE INDEX "Notification_userId_type_articleId_key" ON "Notification"("userId", "type", "articleId");
