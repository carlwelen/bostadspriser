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
  } finally {
    await prisma.$disconnect();
  }
}
