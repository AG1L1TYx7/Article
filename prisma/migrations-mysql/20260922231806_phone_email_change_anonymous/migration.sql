-- AlterTable
ALTER TABLE `Comment` ADD COLUMN `anonymous` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `pendingEmail` VARCHAR(191) NULL,
    ADD COLUMN `phoneCodeAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `phoneCodeExpires` DATETIME(3) NULL,
    ADD COLUMN `phoneCodeHash` VARCHAR(64) NULL,
    ADD COLUMN `phoneEncrypted` VARCHAR(191) NULL,
    ADD COLUMN `phoneHash` VARCHAR(64) NULL,
    ADD COLUMN `phoneVerifiedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_phoneHash_key` ON `User`(`phoneHash`);

