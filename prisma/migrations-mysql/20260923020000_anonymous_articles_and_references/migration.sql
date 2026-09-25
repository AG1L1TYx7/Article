-- AlterTable
ALTER TABLE `Article` ADD COLUMN `anonymous` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `ArticleReference` (
    `id` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `author` VARCHAR(191) NULL,
    `publication` VARCHAR(191) NULL,
    `url` VARCHAR(2000) NULL,
    `publishedOn` VARCHAR(40) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ArticleReference_articleId_position_idx`(`articleId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ArticleReference` ADD CONSTRAINT `ArticleReference_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

