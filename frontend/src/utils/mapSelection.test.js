import test from "node:test";
import assert from "node:assert/strict";

import { chooseMapForTrack, findMatchingMap } from "./mapSelection.js";

const maps = [
  { id: "fallback", name: "General Offline Map" },
  { id: "sindh", name: "Nergalith Wayfinder - Sindh OSM" },
];

test("auto-match selects the patrol map by map_package.name", () => {
  assert.equal(findMatchingMap(maps, "NERGALITH WAYFINDER - SINDH OSM")?.id, "sindh");
  assert.deepEqual(chooseMapForTrack(maps, "Nergalith Wayfinder - Sindh OSM", "fallback"), {
    map: maps[1],
    missingRequestedMap: false,
  });
});

test("missing patrol map falls back to the last used map and raises a notice", () => {
  assert.deepEqual(chooseMapForTrack(maps, "Missing Patrol Map", "fallback"), {
    map: maps[0],
    missingRequestedMap: true,
  });
});

test("no installed maps remains usable without a selection", () => {
  assert.deepEqual(chooseMapForTrack([], "Missing Patrol Map", "fallback"), {
    map: null,
    missingRequestedMap: true,
  });
});
