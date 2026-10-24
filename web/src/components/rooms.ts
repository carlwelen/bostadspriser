type Params = Record<string, string | string[] | undefined>;

/** Room 5 denotes five or more, matching the aggregation filters. */
export function parseRooms(value: string | string[] | undefined): number[] {
  return [...new Set((Array.isArray(value) ? value : [value ?? ""])
    .flatMap((v) => v.split(","))
    .filter((v) => /^[1-5]$/.test(v))
    .map(Number))].sort((a, b) => a - b);
}

export function roomsHref(path: string, params: Params, rooms: number[]): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "rooms" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  if (rooms.length) query.set("rooms", [...new Set(rooms)].sort().join(","));
  return query.size ? `${path}?${query}` : path;
}
