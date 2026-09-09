/** 地址与账户分开保存；密钥不回填，切换连接后重新读取能力和账户状态。 */
import { Alert, Button, Form, Input } from "antd";
import { useEffect, useState } from "react";
import type {
  Bridge,
  ConnectionSettings,
  Health,
} from "../../../contracts/types";
import { message } from "../components/common";
export function ServiceSettings({
  bridge,
  onError,
}: {
  bridge: Bridge;
  onError(error: string): void;
}) {
  const [connection, setConnection] = useState<ConnectionSettings>({
      backendUrl: "http://127.0.0.1:8787",
      mode: "managed",
    }),
    [key, setKey] = useState(""),
    [hasKey, setHasKey] = useState(false),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [compatible, setCompatible] = useState(true);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      bridge.connection(),
      bridge.get<{ hasApiKey: boolean }>("/getConfig"),
      bridge.get<Health>("/getHealth"),
    ]).then(
      ([c, k, h]) => {
        if (alive) {
          setConnection(c);
          setHasKey(k.hasApiKey);
          setCompatible(h.capabilities?.includes("asset-delete") === true);
        }
      },
      (e) => {
        if (alive) onError(message(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [bridge]);
  async function save() {
    setBusy(true);
    setStatus("");
    try {
      await bridge.connection(connection);
      const health = await bridge.get<Health>("/getHealth");
      setCompatible(health.capabilities?.includes("asset-delete") === true);
      await bridge.post("/saveConfig", {
        baseUrl: "https://www.runninghub.cn",
        apiKey: key,
      });
      const config = await bridge.get<{ hasApiKey: boolean }>("/getConfig");
      setHasKey(config.hasApiKey);
      setKey("");
      setStatus("连接正常，配置已保存");
      onError("");
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>服务设置</h2>
      {!compatible && (
        <Alert
          type="warning"
          showIcon
          title="后端版本过旧，请重启新版后端以启用素材删除"
        />
      )}
      <Form layout="vertical" onFinish={() => void save()}>
        <Form.Item label="后端服务 URL" required>
          <Input
            type="url"
            required
            value={connection.backendUrl}
            onChange={(e) =>
              setConnection({ ...connection, backendUrl: e.target.value })
            }
          />
        </Form.Item>
        <Form.Item label="RunningHub API Key">
          <Input.Password
            autoComplete="new-password"
            value={key}
            placeholder={hasKey ? "已配置" : "未配置"}
            onChange={(e) => setKey(e.target.value)}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          保存并检查连接
        </Button>
        {status && (
          <Alert
            className="atelier-feedback"
            type="success"
            title={status}
            showIcon
          />
        )}
      </Form>
    </>
  );
}
