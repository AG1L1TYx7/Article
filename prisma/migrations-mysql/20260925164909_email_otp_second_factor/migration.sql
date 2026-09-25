-- AlterTable
ALTER TABLE `user` ADD COLUMN `mfaMethod` ENUM('TOTP', 'EMAIL') NULL;

-- CreateTable
CREATE TABLE `EmailOtp` (
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailOtp_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailOtp` ADD CONSTRAINT `EmailOtp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
