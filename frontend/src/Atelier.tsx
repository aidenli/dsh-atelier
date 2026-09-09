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
import { PluginVersion } from "./components/PluginVersion";
import { TasksPage } from "./pages/TasksPage";
import { MotionProjects } from "./pages/MotionProjects";
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
  const { view, task, workflow, project } = useSyncExternalStore(
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
    let active = true;
    const initial = bridge.workspace.getSnapshot();
    // 仅打开时引导配置；请求返回前用户若已导航，则不抢占页面。
    // 必须明确未配置才跳转，连接失败不能当成缺少密钥。
    void bridge.get<{ hasApiKey: boolean }>("/getConfig").then(
      (config) => {
        if (
          active &&
          config.hasApiKey === false &&
          bridge.workspace.getSnapshot() === initial
        )
          bridge.workspace.update({
            view: "settings",
            task: undefined,
            project: undefined,
            workflow: undefined,
          });
      },
      () => {}, // 连接故障由现有业务轮询展示，避免重复错误提示。
    );
    return () => {
      active = false;
    };
  }, [bridge]);
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
      project: undefined,
      workflow: undefined,
    });
  }
  return (
    <section
      className="atelier atelier-workspace"
      ref={workspace}
      aria-label="Atelier 媒体工作台"
    >
      <div
        className="atelier-resize"
        role="separator"
        aria-label="调整插件宽度"
        aria-orientation="vertical"
        tabIndex={0}
      />
      <header className="atelier-header">
        <div className="atelier-brand">
          <Film size={18} />
          <div>
            <strong>Atelier</strong>
          </div>
        </div>
        <div className="atelier-tools">
          <PluginVersion bridge={bridge} />
          <IconButton
            label="返回原生详情"
            icon={<X size={18} />}
            onClick={close}
          />
        </div>
      </header>
      <Tabs
        size="small"
        tabBarGutter={20}
        activeKey={view}
        onChange={navigate}
        items={[
          {
            key: "motion-transfer",
            label: "动作迁移",
            icon: <Film size={15} />,
          },
          { key: "tasks", label: "任务", icon: <Layers size={15} /> },
          { key: "assets", label: "素材", icon: <FolderOpen size={15} /> },
          {
            key: "workflows",
            label: "工作流",
            icon: <SlidersHorizontal size={15} />,
          },
          { key: "settings", label: "设置", icon: <Settings size={15} /> },
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
            backLabel={project ? "返回项目" : "任务列表"}
          />
        ) : workflow ? (
          <WorkflowEditor
            key={workflow.id}
            value={workflow}
            back={() => setWorkflow(undefined)}
            busy={model.busy}
            save={(w) =>
              void model.act(async () => {
                await bridge.post(`/saveWorkflow?id=${w.id}`, w);
                setWorkflow(undefined);
              })
            }
            remove={() =>
              void model.act(async () => {
                await bridge.post(`/deleteWorkflow?id=${workflow.id}`);
                setWorkflow(undefined);
              })
            }
          />
        ) : view === "motion-transfer" ? (
          <MotionProjects
            bridge={bridge}
            id={project}
            open={(project) => bridge.workspace.update({ project })}
            openTask={setTask}
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
          <TasksPage model={model} bridge={bridge} open={setTask} />
        )}
      </main>
    </section>
  );
}
