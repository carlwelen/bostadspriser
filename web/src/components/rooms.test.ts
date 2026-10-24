import { expect, it } from "vitest";
import { parseRooms, roomsHref } from "./rooms";

it("accepts only supported room groups and deduplicates repeated URL values", () => {
  expect(parseRooms(["5,1,1", "2", "0,6,2.5,-1,1e0,NaN"])).toEqual([1, 2, 5]);
  expect(parseRooms(undefined)).toEqual([]);
  expect(parseRooms("nonsense")).toEqual([]);
});

it("retains other URL state while adding or clearing the room selection", () => {
  expect(roomsHref("/district/ostermalm", { g: "year", rooms: ["1", "2"] }, [5, 1, 1]))
    .toBe("/district/ostermalm?g=year&rooms=1%2C5");
  expect(roomsHref("/street/ostermalm/karlavagen", { rooms: "1", g: "year" }, []))
    .toBe("/street/ostermalm/karlavagen?g=year");
});
