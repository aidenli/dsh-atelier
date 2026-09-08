/** 统一显示浏览器本地时区的创建时间，保留原始时间供语义化读取。 */
import { Clock3 } from "lucide-react";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** 缺失或无效的旧记录时间显示明确占位，不误用当前时间。 */
export function CreatedAt({ value }: { value?: string }) {
  const date = value ? new Date(value) : undefined;
  const valid = date && Number.isFinite(date.getTime());
  const label = valid ? formatter.format(date) : "创建时间未知";
  return (
    <time
      className="atelier-created-at"
      dateTime={valid ? date.toISOString() : undefined}
      title={valid ? `创建时间：${label}（本地时间）` : label}
      aria-label={valid ? `创建时间：${label}` : label}
    >
      <Clock3 size={13} aria-hidden="true" />
      <span>{label}</span>
    </time>
  );
}
