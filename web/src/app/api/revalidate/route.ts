import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import "@/lib/aggregations"; // registers the cached functions (and so the valid tags)
import { CACHE_TAG, knownCacheTags } from "@/lib/cache";
import { errorResponse, revalidateBody, withApiErrors } from "@/lib/api-validation";

/** A shorter secret is treated as not configured. */
const MIN_SECRET_LENGTH = 16;

/** Constant-time string comparison (hashing first makes the lengths equal). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Drop cached aggregation results. The scraper should call this after
 * refresh_deduped_listing() (backlog B49; nothing does yet); until then pages
 * may show data up to DEFAULT_REVALIDATE_SECONDS old. Invalidates this server
 * instance's cache only.
 *
 *   POST /api/revalidate
 *   Authorization: Bearer $REVALIDATE_SECRET
 *   {"tags": ["listings"]}            (body optional; default: the global tag)
 *
 * 401 without a Bearer token, 403 for a wrong token (or when REVALIDATE_SECRET
 * is missing or shorter than MIN_SECRET_LENGTH: then nobody can invalidate),
 * 400 for a bad body or an unknown tag. The scheme is case-insensitive.
 */
export const POST = withApiErrors("/api/revalidate", async (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.*)$/i.exec(header);
  const token = match?.[1] ?? "";
  if (token === "") {
    const res = errorResponse(401, "missing bearer token");
    res.headers.set("WWW-Authenticate", "Bearer");
    return res;
  }
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH || !safeEqual(token, secret)) {
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
  const known = new Set(knownCacheTags());
  const unknown = tags.filter((t) => !known.has(t));
  if (unknown.length > 0) {
    return errorResponse(
      400,
      "unknown tag",
      unknown.map((t) => ({ path: "tags", message: `unknown tag "${t}"; valid: ${[...known].join(", ")}` }))
    );
  }
  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: tags }, { headers: { "Cache-Control": "no-store" } });
});
