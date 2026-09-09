/** 真浏览器回归：模拟网络边界，验证交互状态与渲染，不调用 RunningHub。 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
const out = resolve(root, ".runtime/frontend-test");
await mkdir(out, { recursive: true });
await require("esbuild").build({
  entryPoints: [resolve(root, "frontend/tests/fixture.tsx")],
  bundle: true,
  outfile: resolve(out, "app.js"),
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const server = createServer(async (req, res) => {
  if (req.url === "/app.js" || req.url === "/app.css") {
    res.setHeader(
      "Content-Type",
      req.url.endsWith("js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(resolve(out, req.url.slice(1))));
  } else
    res.end(
      '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  page.on("pageerror", (error) => console.error(error));
  let legacy = false,
    failDelete = true,
    deleteCalls = 0;
  let holdTasks = false,
    releaseLate;
  let assets = [{ id: "a", name: "测试素材.png", kind: "image", size: 100 }];
  let hasApiKey = true;
  let version = {
    current: "0.3.1",
    latest: "0.3.2",
    hasUpdate: true,
    source: true,
    error: undefined,
  };
  await page.route("**/mock/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/mock/getConfig")
      return route.fulfill({ json: { hasApiKey } });
    if (url.pathname === "/mock/getVersion")
      return route.fulfill({
        json: version,
      });
    assert.equal(
      url.searchParams.has("sessionId"),
      false,
      "工作台查询不按会话过滤",
    );
    if (
      route.request().method() === "POST" &&
      url.pathname === "/mock/deleteAssets"
    ) {
      deleteCalls++;
      if (failDelete)
        return route.fulfill({ status: 404, body: "404 page not found" });
      assets = [];
      return route.fulfill({ json: { deleted: true } });
    }
    const task = {
      id: "t",
      title: holdTasks ? "stale" : "all",
      sessionId: "origin",
      outputIds: ["result-image", "result-video", "result-audio"],
      platform: "runninghub",
      outputs: ["image", "video", "audio"].map((kind) => ({
        id: `result-${kind}`,
        kind,
        name: `生成${kind}`,
      })),
      videoId: "v",
      workflow: { name: "Wan", revision: 1 },
      createdAt: "2026-09-08T00:00:00Z",
      state: "remote_pending",
      parameters: { width: 480, height: 848, frames: 81 },
      imageId: "a",
    };
    const payload =
      url.pathname === "/mock/listProjects"
        ? {
            items: [
              {
                id: "p",
                type: "motion-transfer",
                title: "项目一",
                taskIds: ["t"],
                createdAt: task.createdAt,
                state: task.state,
                completed: 0,
                totalTasks: 1,
                imageId: "a",
              },
            ],
            page: 1,
            total: 1,
          }
        : url.pathname === "/mock/getProject"
          ? {
              project: {
                id: "p",
                title: "项目一",
                type: "motion-transfer",
                taskIds: ["t"],
                createdAt: task.createdAt,
              },
              tasks: [task],
            }
          : url.pathname === "/mock/getHealth"
            ? legacy
              ? {}
              : { capabilities: ["asset-delete"] }
            : url.pathname === "/mock/listAssets"
              ? assets
              : url.pathname === "/mock/listTasks"
                ? {
                    items: [task],
                    total: 1,
                    page: 1,
                    summary: { remote_pending: 1 },
                  }
                : url.pathname === "/mock/getTask"
                  ? { task }
                  : [];
    if (holdTasks && url.pathname === "/mock/listTasks") {
      holdTasks = false;
      await new Promise((resolve) => {
        releaseLate = resolve;
      });
    }
    await route.fulfill({ json: payload });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole("heading", { name: "动作迁移" })).toBeVisible();
  await expect(page.getByText("v0.3.1", { exact: true })).toBeVisible();
  await expect(
    page.locator(".atelier-version .atelier-ant-badge-dot"),
  ).toBeVisible();
  await page.locator(".atelier-version button").click();
  await expect(
    page.getByText("当前通过源码加载。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toHaveClass(
    /zoom-enter|zoom-appear/,
  );
  await page.screenshot({
    path: resolve(out, "version-update.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("tab", { name: "工作台", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /项目一/ }).click();
  await expect(page.getByRole("heading", { name: "项目一" })).toBeVisible();
  await page.screenshot({ path: resolve(out, "motion-project.png") });
  await expect(page.locator(".atelier-running")).toHaveCount(1);
  assert.notEqual(
    await page
      .locator(".atelier-running")
      .evaluate((e) => getComputedStyle(e, "::before").animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".atelier-running")
      .evaluate((e) => getComputedStyle(e, "::before").animationName),
    "none",
  );
  await page.getByRole("tab", { name: "素材", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  const card = await page.locator(".atelier-asset-item").boundingBox();
  assert.equal(card.width, 250);
  assert.equal(card.height, 250);
  await expect(page.locator(".atelier-asset-kind")).toHaveText("图片");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "放大预览 测试素材.png", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("img", { name: "测试素材.png", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "聊天草稿" })).toHaveValue(
    "保留已有要求",
  );
  await page.screenshot({ path: resolve(out, "media-preview.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "使用", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "聊天草稿" })).toHaveValue(
    "保留已有要求 [素材 a]",
  );
  await page
    .getByRole("button", { name: "删除 测试素材.png", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: /取\s*消/ })).toBeFocused();
  const modalPrimary = modal.getByRole("button", {
    name: /删\s*除/,
    exact: true,
  });
  const light = await modalPrimary.evaluate(
    (e) => getComputedStyle(e).backgroundColor,
  );
  await page.getByRole("button", { name: "模拟主题切换" }).click();
  await expect(page.locator(".atelier-asset-item")).toHaveCount(1);
  await expect
    .poll(() =>
      modalPrimary.evaluate((e) => getComputedStyle(e).backgroundColor),
    )
    .not.toBe(light);
  const panelBounds = await page.locator(".atelier-workspace").boundingBox();
  const maskBounds = await page
    .locator(".atelier-ant-modal-mask")
    .boundingBox();
  assert.deepEqual(maskBounds, panelBounds, "遮罩只覆盖插件面板");
  await modal.getByRole("button", { name: /删\s*除/, exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("HTTP 404");
  await expect(page.locator(".atelier-asset-item")).toHaveCount(1);
  failDelete = false;
  await modal.getByRole("button", { name: /删\s*除/, exact: true }).click();
  await expect(modal).toHaveCount(0);
  assert.equal(deleteCalls, 2);
  await page.getByRole("tab", { name: "任务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务管理" })).toBeVisible();
  await page.screenshot({ path: resolve(out, "desktop-dark.png") });
  await page.setViewportSize({ width: 420, height: 950 });
  await page.screenshot({ path: resolve(out, "narrow-dark.png") });
  assert.ok(
    await page
      .locator(".atelier-workspace")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    "窄列不能横向溢出",
  );
  legacy = true;
  holdTasks = true;
  await page.getByRole("button", { name: "刷新任务" }).click();
  await expect.poll(() => typeof releaseLate).toBe("function");
  await page.getByRole("button", { name: "模拟会话切换" }).click();
  await expect(page.locator(".atelier-task-row strong")).toHaveText("all");
  const lateResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/mock/listTasks",
  );
  releaseLate();
  await (await lateResponse).finished();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.locator(".atelier-task-row strong")).toHaveText("all");
  await expect(page.getByRole("combobox", { name: "会话范围" })).toHaveCount(0);
  await page.locator(".atelier-task-row").click();
  await expect(
    page.getByRole("textbox", { name: "nodeInfoList JSON" }),
  ).toBeVisible();
  const nodes = JSON.parse(
    await page.getByRole("textbox", { name: "nodeInfoList JSON" }).inputValue(),
  );
  assert.equal(nodes.length, 6);
  await expect(page.locator(".atelier-output img")).toHaveCount(1);
  await expect(page.locator(".atelier-output video")).toHaveCount(1);
  await expect(page.locator(".atelier-output audio")).toHaveCount(1);
  await page.screenshot({ path: resolve(out, "runninghub-task.png") });
  await page.getByRole("button", { name: "模拟会话切换" }).click();
  await expect(
    page.getByRole("button", { name: "打开来源会话" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开来源会话" }).click();
  await expect(page.getByRole("status", { name: "当前测试会话" })).toHaveText(
    "origin",
  );
  await expect(
    page.getByRole("button", { name: "打开来源会话" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "素材", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("当前后端不支持素材删除");
  assets = [{ id: "audio", name: "预留音频.mp3", kind: "audio", size: 100 }];
  await page.getByRole("tab", { name: "任务", exact: true }).click();
  await page.getByRole("button", { name: "刷新任务" }).click();
  await page.getByRole("tab", { name: "素材", exact: true }).click();
  await page
    .locator(".atelier-ant-segmented-item-label")
    .filter({ hasText: "音频" })
    .click();
  await expect(page.locator(".atelier-asset-kind")).toHaveText("音频");
  await expect(
    page.getByRole("button", { name: "删除 预留音频.mp3", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "放大预览 预留音频.mp3", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator("audio")).toHaveCount(1);
  version = { ...version, source: false };
  await page.reload();
  await page.locator(".atelier-version button").click();
  await expect(
    page.getByText("pnpm dsh plugin --profile web add dsh-atelier@latest", {
      exact: true,
    }),
  ).toBeVisible();
  for (const error of [undefined, "暂时无法检查更新"]) {
    version = { ...version, latest: "0.3.1", hasUpdate: false, error };
    await page.reload();
    await expect(page.getByText("v0.3.1", { exact: true })).toBeVisible();
    await expect(page.locator(".atelier-version button")).toHaveCount(0);
    await expect(
      page.locator(".atelier-version .atelier-ant-badge-dot"),
    ).toHaveCount(0);
  }
  hasApiKey = false;
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "设置", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "服务设置" })).toBeVisible();
  await page.getByRole("tab", { name: "素材", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "素材", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  console.log(
    "前端浏览器回归通过：波浪、减少动态、主题、面板浮层、删除失败恢复、导航、窄列和旧后端。",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
