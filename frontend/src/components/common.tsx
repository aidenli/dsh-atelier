/** 页面共享状态文案与图标按钮；视觉运行态与后端终态保持分离。 */
import { Button, Tooltip, Tag } from "antd";
import type { ReactNode } from "react";
import {
  Clock3,
  Upload,
  Send,
  LoaderCircle,
  Download,
  CircleCheck,
  CircleX,
  CircleHelp,
  Ban,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
export { Film as AtelierIcon } from "lucide-react";
export const states: Record<string, string> = {
  queued: "本地等待",
  uploading: "上传素材",
  submitting: "提交中",
  remote_pending: "平台处理中",
  downloading: "保存结果",
  succeeded: "已完成",
  failed: "失败",
  submission_unknown: "待核对",
  cancel_requested: "取消中",
  cancelled: "已取消",
};
export const running = new Set([
  "uploading",
  "submitting",
  "remote_pending",
  "downloading",
]);
export const settled = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "submission_unknown",
]);
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "服务请求失败";
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        aria-label={label}
        icon={icon}
        onClick={onClick}
        disabled={disabled}
      />
    </Tooltip>
  );
}
/** 固定业务色与图标，Ant Design 预设色自动适配当前主题，未知状态安全回退。 */
const statusAppearance: Record<string, { color: string; icon: LucideIcon }> = {
  queued: { color: "gold", icon: Clock3 },
  uploading: { color: "cyan", icon: Upload },
  submitting: { color: "geekblue", icon: Send },
  remote_pending: { color: "blue", icon: LoaderCircle },
  downloading: { color: "purple", icon: Download },
  succeeded: { color: "green", icon: CircleCheck },
  failed: { color: "red", icon: CircleX },
  submission_unknown: { color: "orange", icon: CircleHelp },
  cancel_requested: { color: "magenta", icon: Ban },
  cancelled: { color: "default", icon: CircleSlash },
};
export function Status({ state }: { state: string }) {
  const { color, icon: Icon } = statusAppearance[state] || {
    color: "default",
    icon: CircleHelp,
  };
  return (
    <Tag
      className="atelier-status"
      color={color}
      icon={<Icon size={14} aria-hidden="true" />}
    >
      {states[state] || state}
    </Tag>
  );
}
