import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Point } from "../../drawing/surface";
import {
  FIT_VIEW,
  boundedView,
  drawingPoint,
  gestureView,
  isOnPaper,
  viewAround,
  type CanvasView,
} from "../../drawing/view";

type Pointer = Point & { type: string };
interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function CanvasViewport({
  children,
  blocked,
  tracingVisible,
  onBegin,
  onMove,
  onEnd,
  onCancel,
  onManipulating,
}: {
  children: ReactNode;
  blocked: boolean;
  tracingVisible: boolean;
  onBegin: (point: Point, id: number) => void;
  onMove: (point: Point, id: number) => void;
  onEnd: (id: number) => void;
  onCancel: (id: number) => void;
  onManipulating: (active: boolean) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CanvasView>({ ...FIT_VIEW });
  const current = useRef<CanvasView>({ ...FIT_VIEW });
  const [panMode, setPanMode] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const points = useRef(new Map<number, Pointer>());
  const stroke = useRef<number | undefined>(undefined);
  const suppressed = useRef(false);
  const gesture = useRef<
    { view: CanvasView; from: [Point, Point] } | undefined
  >(undefined);
  const pan = useRef<{ view: CanvasView; from: Point } | undefined>(undefined);
  const frame = useRef<Frame | undefined>(undefined);

  const apply = (next: CanvasView) => {
    current.current = boundedView(next);
    setView(current.current);
  };
  const readFrame = (): Frame => {
    const element = viewport.current!,
      box = element.getBoundingClientRect();
    return {
      left: box.left + element.clientLeft,
      top: box.top + element.clientTop,
      width: box.width - 2 * element.clientLeft,
      height: box.height - 2 * element.clientTop,
    };
  };
  const normalized = (point: Point, rect: Frame): Point => ({
    x: (point.x - rect.left) / Math.max(1, rect.width),
    y: (point.y - rect.top) / Math.max(1, rect.height),
  });
  const pair = (rect: Frame): [Point, Point] | undefined => {
    const touch = [...points.current.values()].filter(
      (p) => p.type === "touch",
    );
    return touch.length >= 2
      ? [normalized(touch[0], rect), normalized(touch[1], rect)]
      : undefined;
  };
  const rebase = (rect: Frame) => {
    const from = pair(rect);
    gesture.current = from ? { view: { ...current.current }, from } : undefined;
    pan.current = undefined;
  };
  const capture = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic events have no native pointer. */
    }
  };
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (blocked || event.button !== 0 || points.current.has(event.pointerId))
      return;
    // 枠外から始まった複数指操作の2本目だけで描き始めない。
    if (
      event.pointerType === "touch" &&
      !event.isPrimary &&
      !points.current.size
    )
      return;
    // ペン・マウスの使用中は手や別の入力を表示ジェスチャーにしない。
    if (
      points.current.size &&
      (event.pointerType !== "touch" ||
        [...points.current.values()].some((p) => p.type !== "touch"))
    )
      return;
    event.preventDefault();
    const rect = readFrame();
    frame.current = rect;
    points.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      type: event.pointerType,
    });
    capture(event);
    setInteracting(true);
    const p = normalized({ x: event.clientX, y: event.clientY }, rect);
    if (pair(rect)) {
      if (stroke.current !== undefined) {
        onCancel(stroke.current);
        stroke.current = undefined;
      }
      suppressed.current = true;
      onManipulating(true);
      rebase(rect);
    } else if (panMode) {
      pan.current = { view: { ...current.current }, from: p };
      onManipulating(true);
    } else if (!suppressed.current && isOnPaper(p, current.current)) {
      stroke.current = event.pointerId;
      onBegin(drawingPoint(p, current.current), event.pointerId);
    }
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = points.current.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    points.current.set(event.pointerId, {
      ...previous,
      x: event.clientX,
      y: event.clientY,
    });
    if (blocked) return;
    const rect = readFrame(),
      before = frame.current;
    frame.current = rect;
    // 回転・リサイズ・スクロールで枠が変わった直後は線をつなげない。
    if (
      before &&
      Object.keys(rect).some(
        (key) =>
          Math.abs(rect[key as keyof Frame] - before[key as keyof Frame]) > 0.1,
      )
    ) {
      if (stroke.current !== undefined) {
        onEnd(stroke.current);
        stroke.current = undefined;
        suppressed.current = true;
        onManipulating(true);
      }
      if (gesture.current) rebase(rect);
      else if (pan.current)
        pan.current = {
          view: { ...current.current },
          from: normalized({ x: event.clientX, y: event.clientY }, rect),
        };
      return;
    }
    const to = pair(rect);
    if (gesture.current && to) {
      apply(gestureView(gesture.current.view, gesture.current.from, to));
    } else if (pan.current) {
      const p = normalized({ x: event.clientX, y: event.clientY }, rect);
      apply({
        ...pan.current.view,
        x: pan.current.view.x + p.x - pan.current.from.x,
        y: pan.current.view.y + p.y - pan.current.from.y,
      });
    } else if (stroke.current === event.pointerId) {
      const samples = event.nativeEvent.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event.nativeEvent]) {
        onMove(
          drawingPoint(
            normalized({ x: sample.clientX, y: sample.clientY }, rect),
            current.current,
          ),
          event.pointerId,
        );
      }
    }
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId)) return;
    if (stroke.current === event.pointerId) {
      stroke.current = undefined;
      onEnd(event.pointerId);
    }
    points.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* Pointer is already gone. */
    }
    if (!points.current.size) {
      gesture.current = pan.current = undefined;
      suppressed.current = false;
      frame.current = undefined;
      setInteracting(false);
      onManipulating(false);
    } else if (suppressed.current) {
      rebase(readFrame());
    }
  };
  const reset = () => {
    apply({ ...FIT_VIEW });
    setPanMode(false);
  };
  const controlsDisabled = blocked || interacting;
  return (
    <>
      <details className="canvas-view-controls">
        <summary
          aria-disabled={controlsDisabled}
          onClick={(event) => {
            if (controlsDisabled) event.preventDefault();
          }}
        >
          拡大・回転・移動
        </summary>
        <p id="canvas-view-help">
          2本指で拡大・縮小・回転・移動できます。1本指は描画です。表示を動かすモードでは1本指でも移動でき、枠にフォーカスすると矢印キーも使えます。
        </p>
        <fieldset disabled={controlsDisabled}>
          <legend className="sr-only">キャンバス表示の調整</legend>
          <div className="canvas-view-values">
            <p>
              倍率<span>{Math.round(view.scale * 100)}%</span>
            </p>
            <p>
              角度<span>{Math.round((view.rotation * 180) / Math.PI)}°</span>
            </p>
          </div>
          <div className="canvas-view-buttons">
            <button
              type="button"
              onClick={() =>
                apply(
                  viewAround(
                    current.current,
                    current.current.scale / 1.25,
                    current.current.rotation,
                  ),
                )
              }
            >
              表示を縮小
            </button>
            <button
              type="button"
              onClick={() =>
                apply(
                  viewAround(
                    current.current,
                    current.current.scale * 1.25,
                    current.current.rotation,
                  ),
                )
              }
            >
              表示を拡大
            </button>
            <button type="button" onClick={reset}>
              表示を戻す
            </button>
            <button
              type="button"
              onClick={() =>
                apply(
                  viewAround(
                    current.current,
                    current.current.scale,
                    current.current.rotation - Math.PI / 12,
                  ),
                )
              }
            >
              左に回す
            </button>
            <button
              type="button"
              onClick={() =>
                apply(
                  viewAround(
                    current.current,
                    current.current.scale,
                    current.current.rotation + Math.PI / 12,
                  ),
                )
              }
            >
              右に回す
            </button>
          </div>
          <div
            className="canvas-view-modes"
            role="group"
            aria-label="キャンバスの操作"
          >
            <button
              type="button"
              aria-pressed={!panMode}
              onClick={() => setPanMode(false)}
            >
              描く
            </button>
            <button
              type="button"
              aria-pressed={panMode}
              onClick={() => {
                setPanMode(true);
                viewport.current?.focus({ preventScroll: true });
              }}
            >
              表示を動かす
            </button>
          </div>
        </fieldset>
        <p className="note">
          表示だけを調整します。保存・PNGの大きさや向きは変わりません。開き直すと全体表示に戻ります。
        </p>
      </details>
      <div
        ref={viewport}
        className={`canvas-frame${tracingVisible ? " tracing-visible" : ""}${panMode ? " canvas-pan-mode" : ""}`}
        tabIndex={0}
        role="group"
        aria-label="キャンバスの表示範囲"
        aria-describedby="canvas-view-help"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onKeyDown={(event) => {
          if (
            blocked ||
            interacting ||
            !panMode ||
            event.target !== event.currentTarget
          )
            return;
          const delta: Record<string, Point> = {
            ArrowLeft: { x: -0.08, y: 0 },
            ArrowRight: { x: 0.08, y: 0 },
            ArrowUp: { x: 0, y: -0.08 },
            ArrowDown: { x: 0, y: 0.08 },
          };
          const d = delta[event.key];
          if (d) {
            event.preventDefault();
            apply({
              ...current.current,
              x: current.current.x + d.x,
              y: current.current.y + d.y,
            });
          }
        }}
      >
        <div
          className="canvas-transform"
          style={{
            transform: `translate(${view.x * 100}%, ${view.y * 100}%) rotate(${view.rotation}rad) scale(${view.scale})`,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
