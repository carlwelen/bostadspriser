import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CACHE_TAG } from "@/lib/cache";
import { errorResponse, revalidateBody, withApiErrors } from "@/lib/api-validation";

/** Constant-time string comparison (hashing first makes the lengths equal). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Drop cached aggregation results. The scraper calls this after
 * refresh_deduped_listing(); until then pages may show data up to
 * DEFAULT_REVALIDATE_SECONDS old.
 *
 *   POST /api/revalidate
 *   Authorization: Bearer $REVALIDATE_SECRET
 *   {"tags": ["listings"]}            (body optional; default: the global tag)
 *
 * 401 without a Bearer token, 403 for a wrong token (or when REVALIDATE_SECRET
 * is not configured: then nobody can invalidate), 400 for a bad body.
 */
export const POST = withApiErrors("/api/revalidate", async (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.*)$/.exec(header);
  const token = match?.[1] ?? "";
  if (token === "") {
    const res = errorResponse(401, "missing bearer token");
    res.headers.set("WWW-Authenticate", "Bearer");
    return res;
  }
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || !safeEqual(token, secret)) {
    return errorResponse(403, "forbidden");
  }

  const text = await request.text();
  let body: unknown = {};
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse(400, "body must be JSON");
    }
  }
  const parsed = revalidateBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid body",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }

  const tags = [...new Set(parsed.data.tags ?? [CACHE_TAG])];
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: tags }, { headers: { "Cache-Control": "no-store" } });
});
