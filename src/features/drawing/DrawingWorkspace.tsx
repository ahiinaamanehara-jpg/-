import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DrawingSupport, type DrawingPanel } from "./DrawingSupport";

/** Canvasを移し替えず、同じdialogを通常表示と画面全体の表示に使う。 */
export function DrawingWorkspace({
  blocked,
  statusText,
  statusKind,
  onSave,
  canvas,
  tools,
  options,
  tracing,
  layers,
  tracingStatus,
  layerCount,
  actions,
  feedback,
}: {
  blocked: boolean;
  statusText: string;
  statusKind: string;
  onSave?: () => void;
  canvas: (controlsTarget: HTMLElement | null, focused: boolean) => ReactNode;
  tools: ReactNode;
  options: ReactNode;
  tracing: ReactNode;
  layers: ReactNode;
  tracingStatus: string;
  layerCount: number;
  actions: (focused: boolean) => ReactNode;
  feedback: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const [panel, setPanel] = useState<DrawingPanel>();
  const optionsOpen = panel === "tools";
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!focused) return;
    const element = dialog.current!;
    const returnFocus = trigger.current;
    const previous = { x: window.scrollX, y: window.scrollY };
    const body = document.body;
    const root = document.documentElement;
    const bodyProperties = ["position", "top", "left", "width", "overflow"];
    const rootProperties = ["overflow", "overscroll-behavior"];
    const remember = (style: CSSStyleDeclaration, properties: string[]) =>
      properties.map((key) => [
        key,
        style.getPropertyValue(key),
        style.getPropertyPriority(key),
      ]);
    const oldBody = remember(body.style, bodyProperties);
    const oldRoot = remember(root.style, rootProperties);
    body.style.position = "fixed";
    body.style.top = `${-previous.y}px`;
    body.style.left = `${-previous.x}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    element.close();
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    const preventPageMove = (event: Event) => {
      if (event instanceof WheelEvent && event.ctrlKey) return;
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-workspace-scroll]")
      )
        event.preventDefault();
    };
    element.addEventListener("touchmove", preventPageMove, { passive: false });
    element.addEventListener("wheel", preventPageMove, { passive: false });
    return () => {
      element.removeEventListener("touchmove", preventPageMove);
      element.removeEventListener("wheel", preventPageMove);
      element.close();
      const restore = (style: CSSStyleDeclaration, values: string[][]) => {
        for (const [key, value, priority] of values) {
          if (value) style.setProperty(key, value, priority);
          else style.removeProperty(key);
        }
      };
      restore(body.style, oldBody);
      restore(root.style, oldRoot);
      // 画面内へ戻す場合もCanvasのDOM・画素・履歴を作り直さない。
      if (element.isConnected) element.show();
      returnFocus?.focus({ preventScroll: true });
      window.scrollTo(previous.x, previous.y);
    };
  }, [focused]);

  useEffect(() => {
    if (!focused) return;
    const element = stage.current!;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const { width, height } = box;
      element.style.setProperty(
        "--paper-size",
        `${Math.max(0, Math.floor(Math.min(width, height)))}px`,
      );
      // 設定を開いてもサポートの入口を覆わず、別の機能へ直接切り替えられる。
      dialog.current!.style.setProperty(
        "--workspace-panel-top",
        `${Math.max(0, Math.ceil(box.top - dialog.current!.getBoundingClientRect().top))}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [focused]);

  const closeOptions = () => {
    setPanel(undefined);
    optionsButton.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="workspace-entry">
        <button
          ref={trigger}
          type="button"
          className="primary"
          aria-haspopup="dialog"
          disabled={blocked}
          onClick={() => {
            setPanel(undefined);
            setFocused(true);
          }}
        >
          画面いっぱいで描く
        </button>
        <p className="note">
          スマホの画面に合わせた専用の枠で描けます。周囲に触れてもページは動きません。
        </p>
      </div>
      <dialog
        ref={dialog}
        open
        className={`drawing-workspace${focused ? " is-focused" : ""}`}
        aria-modal={focused ? "true" : "false"}
        aria-label={focused ? "画面いっぱいで描く" : "キャンバスと道具"}
        aria-describedby={focused ? `${id}-help` : undefined}
        onCancel={(event) => {
          event.preventDefault();
          if (panel === "tools") closeOptions();
          else if (panel) setPanel(undefined);
          else if (!blocked) setFocused(false);
        }}
        onKeyDown={(event) => {
          if (!focused || event.key !== "Tab") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
            ),
          ).filter(
            (el) =>
              el.getClientRects().length > 0 &&
              getComputedStyle(el).visibility !== "hidden",
          );
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {focused && (
          <div className="workspace-heading" data-workspace-scroll>
            <div className="workspace-heading-actions">
              <button
                ref={closeButton}
                type="button"
                disabled={blocked}
                onClick={() => {
                  setPanel(undefined);
                  setFocused(false);
                }}
              >
                通常画面に戻る
              </button>
              <button
                type="button"
                className="primary"
                disabled={blocked || !onSave}
                onClick={onSave}
              >
                途中で保存
              </button>
            </div>
            <p className={`workspace-status ${statusKind}`} role="status">
              {statusKind === "pending"
                ? "未保存"
                : statusKind === "scratch"
                  ? "保存なしの落書き"
                  : statusText}
            </p>
            <p id={`${id}-help`} className="sr-only">
              1本指で描き、2本指で拡大・回転・移動できます。「描くサポート」に下絵・レイヤー・拡大回転のボタンがあります。道具設定から色や線幅、PNG書き出しを選べます。
            </p>
          </div>
        )}
        <DrawingSupport
          active={panel}
          blocked={blocked}
          focused={focused}
          tracing={tracing}
          layers={layers}
          tracingStatus={tracingStatus}
          layerCount={layerCount}
          onToggle={(next) =>
            setPanel((current) => (current === next ? undefined : next))
          }
          onClose={() => setPanel(undefined)}
          viewTargetRef={setControlsTarget}
        />
        <div className="workspace-stage" ref={stage}>
          {canvas(controlsTarget, focused)}
        </div>
        <fieldset
          className="drawing-tools workspace-tools"
          disabled={blocked}
          data-workspace-scroll
        >
          <legend className="sr-only">描画の道具</legend>
          {tools}
          {focused ? (
            <button
              type="button"
              ref={optionsButton}
              aria-expanded={optionsOpen}
              aria-controls={`${id}-options`}
              onClick={() =>
                setPanel((current) =>
                  current === "tools" ? undefined : "tools",
                )
              }
            >
              道具設定
            </button>
          ) : (
            options
          )}
        </fieldset>
        <div className="workspace-feedback" data-workspace-scroll>
          {feedback}
        </div>
        {!focused && actions(false)}
        <section
          id={`${id}-options`}
          className="workspace-options"
          hidden={!focused || !optionsOpen}
          data-workspace-scroll
          aria-label="色・線幅・書き出しの設定"
        >
          <div className="workspace-options-heading">
            <h2>色・線幅・書き出し</h2>
            <button type="button" disabled={blocked} onClick={closeOptions}>
              設定を閉じる
            </button>
          </div>
          {focused && (
            <fieldset disabled={blocked}>
              <legend className="sr-only">色と線の太さ</legend>
              {options}
            </fieldset>
          )}
          {focused && actions(true)}
        </section>
      </dialog>
    </>
  );
}
