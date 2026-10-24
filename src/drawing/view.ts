import type { Point } from "./surface";

export interface CanvasView {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

export const FIT_VIEW: CanvasView = { scale: 1, rotation: 0, x: 0, y: 0 };
export const MIN_VIEW_SCALE = 0.5;
export const MAX_VIEW_SCALE = 8;
const HALF = { x: 0.5, y: 0.5 };
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export function normalizeAngle(angle: number) {
  return (
    ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) -
    Math.PI
  );
}

function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return { x: c * point.x - s * point.y, y: s * point.x + c * point.y };
}

/** 表示の中心が紙の外へ出ない範囲で移動する。回転時も四隅まで寄れる。 */
export function boundedView(view: CanvasView): CanvasView {
  const scale = clamp(
    Number.isFinite(view.scale) ? view.scale : 1,
    MIN_VIEW_SCALE,
    MAX_VIEW_SCALE,
  );
  const rotation = normalizeAngle(
    Number.isFinite(view.rotation) ? view.rotation : 0,
  );
  const local = rotate(
    {
      x: Number.isFinite(view.x) ? view.x / scale : 0,
      y: Number.isFinite(view.y) ? view.y / scale : 0,
    },
    -rotation,
  );
  const pan = rotate(
    { x: clamp(local.x, -0.5, 0.5), y: clamp(local.y, -0.5, 0.5) },
    rotation,
  );
  return { scale, rotation, x: pan.x * scale, y: pan.y * scale };
}

/** 紙・表示ともに幅を1とする。保存解像度や端末の画素密度に依存しない。 */
export function paperToView(point: Point, view: CanvasView): Point {
  const p = rotate({ x: point.x - 0.5, y: point.y - 0.5 }, view.rotation);
  return {
    x: 0.5 + view.x + p.x * view.scale,
    y: 0.5 + view.y + p.y * view.scale,
  };
}

export function viewToPaper(point: Point, view: CanvasView): Point {
  const p = rotate(
    {
      x: (point.x - 0.5 - view.x) / view.scale,
      y: (point.y - 0.5 - view.y) / view.scale,
    },
    -view.rotation,
  );
  return { x: p.x + 0.5, y: p.y + 0.5 };
}

export function viewAround(
  view: CanvasView,
  scale: number,
  rotation: number,
  anchor = HALF,
  destination = anchor,
): CanvasView {
  const paper = viewToPaper(anchor, view);
  const next = boundedView({ ...view, scale, rotation });
  const rotated = rotate({ x: paper.x - 0.5, y: paper.y - 0.5 }, next.rotation);
  return boundedView({
    ...next,
    x: destination.x - 0.5 - rotated.x * next.scale,
    y: destination.y - 0.5 - rotated.y * next.scale,
  });
}

export function gestureView(
  start: CanvasView,
  from: [Point, Point],
  to: [Point, Point],
) {
  const center = (pair: [Point, Point]) => ({
    x: (pair[0].x + pair[1].x) / 2,
    y: (pair[0].y + pair[1].y) / 2,
  });
  const distance = (pair: [Point, Point]) =>
    Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
  const angle = (pair: [Point, Point]) =>
    Math.atan2(pair[1].y - pair[0].y, pair[1].x - pair[0].x);
  return viewAround(
    start,
    (start.scale * distance(to)) / Math.max(0.02, distance(from)),
    start.rotation + normalizeAngle(angle(to) - angle(from)),
    center(from),
    center(to),
  );
}

export function drawingPoint(point: Point, view: CanvasView): Point {
  const p = viewToPaper(point, view);
  return { x: clamp(p.x, 0, 1) * 960, y: clamp(p.y, 0, 1) * 960 };
}

export function isOnPaper(point: Point, view: CanvasView) {
  const p = viewToPaper(point, view);
  const epsilon = 1e-9;
  return (
    p.x >= -epsilon &&
    p.x <= 1 + epsilon &&
    p.y >= -epsilon &&
    p.y <= 1 + epsilon
  );
}
