-- AlterTable
ALTER TABLE "ArticleLink" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "fetchedAt" TIMESTAMP(3),
ADD COLUMN     "siteName" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "ArticleLink_articleId_idx" ON "ArticleLink"("articleId");
