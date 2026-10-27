import { useId, useState } from "react";
import { Sheet } from "../../components/Sheet";
import {
  HINT_GROUPS,
  HINT_LEVELS,
  type HintLevel,
  type HintTopic,
} from "./hints";

function Illustration({ topic }: { topic: HintTopic }) {
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
        {topic.illustration === "expression" && (
          <>
            {[60, 160, 260].map((x) => (
              <ellipse key={x} cx={x} cy="72" rx="36" ry="44" />
            ))}
            <path d="M43 63 Q49 56 55 63 M65 63 Q71 56 77 63 M45 87 Q60 103 75 87 M144 63 v7 M176 63 v7 M149 93 h22 M244 63 v7 M276 63 v7 M245 51 l11 -5 M265 46 l11 5" />
            <ellipse cx="260" cy="91" rx="7" ry="10" />
          </>
        )}
        {topic.illustration === "face" && (
          <>
            <circle cx="90" cy="75" r="45" />
            <ellipse cx="230" cy="75" rx="35" ry="55" />
            <g strokeDasharray="5 6" strokeWidth="2">
              <path d="M90 25 v100 M40 75 h100 M230 15 v120 M190 75 h80" />
            </g>
            <path d="M76 72 v4 M104 72 v4 M216 72 v4 M244 72 v4 M82 96 q8 5 16 0 M222 98 q8 5 16 0" />
          </>
        )}
        {topic.illustration === "pose" && (
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
  const id = useId();
  const [level, setLevel] = useState<HintLevel>("basic");
  const [selected, setSelected] = useState<Record<HintLevel, string>>({
    basic: HINT_GROUPS.basic.topics[0].id,
    advanced: HINT_GROUPS.advanced.topics[0].id,
  });
  const group = HINT_GROUPS[level];
  const topic =
    group.topics.find((hint) => hint.id === selected[level]) ?? group.topics[0];
  return (
    <Sheet title="描くヒント" onClose={onClose}>
      <p>基礎・応用は、気になるところから自由に読めます。</p>
      <div className="hint-levels" role="group" aria-label="基礎と応用">
        {HINT_LEVELS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={level === key}
            aria-controls={`${id}-topics`}
            onClick={() => setLevel(key)}
          >
            {HINT_GROUPS[key].title}
          </button>
        ))}
      </div>
      <div
        id={`${id}-topics`}
        className="hint-tabs"
        role="group"
        aria-label={`${group.title}のヒント`}
      >
        {group.topics.map((hint) => (
          <button
            key={hint.id}
            type="button"
            aria-label={hint.title}
            aria-pressed={topic.id === hint.id}
            aria-controls={`${id}-content`}
            onClick={() =>
              setSelected((previous) => ({ ...previous, [level]: hint.id }))
            }
          >
            {hint.labelParts ? (
              <span className="hint-topic-label">
                {hint.labelParts.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </span>
            ) : (
              hint.title
            )}
          </button>
        ))}
      </div>
      <section id={`${id}-content`} aria-labelledby={`${id}-heading`}>
        <h3 id={`${id}-heading`}>{topic.title}のヒント</h3>
        {topic.illustration ? (
          <Illustration topic={topic} />
        ) : (
          <p>{topic.description}</p>
        )}
        {topic.comparison && (
          <dl className="hint-comparison">
            {topic.comparison.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
        )}
        <ul className="hint-tips">
          {topic.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>
      <button className="primary" onClick={onClose}>
        描く画面に戻る
      </button>
    </Sheet>
  );
}
