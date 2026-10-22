import { describe, it, expect } from "vitest";
import { resolveRoute } from "../src/router";
describe("ハッシュルート", () => {
  it.each([
    ["", "home"],
    ["#/", "home"],
    ["#/characters", "characters"],
    ["#/characters/new", "character-new"],
    ["#/characters/missing", "character-edit"],
    ["#/new", "new"],
    ["#/draw/new", "draw"],
    ["#/draw/missing", "draw"],
    ["#/works/missing", "work"],
    ["#/settings/data", "data"],
    ["#/unknown", "not-found"],
    ["#/new/extra", "not-found"],
  ])("%s → %s", (hash, route) => expect(resolveRoute(hash)).toBe(route));
});
