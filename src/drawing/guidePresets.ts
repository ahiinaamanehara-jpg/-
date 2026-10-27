import type { PreparedImage } from "../data/images";
import { pngBlob } from "../images/png";

type View = "front" | "profile" | "three-quarter";
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

// 独自のあたり図。顔の輪郭と上胸部だけを置き、位置線は破線に分ける。
// プレビューと保存用PNGは同じパス・左右反転を使う。
const paths: Record<
  View,
  { outline: readonly string[]; landmarks: readonly string[] }
> = {
  front: {
    outline: [
      "M160 28 C124 28 100 52 101 91 C102 132 115 162 139 183 Q160 198 181 183 C205 162 218 132 219 91 C220 52 196 28 160 28 Z",
      "M102 104 C90 99 89 123 105 131 M218 104 C230 99 231 123 215 131",
      "M135 180 L135 219 C101 229 67 235 55 259 L46 291 M185 180 L185 219 C219 229 253 235 265 259 L274 291",
      "M135 226 Q146 240 160 245 Q174 240 185 226 M160 245 L160 290",
    ],
    landmarks: [
      "M160 35 L160 188 M106 105 Q160 112 214 105",
      "M148 144 L172 144 M145 165 Q160 170 175 165",
    ],
  },
  profile: {
    outline: [
      "M132 169 C115 153 109 128 107 102 C102 73 108 48 129 35 C153 20 189 24 207 47 C220 64 218 86 224 99 L239 114 Q243 118 236 121 L225 124 Q228 135 221 140 L226 147 Q224 163 209 171 Q198 182 185 184",
      "M161 96 C145 90 141 109 147 122 Q153 131 162 124 M157 103 Q149 104 154 117",
      "M132 169 L130 215 C99 225 70 232 56 258 L46 291 M185 184 L182 218 C207 232 230 248 242 291",
      "M133 222 Q167 237 193 248 L203 260 L207 291",
    ],
    landmarks: [
      "M181 99 Q201 94 219 100 M180 142 L222 142",
      "M178 43 Q186 69 185 91",
    ],
  },
  "three-quarter": {
    outline: [
      "M155 29 C121 26 97 49 99 84 C98 127 113 163 140 183 Q163 199 185 181 C210 161 223 133 224 101 C227 64 200 29 155 29 Z",
      "M102 104 C88 99 87 124 105 133 M98 111 Q94 118 101 124",
      "M135 180 L135 219 C102 228 72 239 58 261 L48 291 M184 183 L185 221 C214 230 243 248 257 291",
      "M136 227 Q152 241 170 246 Q181 239 190 228 M170 246 L174 291",
    ],
    landmarks: [
      "M171 35 Q187 76 188 110 M186 144 Q184 165 172 187",
      "M108 104 Q160 90 219 110 M139 101 L137 113 M204 104 L201 115",
      "M188 116 L202 136 L183 141 M164 164 Q179 169 193 162",
    ],
  },
};

export function getGuidePreset(id: GuidePresetId) {
  const preset = GUIDE_PRESETS.find((item) => item.id === id);
  if (!preset)
    throw new Error("このあたりを読み込めません。選び直してください。");
  return preset;
}

export function guidePresetPreview(id: GuidePresetId): string {
  const preset = getGuidePreset(id);
  const drawing = paths[preset.view];
  const transform = preset.mirrored ? "translate(320 0) scale(-1 1)" : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><g transform="${transform}" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#66574b" stroke-width="2">${drawing.outline.map((d) => `<path d="${d}"/>`).join("")}</g><g stroke="#897c70" stroke-width="1.4" stroke-dasharray="5 5">${drawing.landmarks.map((d) => `<path d="${d}"/>`).join("")}</g></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export async function prepareGuidePreset(
  id: GuidePresetId,
): Promise<PreparedImage> {
  const preset = getGuidePreset(id);
  const drawing = paths[preset.view];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 960;
  try {
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("あたりを準備できませんでした。もう一度お試しください。");
    context.scale(3, 3);
    if (preset.mirrored) {
      context.translate(320, 0);
      context.scale(-1, 1);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#66574b";
    context.lineWidth = 2;
    for (const path of drawing.outline) context.stroke(new Path2D(path));
    context.strokeStyle = "#897c70";
    context.lineWidth = 1.4;
    context.setLineDash([5, 5]);
    for (const path of drawing.landmarks) context.stroke(new Path2D(path));
    return { blob: await pngBlob(canvas), width: 960, height: 960 };
  } finally {
    canvas.width = canvas.height = 1;
  }
}
