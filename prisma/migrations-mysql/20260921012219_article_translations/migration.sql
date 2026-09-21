-- AlterTable
ALTER TABLE `Article` ADD COLUMN `translationOfId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Article` ADD CONSTRAINT `Article_translationOfId_fkey` FOREIGN KEY (`translationOfId`) REFERENCES `Article`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

