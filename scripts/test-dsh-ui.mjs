/** 在已运行的本机 DSH 验证主题订阅和窄屏入口；只操作界面，不调用生成工具。 */
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
// 令牌仅从本机启动日志读取，不打印到报告或命令行参数。
const url =
  process.env.DSH_TEST_URL ||
  (await readFile(resolve(root, ".runtime/ui-check.log"), "utf8")).match(
    /http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/,
  )?.[0];
if (!url) throw new Error("请先启动 DSH，并通过 DSH_TEST_URL 提供本机访问地址");
const out = resolve(root, ".runtime/frontend-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let original;
async function settings() {
  await page.getByRole("button", { name: "设置", exact: true }).click();
}
async function closeSettings() {
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
}
try {
  await page.goto(url);
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Atelier素材验收检查" })
    .click();
  await page
    .getByRole("button", { name: "Atelier 媒体工作台", exact: true })
    .first()
    .click();
  const panel = page.getByRole("region", { name: "Atelier 媒体工作台" });
  await expect(panel).toBeVisible();
  // 默认聊天固定保留 700px，超宽窗口也将剩余空间全部交给右侧。
  for (const width of [1600, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.locator('[data-atelier-layout="true"]').evaluate((frame) => {
          const tracks = getComputedStyle(frame)
            .gridTemplateColumns.split(" ")
            .map(parseFloat);
          return (
            tracks[1] === 700 &&
            Math.abs(tracks[2] - (frame.clientWidth - tracks[0] - 700)) < 1
          );
        }),
      )
      .toBe(true);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect
    .poll(() =>
      page
        .locator('[data-atelier-layout="true"]')
        .evaluate((frame) => getComputedStyle(frame).gridTemplateColumns),
    )
    .toBe("280px 700px 620px");
  await page.waitForTimeout(350);
  const dx = await page
    .locator('[data-atelier-layout="true"]')
    .evaluate((frame) =>
      parseFloat(frame.style.gridTemplateColumns.split(" ").at(-1)) > 450
        ? 30
        : -30,
    );
  const divider = await page
    .locator('[data-atelier-layout="true"] > [data-side="details"]')
    .boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 200);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2 + dx, divider.y + 200, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .locator('[data-atelier-layout="true"]')
        .evaluate((frame) =>
          parseFloat(getComputedStyle(frame).gridTemplateColumns.split(" ")[1]),
        ),
    )
    .toBe(700 + dx);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 200, {
    steps: 5,
  });
  await page.mouse.up();
  await panel.getByRole("button", { name: "返回原生详情" }).click();
  await page
    .getByRole("button", { name: "Atelier 媒体工作台", exact: true })
    .first()
    .click();
  // 用现有素材和已完成结果验收预览，不创建或修改任务。
  await panel.getByRole("tab", { name: "素材", exact: true }).click();
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  const cardSize = await panel
    .locator(".atelier-asset-item")
    .first()
    .boundingBox();
  if (cardSize.width !== 250 || cardSize.height !== 250)
    throw new Error("卡片不是 250×250");
  await expect(
    panel.getByRole("button", { name: "使用", exact: true }).first(),
  ).toBeVisible();
  await page.waitForTimeout(350);
  const fits = await panel
    .locator(".atelier-asset-item")
    .evaluateAll((cards) =>
      cards.every((card) =>
        Array.from(card.children).every(
          (child) => child.getBoundingClientRect().width <= 250,
        ),
      ),
    );
  if (!fits) throw new Error("素材卡片内容溢出固定宽度");
  await page.screenshot({ path: resolve(out, "dsh-asset-cards.png") });
  await panel
    .getByRole("button", { name: /^放大预览 .*\.mp4$/ })
    .first()
    .click();
  const mediaDialog = page.getByRole("dialog");
  await expect
    .poll(() =>
      mediaDialog.locator("video").evaluate((video) => video.readyState),
    )
    .toBeGreaterThan(0);
  await expect(panel.locator(".atelier-asset-kind").first()).toHaveText("视频");
  await expect(mediaDialog.locator("video")).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(out, "dsh-video-preview.png") });
  await page.keyboard.press("Escape");
  await expect(mediaDialog).toHaveCount(0);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await panel.getByRole("tab", { name: "任务", exact: true }).click();
  await panel.locator(".atelier-task-row").first().click();
  for (const title of ["生成结果视频", "动作参考视频"]) {
    await panel
      .getByRole("button", { name: `放大预览 ${title}`, exact: true })
      .first()
      .click();
    await expect
      .poll(() =>
        mediaDialog.locator("video").evaluate((video) => video.readyState),
      )
      .toBeGreaterThan(0);
    await expect(mediaDialog.locator("video")).not.toHaveAttribute(
      "controlsList",
      "nofullscreen",
    );
    await page.keyboard.press("Escape");
    await expect(mediaDialog).toHaveCount(0);
  }
  const taskTitle = await panel.getByRole("heading", { level: 2 }).innerText();
  await page
    .getByRole("treeitem")
    .filter({ hasText: "插件验收与资源列表" })
    .click();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(taskTitle);
  await panel
    .getByRole("button", { name: "打开来源会话", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem").filter({ hasText: "Atelier素材验收检查" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(taskTitle);
  await panel.getByRole("button", { name: "任务列表", exact: true }).click();
  const taskNames = await panel
    .locator(".atelier-task-row strong")
    .allTextContents();
  await page
    .getByRole("treeitem")
    .filter({ hasText: "插件验收与资源列表" })
    .click();
  await expect(panel.locator(".atelier-task-row strong")).toHaveText(taskNames);
  await expect(panel.getByRole("combobox", { name: "会话范围" })).toHaveCount(
    0,
  );
  await settings();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  original = await dialog
    .locator('button[aria-pressed="true"]')
    .filter({ hasText: /浅色|深色|跟随系统/ })
    .innerText();
  await dialog.getByRole("button", { name: "跟随系统", exact: true }).click();
  await closeSettings();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => panel.evaluate((e) => getComputedStyle(e).backgroundColor))
    .toBe("rgb(21, 21, 23)");
  // DSH CSS 变量先更新，Ant Design 的颜色过渡随后结束，截图等待过渡完成。
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(out, "dsh-system-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() => panel.evaluate((e) => getComputedStyle(e).backgroundColor))
    .toBe("rgb(255, 255, 255)");
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(out, "dsh-system-light.png") });
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(panel).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "Atelier 媒体工作台", exact: true })
      .first(),
  ).toBeDisabled();
  await page.screenshot({ path: resolve(out, "dsh-narrow.png") });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByRole("button", { name: "Atelier 媒体工作台", exact: true })
    .first()
    .click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "返回原生详情" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-atelier-layout="true"]')).toHaveCount(0);
  console.log(
    "真实 DSH 验收通过：跟随系统明暗变化、窄屏收起与入口禁用、重新打开和原生布局恢复。",
  );
} finally {
  if (original) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    if (
      !(await page.getByRole("dialog", { name: "设置", exact: true }).count())
    )
      await settings();
    await page
      .getByRole("dialog", { name: "设置", exact: true })
      .getByRole("button", { name: original, exact: true })
      .click();
    await closeSettings();
  }
  await browser.close();
}
