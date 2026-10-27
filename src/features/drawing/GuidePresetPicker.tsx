import {
  GUIDE_PRESETS,
  guidePresetPreview,
  type GuidePresetId,
} from "../../drawing/guidePresets";

export function GuidePresetPicker({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (id: GuidePresetId) => void;
}) {
  return (
    <fieldset className="guide-presets" disabled={disabled}>
      <legend>用意したあたり（5種類）</legend>
      <p className="note">
        顔から胸元までの目安です。左右は、画面上で顔が向く方向です。
      </p>
      <div className="guide-preset-grid">
        {GUIDE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChoose(preset.id)}
          >
            <img
              src={guidePresetPreview(preset.id)}
              alt=""
              aria-hidden="true"
              width={320}
              height={320}
            />
            <span>{preset.label}を使う</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
