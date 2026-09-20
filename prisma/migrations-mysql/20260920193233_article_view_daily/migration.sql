-- CreateTable
CREATE TABLE `ArticleViewDaily` (
    `articleId` VARCHAR(191) NOT NULL,
    `day` DATE NOT NULL,
    `views` INTEGER NOT NULL DEFAULT 0,

    INDEX `ArticleViewDaily_day_idx`(`day`),
    PRIMARY KEY (`articleId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ArticleViewDaily` ADD CONSTRAINT `ArticleViewDaily_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

