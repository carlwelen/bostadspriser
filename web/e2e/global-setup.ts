import { PrismaClient } from "@prisma/client";
import { ensureTestDb } from "../scripts/test-db.cjs";
import { seed } from "../tests/support/seed";

// Migrate + seed the e2e database before any spec runs. Pages are rendered per
// request, so the already-started server picks the data up immediately.
export default async function globalSetup() {
  const url = ensureTestDb();
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await seed(prisma);
    // Deterministic scrape history for the "Senast uppdaterad" / coverage UI (F18).
    const at = (iso: string) => new Date(iso);
    await prisma.scrapeRun.createMany({
      data: [
        { source: "hemnet", district: "ostermalm", startedAt: at("2026-03-18T07:00:00Z"), finishedAt: at("2026-03-18T07:10:00Z"), status: "ok", pages: 3, rowsUpserted: 50 },
        { source: "hemnet", district: "vasastan", startedAt: at("2026-03-20T07:50:00Z"), finishedAt: at("2026-03-20T08:00:00Z"), status: "ok", pages: 4, rowsUpserted: 80 },
        { source: "booli", district: "vasastan", startedAt: at("2026-03-21T06:50:00Z"), finishedAt: at("2026-03-21T07:00:00Z"), status: "ok", pages: 2, rowsUpserted: 10 },
        { source: "booli", district: "ostermalm", startedAt: at("2026-03-22T07:00:00Z"), finishedAt: at("2026-03-22T07:30:00Z"), status: "partial", pages: 1, rowsUpserted: 4, error: "429" },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
}
