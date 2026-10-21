import { describe, it, expect } from "vitest";
import { resolveRoute } from "../src/router";
describe("ハッシュルート", () => {
  it.each([
    ["", "home"],
    ["#/", "home"],
    ["#/characters", "characters"],
    ["#/characters/new", "character-new"],
    ["#/characters/missing", "character-missing"],
    ["#/new", "new"],
    ["#/draw/new", "draw"],
    ["#/draw/missing", "work-missing"],
    ["#/works/missing", "work-missing"],
    ["#/settings/data", "data"],
    ["#/unknown", "not-found"],
    ["#/new/extra", "not-found"],
  ])("%s → %s", (hash, route) => expect(resolveRoute(hash)).toBe(route));
});
