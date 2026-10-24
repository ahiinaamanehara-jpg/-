import { saveDrawing } from "../data/drawings";
import type { ArtworkDraft, GuideAsset } from "../data/database";
import type { TracingUpdate } from "./tracing";
import { captureDrawing, DrawingSurface } from "./surface";
import type { DrawingTools } from "./tools";

export interface SaveState {
  status: "saved" | "pending" | "saving" | "error" | "scratch";
  error: string;
  dirty: boolean;
}
export function drawingError(error: unknown) {
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return "保存領域が不足しています。絵はこの画面に残っています。PNGを書き出すか、保存を再試行してください。";
  if (error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message))
    return error.message;
  return "保存できませんでした。絵はこの画面に残っています。PNGを書き出すか、もう一度保存してください。";
}
/** この画面の保存を直列化。保存中の追加入力は次の画像として保存する。 */
export class DrawingSession {
  private version = 0;
  private savedVersion = 0;
  private debounce?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private running?: Promise<boolean>;
  private disposed = false;
  private state: SaveState["status"];
  strokeActive = false;
  tracing: TracingUpdate;
  constructor(
    readonly surface: DrawingSurface,
    public draft: ArtworkDraft | undefined,
    public tools: DrawingTools,
    private notify: (state: SaveState) => void,
    guide?: GuideAsset,
  ) {
    this.state = draft ? "saved" : "scratch";
    this.tracing = {
      settings: draft?.tracing ? { ...draft.tracing } : undefined,
      asset: guide,
    };
  }
  get dirty() {
    return this.version !== this.savedVersion || this.strokeActive;
  }
  private emit(error = "") {
    if (!this.disposed)
      this.notify({ status: this.state, error, dirty: this.dirty });
  }
  changed() {
    this.version++;
    this.state = this.draft ? "pending" : "scratch";
    this.emit();
    this.schedule();
  }
  setTools(tools: DrawingTools) {
    this.tools = { ...tools };
    this.changed();
  }
  setTracing(update: TracingUpdate) {
    this.tracing = {
      settings: update.settings ? { ...update.settings } : undefined,
      asset: update.asset,
    };
    this.changed();
  }
  started() {
    this.strokeActive = true;
    this.state = this.draft ? "pending" : "scratch";
    this.emit();
  }
  ended() {
    this.strokeActive = false;
    this.changed();
  }
  private schedule() {
    if (!this.draft || this.disposed) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.flush();
    }, 1000);
    if (!this.deadline)
      this.deadline = setTimeout(() => {
        this.deadline = undefined;
        void this.flush();
      }, 5000);
  }
  private clearTimers() {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.deadline) clearTimeout(this.deadline);
    this.debounce = this.deadline = undefined;
  }
  flush(force = false): Promise<boolean> {
    this.clearTimers();
    if (!this.draft) return Promise.resolve(!this.dirty);
    if (this.strokeActive) return Promise.resolve(false);
    if (force && !this.dirty && !this.draft.canvasAssetId) this.version++;
    if (this.running) return this.running;
    if (!this.dirty) return Promise.resolve(true);
    const operation = async () => {
      while (this.dirty && !this.strokeActive && !this.disposed) {
        const version = this.version;
        const tools = { ...this.tools };
        const tracing = {
          ...this.tracing,
          settings: this.tracing.settings
            ? { ...this.tracing.settings }
            : undefined,
        };
        this.state = "saving";
        this.emit();
        try {
          const bundle = await captureDrawing(this.surface.canvas);
          if (this.disposed) return false;
          this.draft = await saveDrawing(
            this.draft!.id,
            this.draft!.revision,
            bundle,
            tools,
            tracing,
          );
          this.savedVersion = version;
          this.state = this.dirty ? "pending" : "saved";
          this.emit();
        } catch (error) {
          this.state = "error";
          this.emit(drawingError(error));
          return false;
        }
      }
      return !this.dirty;
    };
    this.running = operation().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.surface.dispose();
  }
}
