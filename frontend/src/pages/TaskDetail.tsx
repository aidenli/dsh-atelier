/** 详情独立刷新，不依赖列表筛选；操作后从数据库重读，避免伪造终态。 */
import { Alert, Button, Descriptions, Form, Input } from "antd";
import { ArrowLeft, Download, RefreshCw, X, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import type { Bridge, Task } from "../../../contracts/types";
import { message, running, settled, Status } from "../components/common";
import { MediaPreview } from "../components/MediaPreview";
import { CreatedAt } from "../components/CreatedAt";
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
  const path = `/tasks/${id}`;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await bridge.request<{ task: Task }>("GET", path);
        if (!stopped) setTask(result.task);
      } catch (e) {
        if (!stopped) setError(message(e));
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [bridge, path]);
  async function action(command: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await bridge.request("POST", `/tasks/${id}/${command}`, body);
      const result = await bridge.request<{ task: Task }>("GET", path);
      setTask(result.task);
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
          </div>
          {task.outputIds.map((output) => (
            <div className="atelier-output" key={output}>
              <MediaPreview
                src={bridge.fileUrl(output)}
                kind="video"
                title="生成结果视频"
                controls
              />
              <Button
                href={bridge.fileUrl(output, true)}
                download
                icon={<Download size={16} />}
              >
                下载视频
              </Button>
            </div>
          ))}
          <div className="atelier-inputs">
            <MediaPreview
              src={bridge.fileUrl(task.imageId)}
              kind="image"
              title="人物参考图"
            />
            <MediaPreview
              src={bridge.fileUrl(task.videoId)}
              kind="video"
              title="动作参考视频"
              controls
            />
          </div>
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: "id", label: "任务 ID", children: task.id },
              {
                key: "remote",
                label: "远端 ID",
                children: task.remoteId || "未提交",
              },
              {
                key: "workflow",
                label: "工作流",
                children: `${task.workflow.name} · v${task.workflow.revision}`,
              },
              {
                key: "size",
                label: "尺寸",
                children: `${task.parameters.width} × ${task.parameters.height}`,
              },
              {
                key: "frames",
                label: "读取 / 跳过帧数",
                children: `${task.parameters.frames || "全部"} / ${task.parameters.skip}`,
              },
              {
                key: "created",
                label: "创建时间",
                children: <CreatedAt value={task.createdAt} />,
              },
              { key: "error", label: "失败原因", children: task.error || "无" },
            ]}
          />
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
