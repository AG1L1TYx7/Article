-- CreateIndex
CREATE FULLTEXT INDEX `Article_title_idx` ON `Article`(`title`);

-- CreateIndex
CREATE FULLTEXT INDEX `Article_dek_idx` ON `Article`(`dek`);

-- CreateIndex
CREATE FULLTEXT INDEX `Article_searchText_idx` ON `Article`(`searchText`);

