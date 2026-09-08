/** 全部页面和浮层共用平台主题；仅更新 Provider 配置，不重挂载业务状态。 */
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useSyncExternalStore, type ReactNode } from "react";
import type { ThemeSource } from "../../../contracts/types";

export function AtelierTheme({
  source,
  children,
}: {
  source: ThemeSource;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const dark = snapshot.active.colorScheme === "dark";
  const tokens = snapshot.active.tokens;
  return (
    <ConfigProvider
      prefixCls="atelier-ant"
      locale={zhCN}
      componentSize="middle"
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? "#82a4ff" : "#3563e9",
          colorInfo: dark ? "#82a4ff" : "#3563e9",
          colorBgContainer:
            tokens["--dsw-alias-bg-base"] || (dark ? "#191919" : "#ffffff"),
          colorText:
            tokens["--dsw-alias-label-primary"] ||
            (dark ? "#ededed" : "#242424"),
          borderRadius: 6,
          fontSize: 13,
          fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
        },
      }}
      getPopupContainer={(trigger) =>
        (trigger?.closest(".atelier") as HTMLElement) || document.body
      }
    >
      {children}
    </ConfigProvider>
  );
}
