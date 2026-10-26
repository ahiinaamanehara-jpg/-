import { useEffect, useId, useRef, type ReactNode } from "react";
import { MAX_LAYERS } from "../../drawing/layers";

export type DrawingPanel = "tracing" | "layers" | "view" | "tools";
const features = [
  {
    id: "tracing",
    label: "下絵をなぞる",
    words: ["下絵を", "なぞる"],
    icon: "M4 17v3h3L19 8l-3-3L4 17ZM13 8l3 3M4 4h7M4 8h4",
  },
  {
    id: "layers",
    label: "レイヤー",
    words: ["レイヤー"],
    icon: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  },
  {
    id: "view",
    label: "拡大・回転",
    words: ["拡大・", "回転"],
    icon: "M18 8a7 7 0 1 0 1 8M18 3v5h-5M9 12h6M12 9v6",
  },
] as const;

/** 入口と設定を同じ場所に置き、内容は隠しても描画用Canvasは移動しない。 */
export function DrawingSupport({
  active,
  blocked,
  focused,
  tracing,
  layers,
  tracingStatus,
  layerCount,
  onToggle,
  onClose,
  viewTargetRef,
}: {
  active?: DrawingPanel;
  blocked: boolean;
  focused: boolean;
  tracing: ReactNode;
  layers: ReactNode;
  tracingStatus: string;
  layerCount: number;
  onToggle: (panel: DrawingPanel) => void;
  onClose: () => void;
  viewTargetRef: (element: HTMLDivElement | null) => void;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const feature = features.find((item) => item.id === active);
  useEffect(() => {
    if (feature) heading.current?.focus({ preventScroll: focused });
  }, [feature, focused]);
  const close = () => {
    onClose();
    if (active) triggers.current.get(active)?.focus({ preventScroll: focused });
  };
  return (
    <section
      className="drawing-support-controls"
      aria-label="描くサポート"
      onKeyDown={(event) => {
        if (feature && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={`support-heading${focused ? " sr-only" : ""}`}>
        <h2>描くサポート</h2>
        <p>必要なときだけ使えます</p>
      </div>
      <div className="support-buttons" data-workspace-scroll>
        {features.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={blocked}
            aria-label={item.label}
            aria-expanded={active === item.id}
            aria-controls={`${id}-${item.id}`}
            aria-describedby={`${id}-${item.id}-status`}
            ref={(element) => {
              if (element) triggers.current.set(item.id, element);
              else triggers.current.delete(item.id);
            }}
            onClick={() => onToggle(item.id)}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d={item.icon} />
            </svg>
            <span className="support-label">
              {item.words.map((word) => (
                <span key={word}>{word}</span>
              ))}
            </span>
            <span className="support-state" id={`${id}-${item.id}-status`}>
              {item.id === "tracing"
                ? tracingStatus
                : item.id === "layers"
                  ? `${Math.max(1, layerCount)}／${MAX_LAYERS}枚`
                  : "表示を調整"}
            </span>
          </button>
        ))}
      </div>
      <div className="support-panel" hidden={!feature} data-workspace-scroll>
        <div className="support-panel-heading">
          <h3 ref={heading} tabIndex={-1}>
            {feature?.label}
          </h3>
          <button type="button" aria-label="サポートを閉じる" onClick={close}>
            閉じる
          </button>
        </div>
        <div id={`${id}-tracing`} hidden={active !== "tracing"}>
          {tracing}
        </div>
        <div id={`${id}-layers`} hidden={active !== "layers"}>
          {layers}
        </div>
        <div id={`${id}-view`} hidden={active !== "view"} ref={viewTargetRef} />
      </div>
    </section>
  );
}
