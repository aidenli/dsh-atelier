/** 版本检查独立于任务轮询；安装固定版本后提示重启，源码加载保持手动部署。 */
import { Alert, Badge, Button, Modal, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import type { Bridge, VersionInfo } from "../../../contracts/types";

/** 读取 Host 缓存的版本信息；卸载后忽略响应，检查失败不干扰任务页面。 */
export function PluginVersion({ bridge }: { bridge: Bridge }) {
  const [info, setInfo] = useState<VersionInfo>();
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [installed, setInstalled] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  /** 请求固定版本，成功只提示重启，不把磁盘新版本当成正在运行的版本。 */
  async function update() {
    if (lock.current || !info?.latest) return;
    lock.current = true;
    setUpdating(true);
    setError("");
    try {
      const result = await bridge.post<{ version: string }>("/updatePlugin", {
        version: info.latest,
      });
      setInstalled(result.version);
    } catch (error) {
      setError(error instanceof Error ? error.message : "更新失败");
    } finally {
      lock.current = false;
      setUpdating(false);
    }
  }
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const value = await bridge.get<VersionInfo>("/getVersion");
        if (active) setInfo(value);
      } catch {
        if (active)
          setInfo((value) => ({
            current: value?.current || "未知",
            source: value?.source || false,
            hasUpdate: false,
            error: "暂时无法检查更新",
          }));
      }
    };
    void check();
    const timer = setInterval(() => void check(), 15 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bridge]);
  return (
    <span className="atelier-version" ref={root}>
      <Tooltip
        title={
          info?.error ||
          (info?.hasUpdate ? `新版本 v${info.latest}` : "当前插件版本")
        }
      >
        <Badge dot={!!info?.hasUpdate} color="#e5484d">
          <span className="atelier-version-label">
            {info ? `v${info.current}` : "版本检查中"}
          </span>
        </Badge>
      </Tooltip>
      {info?.hasUpdate && (
        <Button size="small" onClick={() => setOpen(true)}>
          更新
        </Button>
      )}
      {open && (
        <Modal
          open={open}
          title={`更新至 v${info?.latest || ""}`}
          footer={null}
          onCancel={() => {
            if (!updating) setOpen(false);
          }}
          closable={!updating}
          maskClosable={!updating}
          centered
          width="calc(100% - 32px)"
          rootClassName="atelier-local-modal"
          getContainer={() =>
            root.current!.closest<HTMLElement>(".atelier-workspace")!
          }
        >
          {error && <Alert type="error" title={error} showIcon />}
          {installed && (
            <Alert
              type="success"
              title={`v${installed} 已安装，请重启 DSH Web 后使用新版本。`}
              showIcon
            />
          )}
          {!info?.source && !installed && (
            <Button
              type="primary"
              loading={updating}
              onClick={() => void update()}
            >
              立即更新至 v{info?.latest}
            </Button>
          )}
          {info?.source ? (
            <>
              <p>
                当前通过源码加载。先更新本地源码，再在 Atelier
                根目录编译部署；脚本会重启 DSH。
              </p>
              <Typography.Paragraph copyable code>
                {`git fetch origin tag v${info?.latest}`}
              </Typography.Paragraph>
              <p>核对本地修改后，将源码更新到该标签，再执行下面的编译命令。</p>
              <p>Windows</p>
              <Typography.Paragraph copyable code>
                {".\\scripts\\build.ps1"}
              </Typography.Paragraph>
              <p>macOS（先设置 DSH_SOURCE）</p>
              <Typography.Paragraph copyable code>
                bash scripts/build.sh
              </Typography.Paragraph>
            </>
          ) : (
            <>
              <p>
                在 DSH 源码目录执行对应安装渠道的命令，完成后重启 DSH。全局安装
                DSH 时去掉 pnpm。
              </p>
              <p>npm</p>
              <Typography.Paragraph copyable code>
                {`pnpm dsh plugin --profile web add dsh-atelier@${info?.latest}`}
              </Typography.Paragraph>
              <p>GitHub 预构建包</p>
              <Typography.Paragraph copyable code>
                {`pnpm dsh plugin --profile web add https://github.com/aidenli/dsh-atelier/releases/download/v${info?.latest}/dsh-atelier-${info?.latest}-universal.tgz`}
              </Typography.Paragraph>
              <p>
                更新前核对发行说明中的 DSH
                兼容版本；两个渠道的发布时间可能不同。
              </p>
            </>
          )}
        </Modal>
      )}
    </span>
  );
}
