import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts?(x)"],
    setupFiles: ["./tests/setup.ts"],
  },
});
