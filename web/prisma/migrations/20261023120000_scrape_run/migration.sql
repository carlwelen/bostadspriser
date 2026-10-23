-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('running', 'ok', 'partial', 'failed');

-- CreateTable: one row per scraper invocation for a (source, district), so the
-- web app can show how fresh the data is and the scraper can heal coverage gaps.
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "source" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "pages" INTEGER NOT NULL DEFAULT 0,
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "status" "ScrapeStatus" NOT NULL DEFAULT 'running',
    "error" TEXT,
    "oldestSoldAt" DATE,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeRun_source_district_startedAt_idx" ON "ScrapeRun"("source", "district", "startedAt");
