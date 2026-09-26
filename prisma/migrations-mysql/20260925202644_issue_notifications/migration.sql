-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `issueId` VARCHAR(191) NULL,
    MODIFY `type` ENUM('COMMENT_REPLY', 'COMMENT_APPROVED', 'BREAKING_NEWS', 'ISSUE_IN_YOUR_DISTRICT', 'YOUR_ISSUE_UPDATED') NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Notification_userId_type_issueId_key` ON `Notification`(`userId`, `type`, `issueId`);

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_issueId_fkey` FOREIGN KEY (`issueId`) REFERENCES `Issue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

