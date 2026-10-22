import { test as base } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// WebKitの隔離コンテキストはBlobのIDB保存を拒否するため、
// 通常利用の共通受け入れはテストごとの永続プロファイルで実行する。
// 隔離コンテキストの失敗回復はcompatibility-storage.spec.tsで別に確認する。
export const test = base.extend({
  context: async (
    { context, browserName, playwright },
    provideContext,
    info,
  ) => {
    if (browserName !== "webkit") {
      await provideContext(context);
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "workshop-webkit-"));
    let persistent;
    try {
      persistent = await playwright.webkit.launchPersistentContext(directory, {
        ...info.project.use.launchOptions,
        ...info.project.use.contextOptions,
        baseURL: info.project.use.baseURL,
        viewport: info.project.use.viewport,
        deviceScaleFactor: info.project.use.deviceScaleFactor,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        userAgent: info.project.use.userAgent,
        acceptDownloads: true,
      });
      await provideContext(persistent);
    } finally {
      await persistent?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});
