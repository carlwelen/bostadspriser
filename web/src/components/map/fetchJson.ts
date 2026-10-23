/**
 * GET a JSON endpoint. A non-ok response throws, so callers only ever see
 * success bodies: the API answers errors with `{ error, issues? }`, which must
 * never be stored as if it were data.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
  return (await res.json()) as T;
}
