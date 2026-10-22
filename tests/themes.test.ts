import { describe, expect, it } from "vitest";
import {
  suggestThemes,
  THEME_CATEGORIES,
  type ThemeCategory,
} from "../src/data/themes";

const categories: Array<Exclude<ThemeCategory, "free">> = [
  "expression",
  "costume",
  "pose",
];

describe("テーマ候補", () => {
  it("4つのカテゴリに日本語の表示名を用意する", () => {
    expect(THEME_CATEGORIES).toEqual([
      { id: "expression", label: "表情" },
      { id: "costume", label: "衣装・小物" },
      { id: "pose", label: "ポーズ・場面" },
      { id: "free", label: "自由入力" },
    ]);
  });

  it.each(categories)("%sの候補は一度に3件で重複しない", (category) => {
    const result = suggestThemes(category, [], () => 0.3);
    expect(result).toHaveLength(3);
    expect(new Set(result.map(({ id }) => id)).size).toBe(3);
    for (const suggestion of result) {
      expect(suggestion.category).toBe(category);
      expect(suggestion.id).not.toBe("");
      expect(suggestion.text).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(suggestion.text.length).toBeLessThanOrEqual(500);
    }
  });

  it.each(categories)("%sの再提案は直前の3件をすべて外す", (category) => {
    const first = suggestThemes(category, [], () => 0);
    const previous = Object.freeze(first.map(({ id }) => id));
    const second = suggestThemes(category, previous, () => 0);
    expect(second).toHaveLength(3);
    expect(second.every(({ id }) => !previous.includes(id))).toBe(true);
    const all = [...first, ...second];
    expect(new Set(all.map(({ id }) => id)).size).toBeGreaterThanOrEqual(6);
    expect(previous).toEqual(first.map(({ id }) => id));
  });

  it("自由入力では候補を出さず、乱数も消費しない", () => {
    expect(
      suggestThemes("free", [], () => {
        throw new Error("呼び出してはいけません");
      }),
    ).toEqual([]);
  });

  it("選び直しを繰り返しても直前の候補を避ける", () => {
    for (const category of categories) {
      let previous: string[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const next = suggestThemes(category, previous, () => 0.8);
        expect(next.every(({ id }) => !previous.includes(id))).toBe(true);
        previous = next.map(({ id }) => id);
      }
    }
  });

  it("カテゴリを変えると前カテゴリのIDに影響されない", () => {
    const expressions = suggestThemes("expression", [], () => 0);
    const costumes = suggestThemes(
      "costume",
      expressions.map(({ id }) => id),
      () => 0,
    );
    expect(costumes).toHaveLength(3);
    expect(costumes.every(({ category }) => category === "costume")).toBe(true);
  });

  it("返された候補を書き換えても静的な題材を壊さない", () => {
    const first = suggestThemes("expression", [], () => 0.4);
    const expected = first.map((suggestion) => ({ ...suggestion }));
    first[0].text = "呼び出し側による変更";
    first.pop();
    expect(suggestThemes("expression", [], () => 0.4)).toEqual(expected);
  });

  it("全件を既表示扱いにしても3件の候補を返す", () => {
    const first = suggestThemes("pose", [], () => 0);
    const second = suggestThemes(
      "pose",
      first.map(({ id }) => id),
      () => 0,
    );
    const result = suggestThemes(
      "pose",
      [...first, ...second].map(({ id }) => id),
      () => 0,
    );
    expect(result).toHaveLength(3);
    expect(new Set(result.map(({ id }) => id)).size).toBe(3);
  });

  it.each([0, 0.999999, 1, -1, Number.NaN])(
    "乱数境界%sでも未定義や重複を返さない",
    (value) => {
      const result = suggestThemes("costume", [], () => value);
      expect(result).toHaveLength(3);
      expect(result.every((suggestion) => Boolean(suggestion.id))).toBe(true);
      expect(new Set(result.map(({ id }) => id)).size).toBe(3);
    },
  );
});
