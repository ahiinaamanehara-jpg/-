export const REFLECTION_QUESTIONS = [
  {
    id: "summary",
    text: "今回はどんなイラストが描けた？",
    choices: ["線を少し描いた", "途中まで描いた", "特にない"],
  },
  {
    id: "enjoyed",
    text: "今回、描いていて一番楽しかったのは？",
    choices: ["楽しかった", "楽しくなかった", "特にない"],
  },
  {
    id: "favorite",
    text: "今回の絵で気に入っているところは？",
    choices: ["表情", "線や色", "特にない"],
  },
  {
    id: "charm",
    text: "推しのどんな魅力を表現したかった？",
    choices: ["表情", "雰囲気", "特にない"],
  },
  {
    id: "experiment",
    text: "どんな工夫をしてみた？",
    choices: ["色や線", "いつもと違うところ", "特にない"],
  },
  {
    id: "discovery",
    text: "描いてみて何か発見はあった？",
    choices: ["気づいたことがある", "まだわからない", "特にない"],
  },
  {
    id: "next",
    text: "次はどんな姿を描いてみたい？",
    choices: ["表情を変えたい", "まだ決めていない", "特にない"],
  },
  {
    id: "change",
    text: "前回と比べて変わったところは？",
    choices: ["変わったところがある", "特に変わらない", "わからない"],
  },
] as const;
export type QuestionId = (typeof REFLECTION_QUESTIONS)[number]["id"];
export function questionById(id: string) {
  return REFLECTION_QUESTIONS.find((question) => question.id === id);
}
/** 比較は明示操作だけ。通常の追加質問へ混ぜない。 */
export function nextQuestion(
  seen: readonly QuestionId[],
  hasCharacter: boolean,
) {
  return REFLECTION_QUESTIONS.find(
    (question) =>
      question.id !== "change" &&
      !seen.includes(question.id) &&
      (question.id !== "charm" || hasCharacter),
  );
}
export function firstQuestion(inProgress: boolean): QuestionId {
  return inProgress ? "summary" : "enjoyed";
}
