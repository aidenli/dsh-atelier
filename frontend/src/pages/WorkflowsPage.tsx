/** 工作流列表与编辑分离；新定义沿用当前可用工作流的参数模板。 */
import { Button, Empty, Tag } from "antd";
import { ArrowRight, Plus, SlidersHorizontal } from "lucide-react";
import type { Workflow } from "../../../contracts/types";
import { CreatedAt } from "../components/CreatedAt";
export function WorkflowsPage({
  items,
  open,
}: {
  items: Workflow[];
  open(w: Workflow): void;
}) {
  return (
    <>
      <div className="atelier-section-head">
        <h2>工作流</h2>
        <Button
          icon={<Plus size={16} />}
          disabled={!items.length}
          onClick={() =>
            open({
              ...items[0],
              id: `workflow-${crypto.randomUUID()}`,
              name: "新工作流",
              revision: 0,
            })
          }
        >
          新建
        </Button>
      </div>
      {items.map((w) => (
        <button
          type="button"
          className="atelier-workflow-row"
          key={w.id}
          onClick={() => open(w)}
        >
          <SlidersHorizontal size={20} />
          <div>
            <strong>{w.name}</strong>
            <small>30 fps · v{w.revision}</small>
            <CreatedAt value={w.createdAt} />
          </div>
          <Tag>{w.enabled ? "已启用" : "已停用"}</Tag>
          <ArrowRight size={16} />
        </button>
      ))}
      {!items.length && <Empty description="暂无工作流" />}
    </>
  );
}
