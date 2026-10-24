import type { PrismaClient } from "@prisma/client";
import { buildFixture, type FixtureListing } from "../fixtures/listings";

const TEST_NAME_RE = /(^|_)test(_|$)/;

/**
 * Empty every application table in the connected database. Refuses to run
 * unless `current_database()` is a test database, whatever the env says.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (!TEST_NAME_RE.test(db)) {
    throw new Error(`refusing to truncate non-test database "${db}"`);
  }
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Truncate, insert `rows` (defaults to the shared deterministic fixture), then
 * refresh the materialized "DedupedListingMat" the web app reads from.
 */
export async function seed(
  prisma: PrismaClient,
  rows: FixtureListing[] = buildFixture()
): Promise<FixtureListing[]> {
  await truncateAll(prisma);
  await prisma.listing.createMany({ data: rows });
  await prisma.$executeRaw`SELECT refresh_deduped_listing()`;
  return rows;
}
