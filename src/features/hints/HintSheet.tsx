import { useId, useState } from "react";
import { Sheet } from "../../components/Sheet";

const hints = [
  {
    id: "expression",
    title: "表情",
    description: "目・眉・口を少しずつ変えた、3つの顔の例。",
    tips: [
      "口の線を曲げたり、まっすぐにしたり。ひとつ変えるだけでも表情になります。",
      "眉の傾きや目の開き方も、描きたい気持ちに合わせて選べます。",
      "顔全部を描かず、目や口だけ試しても大丈夫です。",
    ],
  },
  {
    id: "face",
    title: "顔の形",
    description: "丸い輪郭と縦長の輪郭。薄い十字線は目や鼻を置く位置の目安。",
    tips: [
      "丸やたまご形など、好きな輪郭から始められます。",
      "目や口の位置で迷ったら、うすい十字の目安を置いてみます。",
      "左右が同じでなくても、その形を使って描き進められます。",
    ],
  },
  {
    id: "pose",
    title: "簡単なポーズ",
    description: "丸い頭と短い線で表した、手を振る人と座る人。",
    tips: [
      "頭を丸、体や腕を短い線で置くと、姿のメモを作れます。",
      "手は小さな丸やミトン形からでも。指を全部描く必要はありません。",
      "顔だけ、上半身だけでも、描きたい場面を表せます。",
    ],
  },
] as const;
type HintId = (typeof hints)[number]["id"];

function Illustration({ topic }: { topic: (typeof hints)[number] }) {
  const id = useId();
  return (
    <svg
      className="hint-illustration"
      viewBox="0 0 320 150"
      role="img"
      aria-labelledby={id}
    >
      <title id={id}>{topic.description}</title>
      <g
        fill="none"
        stroke="#805236"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {topic.id === "expression" && (
          <>
            {[60, 160, 260].map((x) => (
              <ellipse key={x} cx={x} cy="72" rx="36" ry="44" />
            ))}
            <path d="M43 63 Q49 56 55 63 M65 63 Q71 56 77 63 M45 87 Q60 103 75 87 M144 63 v7 M176 63 v7 M149 93 h22 M244 63 v7 M276 63 v7 M245 51 l11 -5 M265 46 l11 5" />
            <ellipse cx="260" cy="91" rx="7" ry="10" />
          </>
        )}
        {topic.id === "face" && (
          <>
            <circle cx="90" cy="75" r="45" />
            <ellipse cx="230" cy="75" rx="35" ry="55" />
            <g strokeDasharray="5 6" strokeWidth="2">
              <path d="M90 25 v100 M40 75 h100 M230 15 v120 M190 75 h80" />
            </g>
            <path d="M76 72 v4 M104 72 v4 M216 72 v4 M244 72 v4 M82 96 q8 5 16 0 M222 98 q8 5 16 0" />
          </>
        )}
        {topic.id === "pose" && (
          <>
            <circle cx="90" cy="31" r="17" />
            <path d="M90 48 v48 M90 60 L60 78 M90 60 L119 48 L130 23 M90 96 l-22 34 M90 96 l25 34" />
            <circle cx="130" cy="16" r="7" />
            <circle cx="224" cy="33" r="17" />
            <path d="M224 50 l-10 44 h38 l12 36 M220 62 l25 24 M214 94 l-8 36 M195 105 h57" />
          </>
        )}
      </g>
    </svg>
  );
}
export function HintSheet({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<HintId>("expression");
  const topic = hints.find((hint) => hint.id === selected)!;
  return (
    <Sheet title="描くヒント" onClose={onClose}>
      <p>
        使いたいところだけ、ひとつ試せます。読まずに閉じても描き続けられます。
      </p>
      <div className="hint-tabs" role="group" aria-label="ヒントの種類">
        {hints.map((hint) => (
          <button
            key={hint.id}
            type="button"
            aria-pressed={selected === hint.id}
            onClick={() => setSelected(hint.id)}
          >
            {hint.title}
          </button>
        ))}
      </div>
      <h3>{topic.title}のヒント</h3>
      <Illustration topic={topic} />
      <ul className="hint-tips">
        {topic.tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <button className="primary" onClick={onClose}>
        描く画面に戻る
      </button>
    </Sheet>
  );
}
