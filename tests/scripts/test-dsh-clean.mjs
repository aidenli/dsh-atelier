/** 在独立 DSH_HOME 加载发布包，无既有会话、密钥或素材，不接触用户正在运行的 DSH。 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "frontend/package.json"));
const { extract } = require("tar");
const { chromium, expect } = require("@playwright/test");
const dsh = process.env.DSH_SOURCE || resolve(root, "../../deepseek-harness");
await mkdir(resolve(root, ".runtime"), { recursive: true });
const stage = await mkdtemp(resolve(root, ".runtime/dsh-clean-"));
const archive = resolve(
  process.argv[2] || resolve(root, `dist/dsh-atelier-0.3.0-universal.tgz`),
);
await extract({ file: archive, cwd: stage });
const installed = resolve(stage, "package");
const profile = resolve(stage, "home/profiles/web");
await mkdir(resolve(profile, "node_modules"), { recursive: true });
const linkType = process.platform === "win32" ? "junction" : "dir";
await symlink(
  resolve(root, "plugin/node_modules"),
  resolve(installed, "node_modules"),
  linkType,
);
await symlink(
  installed,
  resolve(profile, "node_modules/dsh-atelier"),
  linkType,
);
const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const backendUrl = `http://127.0.0.1:${port}`;
await writeFile(
  resolve(installed, "cordis.patch.yml"),
  JSON.stringify([
    {
      insert: [
        {
          id: "atelier",
          name: "dsh-atelier",
          config: {
            backendUrl,
            dataDir: resolve(stage, "data"),
            mode: "managed",
          },
        },
      ],
    },
  ]),
);
await writeFile(
  resolve(profile, "package.json"),
  JSON.stringify({
    name: "atelier-clean-test",
    private: true,
    type: "module",
    dependencies: { "dsh-atelier": "link:../../../package" },
    dsh: {
      profile: {
        bundles: [
          "@deepseek-ai/dsh-base",
          "@deepseek-ai/dsh-web-app",
          "dsh-atelier",
        ],
        patchReload: "startup",
      },
    },
  }),
);
const host = spawn(
  process.execPath,
  [
    resolve(dsh, "apps/cli/lib/bin.js"),
    "--profile",
    "web",
    "--port",
    "0",
    "--host",
    "127.0.0.1",
    "--no-open",
  ],
  {
    cwd: dsh,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    // 仅测试进程使用平台已有的远程浏览目录模式，避免在用户桌面打开 OS 选择器。
    env: {
      ...process.env,
      DSH_HOME: resolve(stage, "home"),
      SSH_CONNECTION: "atelier-isolated-browser-test",
    },
  },
);
let output = "";
host.stdout.on("data", (chunk) => {
  output += chunk;
});
host.stderr.on("data", (chunk) => {
  output += chunk;
});
let browser;
try {
  let url;
  for (let i = 0; i < 240; i++) {
    url = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0];
    if (url) break;
    if (host.exitCode !== null) break;
    await delay(250);
  }
  // 日志可能有 DSH 访问令牌，只落到忽略的本地测试目录，不输出原文。
  await writeFile(resolve(stage, "host.log"), output);
  assert.ok(url, `干净 DSH 未就绪，检查本地测试日志：${stage}`);
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.goto(url);
  await expect(page.locator(".atelier-entry-sidebar")).toBeVisible({
    timeout: 30000,
  });
  const health = await fetch(`${backendUrl}/getHealth`);
  assert.equal(health.status, 200);
  // 直接验证 DSH 同源注册路由，禁止用统一 Remote POST 冒充 GET 读取。
  const api = await page.evaluate(async () => {
    const config = await fetch("/api/atelier.getConfig");
    const saved = await fetch("/api/atelier.saveConfig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://www.runninghub.cn",
        apiKey: "",
      }),
    });
    return {
      configStatus: config.status,
      config: await config.json(),
      savedStatus: saved.status,
      saved: await saved.json(),
    };
  });
  assert.equal(api.configStatus, 200);
  assert.equal(api.config.hasApiKey, false);
  assert.equal(api.savedStatus, 200);
  assert.equal(api.saved.saved, true);
  const continueButton = page.getByRole("button", {
    name: "继续",
    exact: true,
  });
  await expect(continueButton).toBeVisible({ timeout: 15000 });
  await continueButton.click();
  await page
    .getByRole("button", { name: "稍后配置", exact: true })
    .click({ timeout: 15000 });
  await writeFile(
    resolve(stage, "ui-state.txt"),
    await page.locator("body").innerText(),
  );
  await page.screenshot({ path: resolve(stage, "onboarding.png") });
  await page.getByRole("button", { name: "选择工作区", exact: true }).click();
  await expect(page.getByText("选择工作区目录", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "编辑路径", exact: true }).click();
  await page
    .getByRole("textbox", { name: "编辑路径", exact: true })
    .fill(stage);
  await page
    .getByRole("textbox", { name: "编辑路径", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect(
    page.getByText("选择工作区目录", { exact: true }),
  ).not.toBeVisible({ timeout: 15000 });
  await page.locator(".atelier-entry-sidebar").click();
  const panel = page.locator(".atelier-workspace");
  await expect(panel).toBeVisible();
  const grid = page.locator("[data-atelier-layout]");
  await expect
    .poll(() =>
      grid.evaluate((e) =>
        Number.parseFloat(
          getComputedStyle(e).gridTemplateColumns.split(" ")[1],
        ),
      ),
    )
    .toBeGreaterThanOrEqual(520);
  const columns = await grid.evaluate((e) =>
    getComputedStyle(e).gridTemplateColumns.split(" ").map(Number.parseFloat),
  );
  assert.ok(Math.abs(columns[1] - 520) < 2, "默认聊天宽度应为520px");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "桌面出现横向溢出",
  );
  const handle = grid.locator(".atelier-resize");
  const box = await handle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.ok(
      await grid.evaluate(
        (e) =>
          Number.parseFloat(
            getComputedStyle(e).gridTemplateColumns.split(" ")[1],
          ) >= 520,
      ),
    );
  }
  await expect(panel).toBeVisible({ timeout: 15000 });
  await panel.getByRole("tab", { name: "素材", exact: true }).click();
  await panel.locator("input[type=file]").setInputFiles({
    name: "node-migration.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    panel.getByRole("button", {
      name: "放大预览 node-migration.png",
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await panel.getByRole("button", { name: "使用", exact: true }).click();
  await panel
    .getByRole("button", { name: "放大预览 node-migration.png", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await panel
    .getByRole("button", { name: "删除 node-migration.png", exact: true })
    .click();
  await panel
    .getByRole("dialog")
    .getByRole("button", { name: /^删\s*除$/ })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "放大预览 node-migration.png",
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(panel.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: resolve(stage, "atelier-desktop.png") });
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(panel).not.toBeVisible();
  await page.screenshot({ path: resolve(stage, "atelier-narrow.png") });
  await page.screenshot({ path: resolve(stage, "workspace-choice.png") });
  await writeFile(
    resolve(stage, "ui-state.txt"),
    await page.locator("body").innerText(),
  );
  await page.screenshot({ path: resolve(stage, "clean-dsh.png") });
  console.log("干净 DSH_HOME 的发布包加载、侧栏入口和后端就绪验收通过。");
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await writeFile(
        resolve(stage, "ui-failure.txt"),
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: resolve(stage, "ui-failure.png") });
    }
  }
  throw error;
} finally {
  await browser?.close();
  if (host.exitCode === null && host.signalCode === null) {
    const exited = once(host, "exit");
    host.kill();
    await exited;
  }
  // Windows Host 强制退出后，等待 Node 后端父管道清理完成。
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${backendUrl}/getHealth`, {
        signal: AbortSignal.timeout(300),
      });
    } catch {
      stopped = true;
      break;
    }
    await delay(200);
  }
  assert.ok(stopped, "干净 DSH 退出后测试后端仍在运行");
}
