-- CreateTable
CREATE TABLE `MembershipTier` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `amountPaisa` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NPR',
    `intervalMonths` INTEGER NOT NULL DEFAULT 12,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `MembershipTier_key_key`(`key`),
    INDEX `MembershipTier_isActive_sort_idx`(`isActive`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contribution` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `kind` ENUM('ONE_OFF', 'MEMBERSHIP') NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `userId` VARCHAR(191) NULL,
    `donorName` VARCHAR(191) NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `donorEmail` VARCHAR(191) NULL,
    `amountPaisa` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NPR',
    `tierId` VARCHAR(191) NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerRef` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `staffNote` TEXT NULL,
    `confirmedById` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contribution_reference_key`(`reference`),
    INDEX `Contribution_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Contribution_userId_status_idx`(`userId`, `status`),
    INDEX `Contribution_provider_providerRef_idx`(`provider`, `providerRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contribution` ADD CONSTRAINT `Contribution_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contribution` ADD CONSTRAINT `Contribution_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contribution` ADD CONSTRAINT `Contribution_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `MembershipTier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

