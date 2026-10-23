import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

// The test database URL must work for libpq-style clients (psql, psycopg) as
// well as Prisma: spaces in `options` are %20, never "+".
const { testDatabaseUrl } = createRequire(import.meta.url)("../../scripts/test-db.cjs") as {
  testDatabaseUrl: () => string;
};

const KEYS = ["TEST_DATABASE_URL", "TEST_DB_STATEMENT_TIMEOUT_MS"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("testDatabaseUrl", () => {
  it("encodes the space in options as %20, never +", () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.TEST_DB_STATEMENT_TIMEOUT_MS;
    const url = testDatabaseUrl();
    expect(url).toContain("options=-c%20statement_timeout%3D60000");
    expect(new URL(url).search).not.toContain("+");
  });

  it("appends to an options value the URL already has and keeps other params raw", () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://u:p@localhost:5432/x_test_y?application_name=a%20b&options=-c%20lock_timeout%3D1s";
    const search = new URL(testDatabaseUrl()).search;
    expect(search).toBe(
      "?application_name=a%20b&options=-c%20lock_timeout%3D1s%20-c%20statement_timeout%3D60000"
    );
  });

  it("omits the option when the timeout is 0, and rejects a non-numeric value", () => {
    // (DATABASE_URL in this process already carries the option, so start from a plain URL.)
    process.env.TEST_DATABASE_URL = "postgresql://u:p@localhost:5432/x_test_y";
    process.env.TEST_DB_STATEMENT_TIMEOUT_MS = "0";
    expect(testDatabaseUrl()).not.toContain("options");
    for (const bad of ["abc", "-5", "1.5", "60s", ""]) {
      process.env.TEST_DB_STATEMENT_TIMEOUT_MS = bad;
      expect(() => testDatabaseUrl(), bad).toThrow(/TEST_DB_STATEMENT_TIMEOUT_MS/);
    }
  });
});
