import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as heatmapGET } from "@/app/api/heatmap/route";
import { GET as timeseriesGET } from "@/app/api/timeseries/route";
import { GET as streetsGET } from "@/app/api/streets/route";
import { GET as streetsAllGET } from "@/app/api/streets/all/route";
import { GET as addressGET } from "@/app/api/address/route";
import { FIXTURE_COUNTS } from "../fixtures/listings";
import { seed } from "../support/seed";

// B6: every route rejects bad input with 400 + `{ error, issues? }` and turns
// unexpected failures into a 500 JSON body that never leaks SQL.

const req = (path: string) => new Request(`http://localhost${path}`);
const enc = encodeURIComponent;

type Handler = (request: Request) => Promise<Response>;

beforeAll(async () => {
  await seed(prisma);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function expect400(handler: Handler, path: string) {
  const res = await handler(req(path));
  const body = await res.json();
  expect(res.status, `${path} -> ${JSON.stringify(body)}`).toBe(400);
  expect(typeof body.error).toBe("string");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  return body;
}

describe("/api/heatmap validation", () => {
  const bad: Array<[string, string]> = [
    ["non-numeric sinceDays", "sinceDays=abc"],
    ["zero sinceDays", "sinceDays=0"],
    ["negative sinceDays", "sinceDays=-5"],
    ["huge sinceDays", "sinceDays=99999"],
    ["fractional sinceDays", "sinceDays=1.5"],
    ["exponent sinceDays", "sinceDays=1e2"],
    ["non-numeric priceMin", "priceMin=abc"],
    ["negative priceMin", "priceMin=-1"],
    ["negative priceMax", "priceMax=-1"],
    ["priceMin above priceMax", "priceMin=200000&priceMax=100000"],
    ["huge priceMax", "priceMax=99999999999"],
    ["non-numeric rooms", "rooms=abc"],
    ["partly non-numeric rooms", "rooms=2,x"],
    ["rooms of zero", "rooms=0"],
    ["rooms above 15", "rooms=16"],
    ["fractional rooms", "rooms=2.5"],
    ["unknown district", "districts=gamla-stan"],
    ["one unknown district in a list", "districts=vasastan,gamla-stan"],
    ["prototype-key district", "districts=toString"],
    ["bbox with three numbers", "bbox=17,59,18"],
    ["bbox with non-numbers", "bbox=a,b,c,d"],
    ["bbox with Infinity", "bbox=17,59,Infinity,60"],
    ["bbox with west >= east", "bbox=18,59,17,60"],
    ["bbox with south >= north", "bbox=17,60,18,59"],
    ["bbox latitude out of range", "bbox=17,59,18,91"],
    ["bbox longitude out of range", "bbox=-181,59,18,60"],
  ];
  it.each(bad)("rejects %s", async (_name, qs) => {
    const body = await expect400(heatmapGET, `/api/heatmap?${qs}`);
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("accepts the filters the UI sends, and ignores empty values", async () => {
    const ok = await heatmapGET(
      req("/api/heatmap?districts=vasastan,sodermalm&priceMin=100000&priceMax=200000&rooms=1,2,3&sinceDays=365&bbox=17.9,59.2,18.2,59.4")
    );
    expect(ok.status).toBe(200);
    const empty = await heatmapGET(req("/api/heatmap?districts=&rooms=&sinceDays=&priceMin=&bbox="));
    expect(empty.status).toBe(200);
    expect((await empty.json()).features).toHaveLength(FIXTURE_COUNTS.withCoords);
  });

  it("accepts the documented bounds exactly", async () => {
    expect((await heatmapGET(req("/api/heatmap?sinceDays=1"))).status).toBe(200);
    expect((await heatmapGET(req("/api/heatmap?sinceDays=3650"))).status).toBe(200);
    expect((await heatmapGET(req("/api/heatmap?priceMin=0&priceMax=0"))).status).toBe(200);
    expect((await heatmapGET(req("/api/heatmap?rooms=1,15"))).status).toBe(200);
  });
});

describe("/api/timeseries validation", () => {
  const bad: Array<[string, string]> = [
    ["missing id", "scope=district"],
    ["empty id", "scope=district&id="],
    ["unknown scope", "scope=city&id=vasastan"],
    ["unknown district", "scope=district&id=gamla-stan"],
    ["prototype-key district", "scope=district&id=constructor"],
    ["bad granularity", "scope=district&id=vasastan&granularity=week"],
    ["street id without a street", `scope=street&id=${enc("vasastan")}`],
    ["street id with unknown district", `scope=street&id=${enc("nowhere/Odengatan")}`],
    ["street id with too many parts", `scope=street&id=${enc("vasastan/Odengatan/2/x")}`],
    ["street id with empty street", `scope=street&id=${enc("vasastan/")}`],
    ["street id with malformed escape", `scope=street&id=${enc("vasastan/100%")}`],
    ["street id with a NUL byte", `scope=street&id=${enc("vasastan/Oden\u0000gatan")}`],
    ["overlong street", `scope=street&id=${enc("vasastan/" + "x".repeat(300))}`],
  ];
  it.each(bad)("rejects %s", async (_name, qs) => {
    await expect400(timeseriesGET, `/api/timeseries?${qs}`);
  });

  it("still serves the documented shapes", async () => {
    const house = await timeseriesGET(
      req(`/api/timeseries?scope=street&id=${enc("vasastan/Odengatan/2")}&granularity=month`)
    );
    expect(house.status).toBe(200);
  });
});

describe("/api/streets validation", () => {
  const bad: Array<[string, string]> = [
    ["non-numeric limit", "district=norrmalm&limit=abc"],
    ["zero limit", "district=norrmalm&limit=0"],
    ["negative limit", "district=norrmalm&limit=-3"],
    ["huge limit", "district=norrmalm&limit=1001"],
    ["fractional limit", "district=norrmalm&limit=2.5"],
    ["missing district", "limit=10"],
    ["empty district", "district="],
  ];
  it.each(bad)("rejects %s", async (_name, qs) => {
    await expect400(streetsGET, `/api/streets?${qs}`);
  });

  it("honours a valid limit", async () => {
    const res = await streetsGET(req("/api/streets?district=norrmalm&limit=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
    expect((await streetsGET(req("/api/streets?district=norrmalm&limit=1000"))).status).toBe(200);
  });
});

describe("/api/streets/all validation", () => {
  const bad: Array<[string, string]> = [
    ["non-numeric limit", "limit=abc"],
    ["zero limit", "limit=0"],
    ["huge limit", "limit=4001"],
  ];
  it.each(bad)("rejects %s", async (_name, qs) => {
    await expect400(streetsAllGET, `/api/streets/all?${qs}`);
  });

  it("honours a valid limit", async () => {
    const res = await streetsAllGET(req("/api/streets/all?limit=5"));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(5);
  });
});

describe("/api/address validation", () => {
  const base = "district=vasastan&street=Odengatan";
  const bad: Array<[string, string]> = [
    ["missing district", "street=Odengatan"],
    ["unknown district", "district=gamla-stan&street=Odengatan"],
    ["prototype-key district", "district=__proto__&street=Odengatan"],
    ["missing street", "district=vasastan"],
    ["empty street", "district=vasastan&street="],
    ["overlong street", `district=vasastan&street=${"x".repeat(300)}`],
    ["NUL byte in street", `district=vasastan&street=${enc("Oden\u0000gatan")}`],
    ["overlong house", `${base}&house=${"1".repeat(60)}`],
    ["NUL byte in house", `${base}&house=${enc("2\u0000")}`],
    ["unknown period", `${base}&period=5y`],
    ["prototype-key period", `${base}&period=constructor`],
  ];
  it.each(bad)("rejects %s", async (_name, qs) => {
    await expect400(addressGET, `/api/address?${qs}`);
  });

  it("treats an empty house as absent", async () => {
    const res = await addressGET(req(`/api/address?${base}&house=&period=all`));
    expect(res.status).toBe(200);
    expect((await res.json()).addressSales).toHaveLength(13);
  });
});

describe("error handling", () => {
  it("returns a JSON 500 without leaking SQL, and logs the cause", async () => {
    const secret = 'SELECT "pricePerSqmSek" FROM "DedupedListing" /* boom */';
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const cases: Array<[Handler, string]> = [
      [heatmapGET, "/api/heatmap"],
      [timeseriesGET, "/api/timeseries?scope=district&id=vasastan"],
      [streetsGET, "/api/streets?district=norrmalm"],
      [streetsAllGET, "/api/streets/all"],
      [addressGET, "/api/address?district=vasastan&street=Odengatan"],
    ];
    for (const [handler, path] of cases) {
      log.mockClear();
      const res = await handler(req(path));
      const text = await res.text();
      expect(res.status, path).toBe(500);
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
      expect(JSON.parse(text).error).toBe("internal error");
      expect(text, path).not.toContain("SELECT");
      expect(text, path).not.toContain("boom");
      expect(log, path).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0]), path).toContain("/api/");
    }
  });
});
