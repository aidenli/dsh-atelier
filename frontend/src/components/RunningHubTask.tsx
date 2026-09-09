/** RunningHub 专用详情：只读配置、节点业务快照和按实际类型展示的产物。 */
import { Alert, Button, Empty, Form, Input, Tag } from "antd";
import { Download } from "lucide-react";
import type { Bridge, Task } from "../../../contracts/types";
import { MediaPreview } from "./MediaPreview";

/** 参数来自入队时工作流快照，素材字段用 assetId 标识，不伪装成远端上传文件名。 */
export function RunningHubTask({
  task,
  bridge,
}: {
  task: Task;
  bridge: Bridge;
}) {
  const p = task.parameters;
  const values: Record<string, string> = {
    width: String(p.width),
    height: String(p.height),
    frames: String(p.frames),
    skip: String(p.skip),
    image: `assetId:${task.imageId}`,
    video: `assetId:${task.videoId}`,
  };
  const nodes = Object.entries(values).map(([key, fieldValue]) => ({
    ...task.workflow.mapping?.[key],
    fieldValue,
  }));
  const instance =
    p.instanceType ||
    (task.workflow.id === "wan-animate2" &&
    p.width * p.height > (480 * 848 + 720 * 1280) / 2
      ? "plus"
      : "default");
  const fields = {
    平台: "RunningHub",
    "任务 ID": task.id,
    "远端任务 ID": task.remoteId || "未提交",
    工作流: `${task.workflow.name} · v${task.workflow.revision}`,
    "工作流 ID": task.workflow.remoteId,
    实例类型: instance === "plus" ? "plus" : "默认（不传 instanceType）",
    创建时间: new Date(task.createdAt).toLocaleString(),
    尝试次数: String(task.attempt || 1),
  };
  const labels: Record<string, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
  };
  return (
    <>
      <h3>配置参数</h3>
      <Form layout="vertical" className="atelier-task-config">
        {Object.entries(fields).map(([label, value]) => (
          <Form.Item key={label} label={label}>
            <Input readOnly value={value} />
          </Form.Item>
        ))}
      </Form>
      {task.error && <Alert type="error" showIcon title={task.error} />}
      <h3>nodeInfoList</h3>
      <Input.TextArea
        aria-label="nodeInfoList JSON"
        readOnly
        value={JSON.stringify(nodes, null, 2)}
        autoSize={{ minRows: 8, maxRows: 18 }}
        className="atelier-node-json"
      />
      <p>素材字段以 assetId 表示本地引用，提交时替换为平台上传文件名。</p>
      <h3>生成产物</h3>
      {!task.outputIds.length && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无生成产物"
        />
      )}
      {task.outputIds.map((id) => {
        const asset = task.outputs?.find((item) => item.id === id);
        const label = asset && labels[asset.kind];
        return (
          <div className="atelier-output" key={id}>
            {asset && label ? (
              <>
                <Tag>{label}</Tag>
                <MediaPreview
                  src={bridge.fileUrl(id)}
                  kind={asset.kind}
                  title={asset.name || `生成${label}`}
                  controls
                />
                {asset.kind === "audio" && (
                  <audio
                    controls
                    preload="metadata"
                    src={bridge.fileUrl(id)}
                    aria-label={asset.name || "生成音频"}
                    style={{ width: "100%" }}
                  />
                )}
              </>
            ) : (
              <Alert type="warning" title="产物类型信息不可用" />
            )}
            <Button
              href={bridge.fileUrl(id, true)}
              download
              icon={<Download size={16} />}
            >
              下载{label || "产物"}
            </Button>
          </div>
        );
      })}
    </>
  );
}
