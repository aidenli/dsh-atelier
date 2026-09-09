/** 工作台与任务管理共用列表查询；宽度受限时以媒体行展示。 */
import { Empty, Pagination, Select } from "antd";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { Bridge } from "../../../contracts/types";
import { CreatedAt } from "../components/CreatedAt";
import type { useWorkspaceData } from "../hooks/useWorkspaceData";
import {
  IconButton,
  running,
  settled,
  states,
  Status,
} from "../components/common";
export function TasksPage({
  model,
  bridge,
  open,
}: {
  model: ReturnType<typeof useWorkspaceData>;
  bridge: Bridge;
  open(id: string): void;
}) {
  return (
    <>
      <div className="atelier-section-head">
        <h2>任务管理</h2>
        <IconButton
          label="刷新任务"
          icon={<RefreshCw size={16} />}
          onClick={() => void model.refresh()}
        />
      </div>
      <div className="atelier-filters">
        <Select
          aria-label="任务状态"
          value={model.filter}
          options={[
            { value: "", label: "全部状态" },
            ...Object.entries(states).map(([value, label]) => ({
              value,
              label: <Status state={value} />,
              title: label,
            })),
          ]}
          onChange={(v) => {
            model.setFilter(v);
            model.setPage(1);
          }}
        />
      </div>
      <div className="atelier-task-list">
        {model.data.items.map((task) => (
          <button
            type="button"
            className={`atelier-task-row ${running.has(task.state) ? "atelier-running" : ""}`}
            key={task.id}
            onClick={() => open(task.id)}
          >
            <img src={bridge.fileUrl(task.imageId)} alt="人物参考" />
            <div>
              <strong>{task.title}</strong>
              <small>
                {task.parameters.width} × {task.parameters.height} ·{" "}
                {task.parameters.frames || "全部"} 帧
              </small>
              <Status state={task.state} />
              <CreatedAt value={task.createdAt} />
            </div>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {!model.loading && !model.data.items.length && (
        <Empty description="暂无生成任务" />
      )}
      <Pagination
        current={model.page}
        total={model.data.total}
        pageSize={20}
        showSizeChanger={false}
        onChange={model.setPage}
        size="small"
        hideOnSinglePage={false}
      />
    </>
  );
}
