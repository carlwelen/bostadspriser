-- CreateEnum
CREATE TYPE "District" AS ENUM ('ostermalm', 'vasastan', 'norrmalm', 'sodermalm');

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "houseNumber" TEXT,
    "district" "District" NOT NULL,
    "rooms" DECIMAL(4,1),
    "areaSqm" DECIMAL(6,1),
    "priceSek" BIGINT NOT NULL,
    "pricePerSqmSek" BIGINT NOT NULL,
    "soldAt" DATE NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geocodedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_district_soldAt_idx" ON "Listing"("district", "soldAt");

-- CreateIndex
CREATE INDEX "Listing_street_houseNumber_soldAt_idx" ON "Listing"("street", "houseNumber", "soldAt");

-- CreateIndex
CREATE INDEX "Listing_lat_lng_idx" ON "Listing"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_source_sourceId_key" ON "Listing"("source", "sourceId");
