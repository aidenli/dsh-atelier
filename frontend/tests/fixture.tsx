/** 独立浏览器验收壳：只模拟 DSH 的桥接与主题，不接触真实后端及账户。 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Atelier } from "../src/Atelier";
import { AtelierTheme } from "../src/components/AtelierTheme";
import { createWorkspaceStore } from "../src/hooks/workspaceStore";
import { readJSON } from "../../contracts/http";
import type { Bridge, ThemeSource } from "../../contracts/types";

let snapshot: ReturnType<ThemeSource["getSnapshot"]> = {
  active: { colorScheme: "light", tokens: {} },
  revision: 0,
};
const listeners = new Set<() => void>();
const source: ThemeSource = {
  getSnapshot: () => snapshot,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
let navigateSession: (id: string) => void;
const bridge: Bridge = {
  workspace: createWorkspaceStore(),
  openSession: async (id) => {
    navigateSession(id);
  },
  request: (method, path, body) =>
    fetch(`/mock${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(readJSON) as never,
  fileUrl: () =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=",
  upload: async () => {
    throw new Error("本测试不上传");
  },
  select: async (_session, assets) => {
    const draft = document.querySelector<HTMLTextAreaElement>("#draft")!;
    draft.value += assets.map((a) => ` [素材 ${a.id}]`).join("");
  },
  connection: async (value) =>
    value || { mode: "external", backendUrl: "http://localhost:8787" },
};
function Fixture() {
  const [session, setSession] = useState("one");
  navigateSession = setSession;
  return (
    <>
      <output aria-label="当前测试会话">{session}</output>
      <button
        onClick={() => {
          const dark = snapshot.active.colorScheme === "light";
          snapshot = {
            active: { colorScheme: dark ? "dark" : "light", tokens: {} },
            revision: snapshot.revision + 1,
          };
          document.body.toggleAttribute("data-ds-dark-theme", dark);
          document.body.style.setProperty(
            "--dsw-alias-bg-base",
            dark ? "#151517" : "#fff",
          );
          document.body.style.setProperty(
            "--dsw-alias-label-primary",
            dark ? "#ededed" : "#242424",
          );
          document.body.style.setProperty(
            "--dsw-alias-label-secondary",
            dark ? "#aaa" : "#777",
          );
          document.body.style.setProperty(
            "--dsw-alias-border-l2",
            dark ? "#343434" : "#e7e7e7",
          );
          for (const listener of listeners) listener();
        }}
      >
        模拟主题切换
      </button>
      <button onClick={() => setSession(session === "one" ? "two" : "one")}>
        模拟会话切换
      </button>
      <textarea id="draft" aria-label="聊天草稿" defaultValue="保留已有要求" />
      <div style={{ height: 850, width: "min(720px, 100%)" }}>
        <AtelierTheme source={source}>
          <Atelier
            key={session}
            sessionId={session}
            bridge={bridge}
            close={() => {}}
          />
        </AtelierTheme>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
