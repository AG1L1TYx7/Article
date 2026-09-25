-- AlterTable
ALTER TABLE `user` ADD COLUMN `districtId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Province` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameNe` VARCHAR(191) NOT NULL,
    `capital` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,

    UNIQUE INDEX `Province_name_key`(`name`),
    UNIQUE INDEX `Province_number_key`(`number`),
    INDEX `Province_number_idx`(`number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `District` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameNe` VARCHAR(191) NOT NULL,
    `provinceId` VARCHAR(191) NOT NULL,

    INDEX `District_provinceId_idx`(`provinceId`),
    UNIQUE INDEX `District_provinceId_name_key`(`provinceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Municipality` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameNe` VARCHAR(191) NOT NULL,
    `kind` ENUM('METROPOLITAN', 'SUB_METROPOLITAN', 'MUNICIPALITY', 'RURAL_MUNICIPALITY') NOT NULL,
    `districtId` VARCHAR(191) NOT NULL,
    `wards` INTEGER NOT NULL DEFAULT 0,

    INDEX `Municipality_districtId_idx`(`districtId`),
    UNIQUE INDEX `Municipality_districtId_name_key`(`districtId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Issue` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `categoryId` VARCHAR(191) NULL,
    `provinceId` VARCHAR(191) NOT NULL,
    `districtId` VARCHAR(191) NOT NULL,
    `municipalityId` VARCHAR(191) NULL,
    `ward` INTEGER NULL,
    `status` ENUM('SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'PUBLISHED', 'REJECTED', 'RESOLVED') NOT NULL DEFAULT 'SUBMITTED',
    `verifiedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolutionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Issue_reference_key`(`reference`),
    UNIQUE INDEX `Issue_slug_key`(`slug`),
    INDEX `Issue_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Issue_districtId_status_idx`(`districtId`, `status`),
    INDEX `Issue_provinceId_status_idx`(`provinceId`, `status`),
    INDEX `Issue_reporterId_idx`(`reporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IssueMedia` (
    `issueId` VARCHAR(191) NOT NULL,
    `mediaId` VARCHAR(191) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `IssueMedia_mediaId_idx`(`mediaId`),
    PRIMARY KEY (`issueId`, `mediaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_districtId_fkey` FOREIGN KEY (`districtId`) REFERENCES `District`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `District` ADD CONSTRAINT `District_provinceId_fkey` FOREIGN KEY (`provinceId`) REFERENCES `Province`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Municipality` ADD CONSTRAINT `Municipality_districtId_fkey` FOREIGN KEY (`districtId`) REFERENCES `District`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Issue` ADD CONSTRAINT `Issue_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Issue` ADD CONSTRAINT `Issue_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Issue` ADD CONSTRAINT `Issue_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Issue` ADD CONSTRAINT `Issue_provinceId_fkey` FOREIGN KEY (`provinceId`) REFERENCES `Province`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Issue` ADD CONSTRAINT `Issue_districtId_fkey` FOREIGN KEY (`districtId`) REFERENCES `District`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Issue` ADD CONSTRAINT `Issue_municipalityId_fkey` FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IssueMedia` ADD CONSTRAINT `IssueMedia_issueId_fkey` FOREIGN KEY (`issueId`) REFERENCES `Issue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IssueMedia` ADD CONSTRAINT `IssueMedia_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `Media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
