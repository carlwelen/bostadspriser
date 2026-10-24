import Link from "next/link";
import { roomsHref } from "./rooms";

export function RoomChips({ path, params, rooms }: {
  path: string;
  params: Record<string, string | string[] | undefined>;
  rooms: number[];
}) {
  const options = [0, 1, 2, 3, 4, 5];
  return (
    <div role="group" aria-label="Antal rum" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium text-zinc-700">Antal rum</span>
      {options.map((room) => {
        const selected = room === 0 ? rooms.length === 0 : rooms.includes(room);
        const next = room === 0 ? [] : selected ? rooms.filter((r) => r !== room) : [...rooms, room];
        return (
          <Link key={room} href={roomsHref(path, params, next)} replace scroll={false}
            aria-current={selected ? "true" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm ${selected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"}`}>
            {room === 0 ? "Alla rum" : `${room === 5 ? "5+" : room} rum`}
          </Link>
        );
      })}
      <p className="w-full text-xs text-zinc-500">Urvalet gäller alla uppgifter på sidan. 5+ omfattar fem rum eller fler.</p>
    </div>
  );
}
