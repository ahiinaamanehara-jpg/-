import type { PreparedImage } from "../data/images";
import { pngBlob } from "../images/png";
import front from "../assets/guide-presets/guide-front.png";
import profile from "../assets/guide-presets/guide-profile-right.png";
import quarter from "../assets/guide-presets/guide-three-quarter-right.png";
import frontPreview from "../assets/guide-presets/preview-front.png";
import profilePreview from "../assets/guide-presets/preview-profile-right.png";
import quarterPreview from "../assets/guide-presets/preview-three-quarter-right.png";

export const GUIDE_PRESETS = [
  { id: "front", label: "正面", view: "front", mirrored: false },
  { id: "profile-left", label: "左横顔", view: "profile", mirrored: true },
  { id: "profile-right", label: "右横顔", view: "profile", mirrored: false },
  {
    id: "three-quarter-left",
    label: "左斜め",
    view: "three-quarter",
    mirrored: true,
  },
  {
    id: "three-quarter-right",
    label: "右斜め",
    view: "three-quarter",
    mirrored: false,
  },
] as const;
export type GuidePresetId = (typeof GUIDE_PRESETS)[number]["id"];
export interface PresetGuideSource {
  presetId: GuidePresetId;
}

// Bundled 2D renders of the MB-Lab anime base, not the 3D database or add-on.
// Sources, render permission, transformations, and checksums: docs/GUIDE_ASSETS.md.
const images = {
  front: { image: front, preview: frontPreview },
  profile: { image: profile, preview: profilePreview },
  "three-quarter": { image: quarter, preview: quarterPreview },
};

export function getGuidePreset(id: GuidePresetId) {
  const preset = GUIDE_PRESETS.find((item) => item.id === id);
  if (!preset)
    throw new Error("このあたりを読み込めません。選び直してください。");
  return preset;
}

export function guidePresetPreview(id: GuidePresetId): string {
  return images[getGuidePreset(id).view].preview;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (error) {
        image.removeAttribute("src");
        reject(error);
      } else resolve(image);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "あたりの読み込みに時間がかかっています。通信状態を確認して、もう一度選んでください。",
          ),
        ),
      15_000,
    );
    image.onload = () => finish();
    image.onerror = () =>
      finish(
        new Error(
          "用意したあたりを読み込めませんでした。通信状態を確認して、もう一度選んでください。",
        ),
      );
    image.decoding = "async";
    image.src = url;
  });
}

export async function prepareGuidePreset(
  id: GuidePresetId,
): Promise<PreparedImage> {
  const preset = getGuidePreset(id);
  const image = await loadImage(images[preset.view].image);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 960;
  try {
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("あたりを準備できませんでした。もう一度お試しください。");
    if (preset.mirrored) {
      context.translate(960, 0);
      context.scale(-1, 1);
    }
    context.drawImage(image, 0, 0, 960, 960);
    return { blob: await pngBlob(canvas), width: 960, height: 960 };
  } finally {
    canvas.width = canvas.height = 1;
    image.removeAttribute("src");
  }
}
