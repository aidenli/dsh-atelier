/** 动作迁移项目视图：项目组织创作，任务负责远端执行；详情读取全部任务，不受任务页分页影响。 */
import { Alert, Button, Empty, Pagination, Tag } from "antd";
import { ArrowLeft, ArrowRight, Film, RefreshCw } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  Bridge,
  ProjectSummary,
  ProjectPage,
  Task,
} from "../../../contracts/types";
import { MotionProjectDetail } from "./MotionProjectDetail";
import { CreatedAt } from "../components/CreatedAt";
import { message, running, Status } from "../components/common";

/** 串行轮询以项目 ID 为边界；离开页面后的响应不得覆盖新页面。 */
export function MotionProjects({
  bridge,
  id,
  open,
  openTask,
}: {
  bridge: Bridge;
  id?: string;
  open(id?: string): void;
  openTask(id: string): void;
}) {
  const [projects, setProjects] = useState<ProjectPage>({
    items: [],
    page: 1,
    total: 0,
  });
  const [detail, setDetail] = useState<{
    project: ProjectSummary;
    tasks: Task[];
  }>();
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const state = useSyncExternalStore(
    bridge.workspace.subscribe,
    bridge.workspace.getSnapshot,
  );
  const page = state.projectPage || 1;
  const setPage = (projectPage: number) =>
    bridge.workspace.update({ projectPage });
  useEffect(() => {
    let stopped = false;
    setDetail(undefined);
    setError("");
    async function refresh() {
      try {
        if (id) {
          const value = await bridge.get<{
            project: ProjectSummary;
            tasks: Task[];
          }>(`/getProject?id=${encodeURIComponent(id)}`);
          if (!stopped) setDetail(value);
        } else {
          const value = await bridge.get<ProjectPage>(
            `/listProjects?type=motion-transfer&page=${page}`,
          );
          if (!stopped) setProjects(value);
        }
        if (!stopped) setError("");
      } catch (e) {
        if (!stopped) setError(message(e));
      }
    }
    const onEvents = () => void refresh();
    window.addEventListener("atelier:events", onEvents);
    void refresh();
    return () => {
      stopped = true;
      window.removeEventListener("atelier:events", onEvents);
    };
  }, [bridge, id, page, refreshKey]);
  return (
    <>
      {error && <Alert type="error" showIcon title={error} />}
      {id ? (
        <>
          <Button
            className="atelier-back"
            color="primary"
            variant="outlined"
            icon={<ArrowLeft size={18} />}
            onClick={() => open()}
          >
            动作迁移项目
          </Button>
          {detail && (
            <>
              <h2>{detail.project.title}</h2>
              <div className="atelier-filters">
                <Tag color="blue">动作迁移</Tag>
                <Tag>{detail.tasks.length} 个任务</Tag>
                <CreatedAt value={detail.project.createdAt} />
              </div>
              {detail.project.type === "motion-transfer" ? (
                <MotionProjectDetail tasks={detail.tasks} bridge={bridge} />
              ) : (
                <Alert type="warning" title="暂不支持此项目类型" />
              )}
              <div className="atelier-task-list">
                {detail.tasks.map((task, index) => (
                  <button
                    type="button"
                    key={task.id}
                    className={`atelier-task-row ${running.has(task.state) ? "atelier-running" : ""}`}
                    onClick={() => openTask(task.id)}
                  >
                    <img src={bridge.fileUrl(task.imageId)} alt="人物参考" />
                    <div>
                      <strong>
                        {index + 1}. {task.title}
                      </strong>
                      <small>
                        RunningHub · {task.parameters.width} ×{" "}
                        {task.parameters.height}
                      </small>
                      <Status state={task.state} />
                      <CreatedAt value={task.createdAt} />
                    </div>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="atelier-section-head">
            <h2>动作迁移</h2>
            <div className="atelier-inline-actions">
              <Tag>{projects.total} 个项目</Tag>
              <Button
                type="text"
                aria-label="刷新项目"
                icon={<RefreshCw size={16} />}
                onClick={() => setRefreshKey((value) => value + 1)}
              />
            </div>
          </div>
          <div className="atelier-task-list">
            {projects.items.map((project) => (
              <button
                type="button"
                className={`atelier-task-row ${running.has(project.state) ? "atelier-running" : ""}`}
                key={project.id}
                onClick={() => open(project.id)}
              >
                <img src={bridge.fileUrl(project.imageId)} alt="人物参考" />
                <div>
                  <strong>{project.title}</strong>
                  <small>{project.taskIds.length} 个 RunningHub 任务</small>
                  <Status state={project.state} />
                  <small>
                    已完成 {project.completed} / {project.totalTasks}
                  </small>
                  <CreatedAt value={project.createdAt} />
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          {!projects.items.length && !error && (
            <Empty description="暂无动作迁移项目" />
          )}
          <Pagination
            current={projects.page}
            total={projects.total}
            pageSize={20}
            showSizeChanger={false}
            onChange={setPage}
            hideOnSinglePage
          />
        </>
      )}
    </>
  );
}
