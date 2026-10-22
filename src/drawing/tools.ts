export interface DrawingTools {
  tool: "pen" | "eraser";
  color: string;
  width: number;
}
export const DEFAULT_TOOLS: DrawingTools = {
  tool: "pen",
  color: "#39352e",
  width: 6,
};
export function isDrawingTools(value: unknown): value is DrawingTools {
  if (!value || typeof value !== "object") return false;
  const tools = value as DrawingTools;
  return (
    (tools.tool === "pen" || tools.tool === "eraser") &&
    /^#[\da-f]{6}$/i.test(tools.color) &&
    Number.isInteger(tools.width) &&
    tools.width >= 1 &&
    tools.width <= 40
  );
}
