import { MAX_LAYERS, type LayerView } from "../../drawing/layers";

export function LayerControls({
  layers,
  disabled,
  onAdd,
  onSelect,
  onVisible,
  onMove,
  onRemove,
}: {
  layers: LayerView;
  disabled: boolean;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onVisible: (id: string, visible: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="layer-controls">
      <p>
        レイヤーは、重ねられる透明な紙のようなものです。線と色などを分けたいときに使えます。普段は1枚のままで描けます。上の行ほど手前に重なり、消しゴムは選んだ1枚だけに使えます。
      </p>
      <p>下絵は別の目印なので、レイヤーの枚数には含みません。</p>
      <fieldset disabled={disabled}>
        <legend className="sr-only">レイヤーの操作</legend>
        <button
          type="button"
          disabled={layers.items.length >= MAX_LAYERS}
          onClick={onAdd}
        >
          レイヤーを追加
        </button>
        <p className="note">
          {layers.items.length}／{MAX_LAYERS}枚
          {layers.items.length >= MAX_LAYERS
            ? "（追加できるのは5枚までです）"
            : ""}
        </p>
        <ol className="layer-list" aria-label="上から順のレイヤー">
          {[...layers.items].reverse().map((layer, row) => (
            <li
              key={layer.id}
              className={layer.id === layers.activeId ? "selected" : ""}
            >
              <button
                type="button"
                className="layer-select"
                aria-label={`${layer.name}に描く`}
                aria-pressed={layer.id === layers.activeId}
                onClick={() => onSelect(layer.id)}
              >
                {layer.name}
                {layer.id === layers.activeId ? "（選択中）" : ""}
              </button>
              <div className="layer-actions">
                <button
                  type="button"
                  aria-label={`${layer.name}を${layer.visible ? "隠す" : "表示する"}`}
                  onClick={() => onVisible(layer.id, !layer.visible)}
                >
                  {layer.visible ? "隠す" : "表示する"}
                </button>
                <button
                  type="button"
                  aria-label={`${layer.name}を上へ`}
                  disabled={row === 0}
                  onClick={() => onMove(layer.id, 1)}
                >
                  上へ
                </button>
                <button
                  type="button"
                  aria-label={`${layer.name}を下へ`}
                  disabled={row === layers.items.length - 1}
                  onClick={() => onMove(layer.id, -1)}
                >
                  下へ
                </button>
                <button
                  type="button"
                  aria-label={`${layer.name}を削除`}
                  disabled={layers.items.length <= 1}
                  onClick={() => {
                    if (
                      window.confirm(
                        `${layer.name}を削除しますか？このレイヤーに描いた内容が消えます。ほかのレイヤーは残ります。`,
                      )
                    )
                      onRemove(layer.id);
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ol>
      </fieldset>
      <p className="note">
        追加・削除・表示切替・順序の変更も「取り消し」で戻せます。PNGは表示中のレイヤーを重ねた画像になり、分けた状態は保存・バックアップZIPに残ります。
      </p>
    </div>
  );
}
