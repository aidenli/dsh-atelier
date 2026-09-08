/** 装配层仅持有导航状态，数据轮询、业务页面和主题分别独立。 */
import { Alert, Tabs } from "antd";
import {
  Film,
  FolderOpen,
  Layers,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Bridge, Workflow } from "../../contracts/types";
import { useAtelierWidth } from "./useAtelierWidth";
import { useWorkspaceData } from "./hooks/useWorkspaceData";
import { IconButton } from "./components/common";
import { TasksPage } from "./pages/TasksPage";
import { TaskDetail } from "./pages/TaskDetail";
import { AssetsPage } from "./pages/AssetsPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";
import { WorkflowEditor } from "./pages/WorkflowEditor";
import { ServiceSettings } from "./pages/ServiceSettings";
import "./atelier.css";
export function Atelier({
  sessionId,
  bridge,
  close,
}: {
  sessionId: string;
  bridge: Bridge;
  close(): void;
}) {
  const { view, task, workflow } = useSyncExternalStore(
    bridge.workspace.subscribe,
    bridge.workspace.getSnapshot,
  );
  const setTask = (task?: string) => bridge.workspace.update({ task });
  const setWorkflow = (workflow?: Workflow) =>
    bridge.workspace.update({ workflow });
  const workspace = useRef<HTMLElement>(null);
  useAtelierWidth(workspace);
  const model = useWorkspaceData(bridge);
  useEffect(() => {
    const sync = () =>
      workspace.current?.classList.toggle("atelier-paused", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  function navigate(next: string) {
    bridge.workspace.update({
      view: next,
      task: undefined,
      workflow: undefined,
    });
  }
  return (
    <section
      className="atelier atelier-workspace"
      ref={workspace}
      aria-label="Atelier 媒体工作台"
    >
      <header className="atelier-header">
        <div className="atelier-brand">
          <Film size={22} />
          <div>
            <strong>Atelier</strong>
            <small>媒体工作台</small>
          </div>
        </div>
        <div className="atelier-tools">
          <IconButton
            label="服务设置"
            icon={<Settings size={17} />}
            onClick={() => navigate("settings")}
          />
          <IconButton
            label="返回原生详情"
            icon={<X size={18} />}
            onClick={close}
          />
        </div>
      </header>
      <Tabs
        activeKey={view}
        onChange={navigate}
        items={[
          { key: "home", label: "工作台", icon: <Film size={15} /> },
          { key: "tasks", label: "任务", icon: <Layers size={15} /> },
          { key: "assets", label: "素材", icon: <FolderOpen size={15} /> },
          {
            key: "workflows",
            label: "工作流",
            icon: <SlidersHorizontal size={15} />,
          },
        ]}
      />
      {model.error && (
        <Alert
          type="error"
          showIcon
          title={model.error}
          closable
          onClose={() => model.setError("")}
        />
      )}
      <main className="atelier-content" aria-busy={model.loading || model.busy}>
        {task ? (
          <TaskDetail
            key={task}
            id={task}
            bridge={bridge}
            back={() => setTask(undefined)}
          />
        ) : workflow ? (
          <WorkflowEditor
            key={workflow.id}
            value={workflow}
            back={() => setWorkflow(undefined)}
            busy={model.busy}
            save={(w) =>
              void model.act(async () => {
                await bridge.request("PUT", `/workflows/${w.id}`, w);
                setWorkflow(undefined);
              })
            }
            remove={() =>
              void model.act(async () => {
                await bridge.request("DELETE", `/workflows/${workflow.id}`);
                setWorkflow(undefined);
              })
            }
          />
        ) : view === "assets" ? (
          <AssetsPage
            model={model}
            bridge={bridge}
            sessionId={sessionId}
            container={() => workspace.current!}
          />
        ) : view === "workflows" ? (
          <WorkflowsPage items={model.workflows} open={setWorkflow} />
        ) : view === "settings" ? (
          <ServiceSettings bridge={bridge} onError={model.setError} />
        ) : (
          <TasksPage
            model={model}
            bridge={bridge}
            home={view === "home"}
            open={setTask}
          />
        )}
      </main>
    </section>
  );
}
