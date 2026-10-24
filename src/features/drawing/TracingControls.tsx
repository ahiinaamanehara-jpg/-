import type { ChangeEvent } from "react";
import type { GuideAsset } from "../../data/database";
import type { TracingSettings } from "../../drawing/tracing";

export function TracingControls({
  settings,
  guide,
  hasReference,
  disabled,
  warning,
  onFile,
  onReference,
  onSettings,
  onRemove,
}: {
  settings?: TracingSettings;
  guide?: GuideAsset;
  hasReference: boolean;
  disabled: boolean;
  warning: string;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onReference: () => void;
  onSettings: (settings: TracingSettings) => void;
  onRemove: () => void;
}) {
  return (
    <div className="tracing-controls">
      {settings && (
        <div className="tracing-indicator">
          <p>
            {settings.visible && guide
              ? "下絵を表示中"
              : "自分の線だけを表示中"}
          </p>
          <button
            type="button"
            disabled={disabled || !guide}
            onClick={() =>
              onSettings({ ...settings, visible: !settings.visible })
            }
          >
            {settings.visible ? "下絵を隠す" : "下絵を表示する"}
          </button>
        </div>
      )}
      <details>
        <summary
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          下絵をなぞって描く（任意）
        </summary>
        <p>
          薄い画像を目印に、自分の手で線を描けます。顔や好きな部分だけでも大丈夫です。
        </p>
        <fieldset disabled={disabled}>
          <legend className="sr-only">なぞり描きの設定</legend>
          {hasReference && (
            <button type="button" onClick={onReference}>
              推しの参考画像を下絵にする
            </button>
          )}
          <label className="tracing-file">
            下絵の画像を選ぶ
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFile}
            />
          </label>
          <p className="note">
            自分の画像や利用できる画像を選びます。PNG・JPEG・WebP、10MiB・1,600万画素まで。画像は端末内に保存します。
          </p>
          {settings && (
            <>
              <label className="tracing-opacity">
                下絵の濃さ：{settings.opacity}%
                <input
                  aria-label="下絵の濃さ"
                  type="range"
                  min={10}
                  max={70}
                  value={settings.opacity}
                  disabled={!guide}
                  onChange={(event) =>
                    onSettings({
                      ...settings,
                      opacity: Number(event.target.value),
                    })
                  }
                />
              </label>
              <button type="button" onClick={onRemove}>
                下絵を外す
              </button>
            </>
          )}
        </fieldset>
        <p className="note">
          下絵は描いた線と別に扱います。作品のPNG・サムネイルには含めず、全データのバックアップZIPには含めます。
        </p>
      </details>
      {warning && (
        <p role="alert" className="error">
          {warning}
        </p>
      )}
    </div>
  );
}
