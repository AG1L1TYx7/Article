-- CreateTable
CREATE TABLE `ViewDimensionDaily` (
    `articleId` VARCHAR(191) NOT NULL,
    `day` DATE NOT NULL,
    `dimension` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `views` INTEGER NOT NULL DEFAULT 0,

    INDEX `ViewDimensionDaily_day_dimension_idx`(`day`, `dimension`),
    PRIMARY KEY (`articleId`, `day`, `dimension`, `value`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleReadDaily` (
    `articleId` VARCHAR(191) NOT NULL,
    `day` DATE NOT NULL,
    `reads` INTEGER NOT NULL DEFAULT 0,
    `activeSeconds` INTEGER NOT NULL DEFAULT 0,
    `completions` INTEGER NOT NULL DEFAULT 0,
    `scrollSum` INTEGER NOT NULL DEFAULT 0,

    INDEX `ArticleReadDaily_day_idx`(`day`),
    PRIMARY KEY (`articleId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ViewDimensionDaily` ADD CONSTRAINT `ViewDimensionDaily_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArticleReadDaily` ADD CONSTRAINT `ArticleReadDaily_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

