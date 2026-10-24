import type { GuideAsset } from "../data/database";

export interface TracingSettings {
  assetId: string;
  opacity: number;
  visible: boolean;
}

export interface TracingUpdate {
  settings?: TracingSettings;
  asset?: GuideAsset;
}

export const DEFAULT_TRACING_OPACITY = 30;

export function isTracingSettings(value: unknown): value is TracingSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as TracingSettings;
  return (
    typeof s.assetId === "string" &&
    s.assetId.length > 0 &&
    s.assetId.length <= 200 &&
    Number.isInteger(s.opacity) &&
    s.opacity >= 10 &&
    s.opacity <= 70 &&
    typeof s.visible === "boolean"
  );
}
