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
        顔から胸元までの素体です。目や口・体つきは好きに変えられます。左右は、画面上で顔が向く方向です。
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
              style={preset.mirrored ? { transform: "scaleX(-1)" } : undefined}
            />
            <span>{preset.label}を使う</span>
          </button>
        ))}
      </div>
      <p className="note guide-preset-credit">
        素材：{" "}
        <a
          href="https://github.com/animate1978/MB-Lab/blob/063bff04e60f3e7c651fda628c30f5d83f3f3078/license.txt"
          target="_blank"
          rel="noopener noreferrer"
        >
          MB-Lab / Manuel Bastioni
        </a>
        。この下絵は模写・トレースと作品の公開に使えます。
      </p>
    </fieldset>
  );
}
