/** 详情独立刷新，不依赖列表筛选；操作后从数据库重读，避免伪造终态。 */
import { Alert, Button, Form, Input, Tag } from "antd";
import { ArrowLeft, RefreshCw, X, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import type { Asset, Bridge, Task } from "../../../contracts/types";
import { message, running, settled, Status } from "../components/common";
import { RunningHubTask } from "../components/RunningHubTask";
export function TaskDetail({
  id,
  bridge,
  back,
  backLabel = "任务列表",
}: {
  id: string;
  bridge: Bridge;
  back(): void;
  backLabel?: string;
}) {
  const [task, setTask] = useState<Task>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remoteId, setRemoteId] = useState("");
  const path = `/getTask?id=${encodeURIComponent(id)}`;
  /** 旧后端只返回 outputIds，按素材 ID 补齐类型，不能根据扩展名猜测媒体种类。 */
  async function loadTask(): Promise<Task> {
    const { task } = await bridge.get<{ task: Task }>(path);
    if (task.outputs === undefined && task.outputIds.length) {
      const assets = await bridge.get<Asset[]>("/listAssets");
      return {
        ...task,
        outputs: assets.filter((asset) => task.outputIds.includes(asset.id)),
      };
    }
    return task;
  }
  useEffect(() => {
    let stopped = false;
    /** 首次进入详情读取完整快照，后续由全局事件游标驱动增量刷新。 */
    async function load() {
      try {
        const result = await loadTask();
        if (!stopped) setTask(result);
      } catch (e) {
        if (!stopped) setError(message(e));
      }
    }
    const onEvents = (event: Event) => {
      const events = (event as CustomEvent<{ entityId?: string }[]>).detail;
      // 只有当前任务对应的事件才刷新详情，项目和其他任务事件直接忽略。
      if (events.some((item) => item.entityId === id)) void load();
    };
    void load();
    window.addEventListener("atelier:events", onEvents);
    return () => {
      stopped = true;
      window.removeEventListener("atelier:events", onEvents);
    };
  }, [bridge, path]);
  async function action(command: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const operation = {
        cancel: "cancelTask",
        retry: "retryTask",
        reconcile: "reconcileTask",
      }[command];
      if (!operation) throw new Error("未知任务操作");
      await bridge.post(`/${operation}?id=${encodeURIComponent(id)}`, body);
      setTask(await loadTask());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        className="atelier-back"
        color="primary"
        variant="outlined"
        icon={<ArrowLeft size={18} />}
        onClick={back}
      >
        {backLabel}
      </Button>
      {error && <Alert type="error" title={error} showIcon />}
      {task && (
        <>
          <h2>{task.title}</h2>
          <div
            className={`atelier-detail-status ${running.has(task.state) ? "atelier-running" : ""}`}
          >
            <Status state={task.state} />
            <Tag>
              {(task.platform || "runninghub") === "runninghub"
                ? "RunningHub"
                : task.platform}
            </Tag>
          </div>
          {(task.platform || "runninghub") === "runninghub" ? (
            <RunningHubTask task={task} bridge={bridge} />
          ) : (
            <Alert type="warning" title={`暂不支持平台：${task.platform}`} />
          )}
          <div className="atelier-actions">
            {!settled.has(task.state) && (
              <Button
                danger
                icon={<X size={16} />}
                disabled={task.cancelRequested}
                loading={busy}
                onClick={() => void action("cancel")}
              >
                取消任务
              </Button>
            )}
            {["failed", "cancelled"].includes(task.state) && (
              <Button
                icon={<RefreshCw size={16} />}
                loading={busy}
                onClick={() =>
                  void action("retry", { revision: task.revision })
                }
              >
                重新尝试
              </Button>
            )}
          </div>
          {task.state === "submission_unknown" && (
            <Form
              layout="vertical"
              onFinish={() => void action("reconcile", { remoteId })}
            >
              <Form.Item label="核对后的远端任务 ID" required>
                <Input
                  value={remoteId}
                  onChange={(e) => setRemoteId(e.target.value)}
                  required
                />
              </Form.Item>
              <Button
                htmlType="submit"
                type="primary"
                disabled={!remoteId.trim()}
                loading={busy}
              >
                关联任务
              </Button>
            </Form>
          )}
          <div className="atelier-actions">
            <Button
              icon={<MessageSquare size={16} />}
              disabled={!task.sessionId || busy}
              loading={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void bridge
                  .openSession(task.sessionId)
                  .catch((e) => setError(message(e)))
                  .finally(() => setBusy(false));
              }}
            >
              打开来源会话
            </Button>
          </div>
        </>
      )}
    </>
  );
}
