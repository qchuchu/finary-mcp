// Self-check for the pure helpers (no network). Run: node --import tsx src/finary.check.ts
import assert from "node:assert";
import { chunk, flattenCategories, jwtExp } from "./finary.js";

// chunk: fixed-size groups, last group may be partial; empty → []
assert.deepEqual(
  chunk([1, 2, 3, 4, 5], 2).map((g) => g.length),
  [2, 2, 1],
);
assert.deepEqual(chunk([], 10), []);
assert.deepEqual(chunk([1, 2], 10), [[1, 2]]);

// flattenCategories: nested → flat, parent linkage preserved
const flat = flattenCategories([
  {
    id: 14,
    name: "auto",
    is_custom: false,
    is_subcategory: false,
    main_category_id: null,
    subcategories: [
      { id: 31365, name: "fuel", is_custom: false, is_subcategory: true, main_category_id: 14, subcategories: [] },
    ],
  },
]);
assert.equal(flat.length, 2, "should flatten parent + child");
assert.deepEqual(
  flat.find((c) => c.id === 31365),
  { id: 31365, name: "fuel", isSubcategory: true, isCustom: false, parentId: 14, parentName: "auto" },
);

// jwtExp: reads exp from a JWT payload
const payload = Buffer.from(JSON.stringify({ exp: 1782928390 })).toString("base64url");
assert.equal(jwtExp(`h.${payload}.sig`), 1782928390);
assert.equal(jwtExp("garbage"), 0, "unparseable → 0");

console.log("ok");
