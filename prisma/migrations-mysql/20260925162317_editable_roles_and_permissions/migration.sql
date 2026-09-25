-- AlterTable
ALTER TABLE `user` ADD COLUMN `roleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `UserRole` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `tier` ENUM('READER', 'MODERATOR', 'ADMIN') NOT NULL DEFAULT 'READER',
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `isProtected` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserRole_key_key`(`key`),
    INDEX `UserRole_tier_idx`(`tier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` VARCHAR(191) NOT NULL,
    `permission` VARCHAR(191) NOT NULL,

    INDEX `RolePermission_permission_idx`(`permission`),
    PRIMARY KEY (`roleId`, `permission`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `UserRole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `UserRole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
