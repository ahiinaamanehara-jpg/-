import { describe, it, expect } from "vitest";
import {
  REFLECTION_QUESTIONS,
  firstQuestion,
  nextQuestion,
  questionById,
  type QuestionId,
} from "../src/data/reflectionQuestions";
import {
  validateReflection,
  isPreviousArtwork,
  type Reflection,
} from "../src/data/reflections";
import type { ArtworkDraft } from "../src/data/database";

const answer: Reflection = {
  id: "answer",
  artworkId: "current",
  questionId: "summary",
  text: "",
  choice: null,
  revision: 1,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};
const artwork: ArtworkDraft = {
  id: "current",
  characterId: "favorite",
  theme: "",
  themeCategory: null,
  status: "in-progress",
  width: 960,
  height: 960,
  revision: 1,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};

describe("任意の質問", () => {
  it("途中の振り返りと通常の初問を分ける", () => {
    expect(firstQuestion(true)).toBe("summary");
    expect(firstQuestion(false)).toBe("enjoyed");
    expect(questionById("unknown")).toBeUndefined();
  });
  it("追加質問は未表示から選び、比較を混ぜない", () => {
    const ids: QuestionId[] = [];
    for (let i = 0; i < 10; i++) {
      const question = nextQuestion(ids, true);
      if (question) {
        expect(ids).not.toContain(question.id);
        ids.push(question.id);
      }
    }
    expect(ids).toHaveLength(7);
    expect(ids).not.toContain("change");
    expect(nextQuestion(ids, true)).toBeUndefined();
  });
  it("推しを選んでいない場合は推しの魅力を尋ねない", () => {
    const ids = REFLECTION_QUESTIONS.filter(
      (q) => q.id !== "charm" && q.id !== "change",
    ).map((q) => q.id);
    expect(nextQuestion(ids, false)).toBeUndefined();
    expect(nextQuestion(ids, true)?.id).toBe("charm");
  });
  it("すべての質問IDが一意で、否定的な回答を選べる", () => {
    expect(new Set(REFLECTION_QUESTIONS.map((q) => q.id)).size).toBe(8);
    expect(questionById("enjoyed")!.choices).toContain("楽しくなかった");
    expect(questionById("change")!.choices).toContain("特に変わらない");
  });
});
describe("回答データの検証", () => {
  it("空欄、否定的な内容、2000文字をそのまま保持する", () => {
    for (const text of [
      "",
      "楽しくなかった",
      "<img src=x onerror=alert(1)>",
      "あ".repeat(2000),
    ]) {
      const record = { ...answer, text };
      expect(validateReflection(record)).toBe(record);
    }
    expect(
      validateReflection({
        ...answer,
        questionId: "enjoyed",
        choice: "楽しくなかった",
      }).choice,
    ).toBe("楽しくなかった");
  });
  it.each([
    { id: "" },
    { artworkId: "" },
    { questionId: "unknown" },
    { text: "あ".repeat(2001) },
    { text: null },
    { choice: "未定義の回答" },
    { revision: 0 },
    { revision: 1.5 },
    { createdAt: "不正" },
    { updatedAt: null },
    { comparedArtworkId: "another" },
    { questionId: "change" },
    { questionId: "change", comparedArtworkId: "current" },
  ])("不正な回答を拒否する: %#", (patch) => {
    expect(() =>
      validateReflection({ ...answer, ...patch } as Reflection),
    ).toThrow("保存データ");
  });
  it("比較先を持つ比較回答を保持する", () => {
    expect(
      validateReflection({
        ...answer,
        questionId: "change",
        choice: "わからない",
        comparedArtworkId: "previous",
      }).comparedArtworkId,
    ).toBe("previous");
  });
});
describe("比較の対象", () => {
  const previous = {
    ...artwork,
    id: "previous",
    createdAt: "2026-10-21T00:00:00Z",
    canvasAssetId: "bitmap",
    thumbnailAssetId: "thumb",
  };
  it("同じ推しの保存画像を持つ前の作品だけを候補にする", () => {
    expect(isPreviousArtwork(artwork, previous)).toBe(true);
    for (const candidate of [
      { ...previous, id: artwork.id },
      { ...previous, characterId: "other" },
      { ...previous, canvasAssetId: undefined },
      { ...previous, createdAt: artwork.createdAt },
      { ...previous, createdAt: "2026-10-23T00:00:00Z" },
    ])
      expect(isPreviousArtwork(artwork, candidate)).toBe(false);
    expect(
      isPreviousArtwork(
        { ...artwork, characterId: undefined },
        { ...previous, characterId: undefined },
      ),
    ).toBe(false);
  });
});
