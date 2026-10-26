export const MAX_LAYERS = 5;
export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
}
export interface LayerStack<T extends LayerInfo = LayerInfo> {
  activeId: string;
  items: T[]; // 下から上の順。下絵はこの枚数に含めない。
}
export interface StoredLayer extends LayerInfo {
  assetId: string;
}
export interface BitmapLayer extends LayerInfo {
  bitmap: Blob;
}
export type LayerView = LayerStack & { enabled: boolean };
export function isLayerStack(value: unknown): value is LayerStack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as LayerStack;
  if (
    typeof v.activeId !== "string" ||
    !Array.isArray(v.items) ||
    v.items.length < 1 ||
    v.items.length > MAX_LAYERS
  )
    return false;
  const ids = new Set<string>();
  for (const layer of v.items) {
    if (
      !layer ||
      typeof layer.id !== "string" ||
      !layer.id ||
      layer.id.length > 200 ||
      ids.has(layer.id) ||
      typeof layer.name !== "string" ||
      !layer.name.trim() ||
      layer.name.length > 40 ||
      typeof layer.visible !== "boolean"
    )
      return false;
    ids.add(layer.id);
  }
  return ids.has(v.activeId);
}
export function isStoredLayerStack(
  value: unknown,
): value is LayerStack<StoredLayer> {
  if (!isLayerStack(value)) return false;
  const ids = new Set<string>();
  for (const layer of (value as LayerStack<StoredLayer>).items) {
    if (
      typeof layer.assetId !== "string" ||
      !layer.assetId ||
      layer.assetId.length > 200 ||
      ids.has(layer.assetId)
    )
      return false;
    ids.add(layer.assetId);
  }
  return true;
}
