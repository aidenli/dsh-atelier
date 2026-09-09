/** DSH Client 只负责原生插槽注册与数据适配；React 页面不导入 Host 代码。 */
import { createElement, useState, useSyncExternalStore } from "react";
import { AtelierIcon as Film } from "../../frontend/src/components/common";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { Atelier } from "../../frontend/src/Atelier";
import { createWorkspaceStore } from "../../frontend/src/hooks/workspaceStore";
import { ServiceSettings } from "../../frontend/src/pages/ServiceSettings";
import { AtelierTheme } from "../../frontend/src/components/AtelierTheme";
import type {} from "@deepseek-ai/dsh-client-ui-theme/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import { readJSON } from "../../contracts/http";
import type { Asset, Bridge, ConnectionSettings } from "../../contracts/types";
import remote from "../lib/typert.remote-client.js";

export const inject = [
  "slots",
  "layout",
  "sessions",
  "conversation",
  "inputTriggers",
  "remote",
  "theme",
  "uiWorkspace",
  "workspaces",
];

/** apply 显式挂载生成的 Remote 契约，只有点击入口才临时占用原生详情列。 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(remote);
  ctx.inject(["remote.atelier"], (ready) => mount(ready));
}

/** Remote namespace 已发布后，在依赖它的子生命周期中注册页面与操作。 */
function mount(ctx: Context): void {
  const themeSource = {
    getSnapshot: () => ctx.theme.getTheme(),
    subscribe: (listener: () => void) => ctx.on("theme/change", listener),
  };
  let disposeDetails: (() => unknown) | undefined;
  const close = () => {
    if (disposeDetails) ctx.layout.closeRightbar();
    disposeDetails?.();
    disposeDetails = undefined;
  };
  ctx.effect(() => close, "atelier: 恢复原生详情");
  // 源码版 DSH 在极窄视口仍会挤压详情列；插件主动收起自己的列，不能挤占聊天。
  const narrow = window.matchMedia("(max-width: 960px)");
  ctx.effect(() => {
    const resize = () => {
      if (narrow.matches && disposeDetails) {
        close();
        ctx.layout.closeRightbar();
      }
    };
    narrow.addEventListener("change", resize);
    return () => narrow.removeEventListener("change", resize);
  }, "atelier: 窄屏收起详情列");
  // 自有引用源让素材身份稳定序列化；选择只调用 insertReference，绝不调用 submit。
  ctx.effect(
    () =>
      ctx.inputTriggers.registerSource({
        trigger: "@",
        name: "atelier-asset",
        candidates: async () => [],
        onPick: () => undefined,
        codec: {
          clipboardText: (ref) => ref,
          serialize: (ref) => Promise.resolve(ref),
        },
      }),
    "atelier: 素材引用序列化",
  );

  const bridge: Bridge = {
    workspace: createWorkspaceStore(),
    async openSession(sessionId) {
      await ctx.sessions.refresh();
      try {
        ctx.sessions.open(sessionId as Parameters<typeof ctx.sessions.open>[0]);
      } catch {
        throw new Error("来源会话不可用，可能已删除或不在当前工作区列表中");
      }
    },
    async get<T>(path: string): Promise<T> {
      return (await readJSON(
        await fetch(`/api/atelier.${path.slice(1)}`),
      )) as T;
    },
    async post<T>(path: string, body?: unknown): Promise<T> {
      return (await readJSON(
        await fetch(`/api/atelier.${path.slice(1)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }),
      )) as T;
    },
    fileUrl(id, download = false) {
      return `/api/atelier.getAssetFile?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;
    },
    async upload(sessionId, file) {
      const body = new FormData();
      body.set("sessionId", sessionId);
      body.set("file", file);
      const response = await fetch("/api/atelier.uploadAsset", {
        method: "POST",
        body,
      });
      return (await readJSON(response)) as Asset;
    },
    async select(sessionId, assets) {
      const scope = ctx.sessions.scope(
        sessionId as Parameters<typeof ctx.sessions.scope>[0],
      );
      if (!scope) throw new Error("会话已关闭，请切换到有效会话后选择素材");
      const input = ctx.conversation.input.for(scope);
      for (const asset of assets) {
        const state = input.state.getSnapshot();
        if (state.phase !== "plain")
          throw new Error("输入框正在提交，请稍后选择素材");
        // detect 坐标中原生引用占一个占位符，不能直接使用展开后的草稿文本长度。
        const end =
          state.draft.length -
          state.occurrences.reduce(
            (n, occurrence) => n + occurrence.length - 1,
            0,
          );
        const text = `[Atelier 素材 ${asset.id} | ${asset.name}]`;
        if (
          !input.insertReference(
            {
              source: "atelier-asset",
              ref: text,
              label: asset.name,
              appearance: "file",
              clipboardText: text,
            },
            { start: end, end, draftRev: state.draftRev },
          )
        )
          throw new Error("草稿已变化，请重新选定素材");
      }
    },
    connection(settings?: ConnectionSettings) {
      return settings
        ? bridge.post("/saveConnection", settings)
        : bridge.get("/getConnection");
    },
  };

  function open() {
    if (narrow.matches) return;
    if (!disposeDetails)
      disposeDetails = ctx.slots.register(
        { name: "rightbar", priority: -100 },
        ({ sessionId }: PropsRuntime<"rightbar">) =>
          createElement(AtelierTheme, {
            source: themeSource,
            children: createElement(Atelier, {
              key: sessionId,
              sessionId,
              bridge,
              close,
            }),
          }),
      );
    ctx.layout.openRightbar(true, false);
  }
  /** DSH 插件配置入口与右侧设置共用同一表单，不复制配置状态。 */
  function PluginSettings() {
    const [error, setError] = useState("");
    return createElement(
      "section",
      { className: "atelier", style: { padding: 20 } },
      error &&
        createElement(
          "div",
          { role: "alert", className: "atelier-error" },
          error,
        ),
      createElement(AtelierTheme, {
        source: themeSource,
        children: createElement(ServiceSettings, { bridge, onError: setError }),
      }),
    );
  }
  ctx.slots.inject("settings.plugins.tab", () =>
    ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: "atelier",
        order: 30,
        label: () => "Atelier",
      },
      PluginSettings,
    ),
  );
  ctx.slots.inject("conversation.session.header.actions", () =>
    ctx.slots.register(
      { name: "conversation.session.header.actions", id: "atelier", order: 30 },
      () => createElement(Entry, {}),
    ),
  );

  let opening: Promise<void> | undefined;
  /** 原生目录选择取消不创建会话；多个入口点击合并为一次异步导航。 */
  async function ensureOpen() {
    if (opening) return opening;
    opening = (async () => {
      if (!ctx.sessions.list.getSnapshot().current) {
        const workspace = ctx.workspaces.list.getSnapshot().items[0];
        if (workspace)
          ctx.sessions.open(
            await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId),
          );
        else {
          const cwd = await ctx.uiWorkspace.pickDirectory();
          if (!cwd) return;
          ctx.sessions.open(await ctx.sessions.create({ cwd }));
        }
      }
      open();
    })();
    try {
      await opening;
    } finally {
      opening = undefined;
    }
  }
  function Entry({
    wide = false,
    sidebar = false,
  }: {
    wide?: boolean;
    sidebar?: boolean;
  }) {
    const [busy, setBusy] = useState(false),
      [error, setError] = useState("");
    const narrowScreen = useSyncExternalStore(
      (listener) => {
        narrow.addEventListener("change", listener);
        return () => narrow.removeEventListener("change", listener);
      },
      () => narrow.matches,
    );
    return createElement(
      "button",
      {
        className: `atelier-entry${sidebar ? " atelier-entry-sidebar" : ""}${sidebar && !wide ? " atelier-entry-rail" : ""}`,
        title:
          error ||
          (narrowScreen
            ? "窗口过窄，请加宽窗口后打开 Atelier"
            : "Atelier 媒体工作台"),
        "aria-label": "Atelier 媒体工作台",
        disabled: busy || narrowScreen,
        onClick: () => {
          setBusy(true);
          setError("");
          void ensureOpen()
            .catch((e) =>
              setError(e instanceof Error ? e.message : "工作台打开失败"),
            )
            .finally(() => setBusy(false));
        },
      },
      createElement(Film, { size: 17 }),
      (!sidebar || wide) && "Atelier",
    );
  }
}
