-- Personal details a person can edit on their account page.
-- All optional: existing accounts keep their `name` and start with these empty.
ALTER TABLE `User` ADD COLUMN `firstName` VARCHAR(80) NULL,
    ADD COLUMN `lastName` VARCHAR(80) NULL,
    ADD COLUMN `preferredName` VARCHAR(80) NULL,
    ADD COLUMN `bio` TEXT NULL;
