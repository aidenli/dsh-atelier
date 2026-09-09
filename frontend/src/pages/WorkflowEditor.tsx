/** 表单保留本地草稿，版本冲突由后端校验，主题切换不会初始化表单。 */
import { Button, Form, Input, InputNumber, Switch } from "antd";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { Workflow } from "../../../contracts/types";
export function WorkflowEditor({
  value,
  back,
  save,
  remove,
  busy,
}: {
  value: Workflow;
  back(): void;
  save(w: Workflow): void;
  remove(): void;
  busy: boolean;
}) {
  const [form, setForm] = useState(value);
  return (
    <>
      <Button
        className="atelier-back"
        color="primary"
        variant="outlined"
        icon={<ArrowLeft size={18} />}
        onClick={back}
      >
        工作流列表
      </Button>
      <h2>工作流配置</h2>
      <Form layout="vertical" onFinish={() => save(form)}>
        <Form.Item label="名称" required>
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="平台工作流 ID" required>
          <Input
            required
            value={form.remoteId}
            onChange={(e) => setForm({ ...form, remoteId: e.target.value })}
          />
        </Form.Item>
        <Form.Item label="启用工作流">
          <Switch
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
        </Form.Item>
        <h3>默认参数</h3>
        <div className="atelier-form-grid">
          {Object.entries({
            width: "宽度",
            height: "高度",
            frames: "读取帧数",
            skip: "跳过帧数",
          }).map(([key, label]) => (
            <Form.Item label={label} key={key}>
              <InputNumber
                min={key === "width" || key === "height" ? 1 : 0}
                precision={0}
                value={form.defaults[key as keyof typeof form.defaults]}
                onChange={(v) => {
                  if (v !== null)
                    setForm({
                      ...form,
                      defaults: { ...form.defaults, [key]: v },
                    });
                }}
              />
            </Form.Item>
          ))}
        </div>
        <h3>节点映射</h3>
        {Object.entries(form.mapping).map(([key, mapping]) => (
          <div className="atelier-mapping" key={key}>
            <span>{key}</span>
            <Input
              aria-label={`${key} 节点 ID`}
              required
              value={mapping.nodeId}
              onChange={(e) =>
                setForm({
                  ...form,
                  mapping: {
                    ...form.mapping,
                    [key]: { ...mapping, nodeId: e.target.value },
                  },
                })
              }
            />
            <Input
              aria-label={`${key} 字段名`}
              required
              value={mapping.fieldName}
              onChange={(e) =>
                setForm({
                  ...form,
                  mapping: {
                    ...form.mapping,
                    [key]: { ...mapping, fieldName: e.target.value },
                  },
                })
              }
            />
          </div>
        ))}
        <div className="atelier-actions">
          <Button type="primary" htmlType="submit" loading={busy}>
            保存配置
          </Button>
          <Button danger disabled={busy} onClick={remove}>
            删除
          </Button>
        </div>
      </Form>
    </>
  );
}
