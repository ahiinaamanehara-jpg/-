export type ThemeCategory = "expression" | "costume" | "pose" | "free";

export const THEME_CATEGORIES: ReadonlyArray<{
  id: ThemeCategory;
  label: string;
}> = [
  { id: "expression", label: "表情" },
  { id: "costume", label: "衣装・小物" },
  { id: "pose", label: "ポーズ・場面" },
  { id: "free", label: "自由入力" },
];

export interface ThemeSuggestion {
  id: string;
  category: Exclude<ThemeCategory, "free">;
  text: string;
}

// 顔や上半身だけでも試せる題材。公式設定・作品・難易度に依存させない。
const suggestions: readonly ThemeSuggestion[] = [
  { id: "expression-smile", category: "expression", text: "にっこり笑う顔" },
  {
    id: "expression-surprise",
    category: "expression",
    text: "少しびっくりした顔",
  },
  { id: "expression-sleepy", category: "expression", text: "ねむそうな顔" },
  { id: "expression-relief", category: "expression", text: "ほっとした表情" },
  { id: "expression-shy", category: "expression", text: "ちょっと照れた顔" },
  {
    id: "expression-thinking",
    category: "expression",
    text: "考えごとをしている顔",
  },
  { id: "costume-hair", category: "costume", text: "髪飾りをひとつ足してみる" },
  {
    id: "costume-scarf",
    category: "costume",
    text: "好きな色のマフラーを巻く",
  },
  {
    id: "costume-badge",
    category: "costume",
    text: "服に小さなバッジをつける",
  },
  { id: "costume-hat", category: "costume", text: "お気に入りの帽子をかぶる" },
  { id: "costume-glasses", category: "costume", text: "めがねをかけてみる" },
  { id: "costume-collar", category: "costume", text: "服のえりに模様を足す" },
  { id: "pose-wave", category: "pose", text: "小さく手を振る" },
  { id: "pose-drink", category: "pose", text: "好きな飲み物を持つ" },
  { id: "pose-look", category: "pose", text: "空を見上げる横顔" },
  { id: "pose-window", category: "pose", text: "窓のそばでひと休み" },
  { id: "pose-flower", category: "pose", text: "小さな花を見つめる" },
  { id: "pose-greeting", category: "pose", text: "こちらを向いてあいさつ" },
];

/** 候補を返すだけで、選択・テーマ入力は利用者が決める。 */
export function suggestThemes(
  category: ThemeCategory,
  previousIds: readonly string[] = [],
  random: () => number = Math.random,
): ThemeSuggestion[] {
  if (category === "free") return [];
  const pool = suggestions.filter(
    (suggestion) => suggestion.category === category,
  );
  const previous = new Set(previousIds);
  const fresh = pool.filter((suggestion) => !previous.has(suggestion.id));
  // 通常の再提案では、直前の3件をすべて外す。利用側が過去全件のIDを
  // 渡した場合も操作を行き止まりにせず、現在のカテゴリから候補を返す。
  const candidates = [...(fresh.length >= 3 ? fresh : pool)];
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const value = random();
    const swap = Number.isFinite(value)
      ? Math.max(0, Math.min(index, Math.floor(value * (index + 1))))
      : 0;
    [candidates[index], candidates[swap]] = [
      candidates[swap],
      candidates[index],
    ];
  }
  // 静的な題材を呼出側の書換えから守るため、結果は別のオブジェクトにする。
  return candidates.slice(0, 3).map((suggestion) => ({ ...suggestion }));
}
