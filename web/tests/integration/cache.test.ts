import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// B24: aggregation results are cached under tags and a secret-protected route
// invalidates them. next/cache only works inside the Next runtime, so it is
// replaced by a small in-memory stand-in with the same contract: results are
// stored per (key parts + arguments) with their tags, and revalidateTag drops
// every entry carrying the tag. What is under test is our wiring: which
// functions are cached, under which tags, and who may invalidate.
const fake = vi.hoisted(() => {
  const store = new Map<string, { value: unknown; tags: string[] }>();
  return {
    store,
    revalidated: [] as string[],
    unstable_cache:
      (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[], opts: { tags?: string[] }) =>
      async (...args: unknown[]) => {
        const key = JSON.stringify([keyParts, args]);
        const hit = store.get(key);
        if (hit) return hit.value;
        const value = await fn(...args);
        store.set(key, { value, tags: opts.tags ?? [] });
        return value;
      },
    revalidateTag(tag: string) {
      fake.revalidated.push(tag);
      for (const [k, v] of store) if (v.tags.includes(tag)) store.delete(k);
    },
  };
});
vi.mock("next/cache", () => ({
  unstable_cache: fake.unstable_cache,
  revalidateTag: fake.revalidateTag,
}));

import { prisma } from "@/lib/db";
import { districtSummary, globalSummary, streetSummary } from "@/lib/aggregations";
import { CACHE_TAG, cached } from "@/lib/cache";
import { POST as revalidatePOST } from "@/app/api/revalidate/route";
import { seed } from "../support/seed";

const SECRET = "s3cret-for-tests";
const post = (headers: Record<string, string> = {}, body?: unknown) =>
  revalidatePOST(
    new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
const auth = { authorization: `Bearer ${SECRET}` };

const dbCalls = () => {
  const original = prisma.$queryRaw.bind(prisma);
  const spy = vi.spyOn(prisma, "$queryRaw").mockImplementation(((...a: unknown[]) =>
    (original as (...x: unknown[]) => unknown)(...a)) as never);
  return spy;
};

beforeAll(async () => {
  process.env.AGG_CACHE = "on";
  process.env.REVALIDATE_SECRET = SECRET;
  await seed(prisma);
});

beforeEach(() => {
  fake.store.clear();
  fake.revalidated.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  delete process.env.AGG_CACHE;
  delete process.env.REVALIDATE_SECRET;
  await prisma.$disconnect();
});

describe("cached aggregations", () => {
  it("answers repeated calls from the cache, per argument set", async () => {
    const spy = dbCalls();
    const a = await districtSummary("vasastan");
    const b = await districtSummary("vasastan");
    expect(b).toEqual(a);
    expect(spy).toHaveBeenCalledTimes(1);
    await districtSummary("sodermalm");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("tags every entry with the global tag and its own function tag", async () => {
    await districtSummary("vasastan");
    await globalSummary();
    const tags = [...fake.store.values()].map((v) => v.tags);
    expect(tags).toEqual([
      [CACHE_TAG, "agg:districtSummary"],
      [CACHE_TAG, "agg:globalSummary"],
    ]);
  });

  it("is bypassed when AGG_CACHE=off, whatever NODE_ENV says", async () => {
    process.env.AGG_CACHE = "off";
    try {
      const spy = dbCalls();
      await districtSummary("vasastan");
      await districtSummary("vasastan");
      expect(spy).toHaveBeenCalledTimes(2);
      expect(fake.store.size).toBe(0);
    } finally {
      process.env.AGG_CACHE = "on";
    }
  });

  it("does not cache failures", async () => {
    let calls = 0;
    const flaky = cached("flaky", async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return calls;
    });
    await expect(flaky()).rejects.toThrow("boom");
    expect(await flaky()).toBe(2);
    expect(await flaky()).toBe(2);
  });
});

describe("POST /api/revalidate", () => {
  it("rejects a request without credentials (401) and with the wrong secret (403)", async () => {
    await districtSummary("vasastan");
    const none = await post();
    expect(none.status).toBe(401);
    expect(none.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await none.json()).error).toEqual(expect.any(String));
    for (const bad of ["wrong", `${SECRET}x`, SECRET.slice(0, -1), ""]) {
      const res = await post({ authorization: `Bearer ${bad}` });
      expect(res.status, bad).toBe(bad === "" ? 401 : 403);
    }
    expect((await post({ authorization: SECRET })).status).toBe(401); // not a Bearer header
    expect(fake.revalidated).toEqual([]);
    expect(fake.store.size).toBe(1); // nothing was invalidated
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.REVALIDATE_SECRET;
    try {
      expect((await post(auth)).status).toBe(403);
      expect((await post({ authorization: "Bearer " })).status).toBe(401);
      expect(fake.revalidated).toEqual([]);
    } finally {
      process.env.REVALIDATE_SECRET = SECRET;
    }
  });

  it("invalidates the global tag by default, so the next call hits the database", async () => {
    const spy = dbCalls();
    await districtSummary("vasastan");
    await globalSummary();
    expect(spy).toHaveBeenCalledTimes(3); // globalSummary issues two queries
    await districtSummary("vasastan");
    expect(spy).toHaveBeenCalledTimes(3);

    const res = await post(auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: [CACHE_TAG] });
    expect(fake.revalidated).toEqual([CACHE_TAG]);

    await districtSummary("vasastan");
    expect(spy).toHaveBeenCalledTimes(4);
    await globalSummary();
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it("can invalidate a single function's entries", async () => {
    const spy = dbCalls();
    await districtSummary("vasastan");
    await streetSummary("vasastan", "Odengatan");
    expect(spy).toHaveBeenCalledTimes(2);

    const res = await post(auth, { tags: ["agg:districtSummary"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: ["agg:districtSummary"] });

    await streetSummary("vasastan", "Odengatan"); // still cached
    expect(spy).toHaveBeenCalledTimes(2);
    await districtSummary("vasastan"); // recomputed
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("rejects unknown tags and malformed bodies without invalidating anything", async () => {
    await districtSummary("vasastan");
    for (const body of [{ tags: ["bogus"] }, { tags: [] }, { tags: "listings" }, { tags: [1] }]) {
      const res = await post(auth, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(Array.isArray((await res.json()).issues)).toBe(true);
    }
    const garbage = await revalidatePOST(
      new Request("http://localhost/api/revalidate", { method: "POST", headers: auth, body: "{not json" })
    );
    expect(garbage.status).toBe(400);
    expect(fake.revalidated).toEqual([]);
    expect(fake.store.size).toBe(1);
  });

  it("is never cacheable", async () => {
    expect((await post(auth)).headers.get("Cache-Control")).toBe("no-store");
    expect((await post()).headers.get("Cache-Control")).toBe("no-store");
  });
});
