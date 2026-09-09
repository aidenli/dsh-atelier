/** 动作迁移专属展示，素材与输出属于任务，不复制媒体状态到项目。 */
import { Descriptions } from "antd";
import type { Bridge, Task } from "../../../contracts/types";
import { MediaPreview } from "../components/MediaPreview";

export function MotionProjectDetail({
  tasks,
  bridge,
}: {
  tasks: Task[];
  bridge: Bridge;
}) {
  return (
    <>
      {tasks.map((task) => (
        <section key={task.id} className="atelier-motion-detail">
          <h3>{task.title}</h3>
          <div className="atelier-project-media">
            <div>
              <h4>人物图</h4>
              <MediaPreview
                src={bridge.fileUrl(task.imageId)}
                kind="image"
                title="项目人物图"
              />
            </div>
            <div>
              <h4>参考视频</h4>
              <MediaPreview
                src={bridge.fileUrl(task.videoId)}
                kind="video"
                title="项目参考视频"
                controls
              />
            </div>
          </div>
          <Descriptions
            size="small"
            column={2}
            items={[
              {
                key: "size",
                label: "输出尺寸",
                children: `${task.parameters.width} × ${task.parameters.height}`,
              },
              {
                key: "frames",
                label: "读取帧数",
                children: task.parameters.frames || "全部",
              },
              {
                key: "skip",
                label: "跳过帧数",
                children: task.parameters.skip || 0,
              },
              {
                key: "workflow",
                label: "工作流",
                children: task.workflow.name,
              },
            ]}
          />
          {!!task.outputIds.length && (
            <>
              <h4>生成结果</h4>
              <div className="atelier-project-media">
                {task.outputIds.map((id, i) => (
                  <MediaPreview
                    key={id}
                    src={bridge.fileUrl(id)}
                    kind="video"
                    title={`项目结果 ${i + 1}`}
                    controls
                  />
                ))}
              </div>
            </>
          )}
        </section>
      ))}
    </>
  );
}
