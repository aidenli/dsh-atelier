/** 真实验收只创建固定请求标识的一批任务；再次运行仅查询已保存任务，不重复生成。 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtime = resolve(root, ".runtime/default");
const base = process.env.ATELIER_URL || "http://127.0.0.1:8787";
const sessionId = "atelier-real-test-20260907";
const recordPath = resolve(runtime, "real-test.json");

/** 调用本地 API，只输出业务错误，不打印平台配置。 */
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

let record;
try {
  record = JSON.parse(await readFile(recordPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const inputs = [
    "E:\\aigc\\test_imgs\\ChatGPT Image 2026年4月18日 09_25_25.png",
    "E:\\aigc\\test_imgs\\89b561a21173404b5cab976293ed96555c677b536217c6383731b203ca79c3a8.mp4",
  ];
  // 先保存素材身份，再创建批次；即使创建响应丢失，重跑也使用同一 requestId 和素材。
  const assets = [];
  for (const path of inputs)
    assets.push(await api("/assets/import", { sessionId, path }));
  record = {
    sessionId,
    requestId: "wan-animate2-one-real-test-81-v1",
    imageId: assets[0].id,
    videoId: assets[1].id,
  };
  await writeFile(recordPath, JSON.stringify(record, null, 2));
}
if (!record.taskId) {
  const plan = await api("/tasks", {
    sessionId,
    requestId: record.requestId,
    tasks: [
      {
        title: "Wan Animate2 · 81 帧真实验收",
        workflowId: "wan-animate2",
        imageId: record.imageId,
        videoId: record.videoId,
        parameters: { width: 480, height: 848, frames: 81, skip: 0 },
      },
    ],
  });
  record.taskId = plan.taskIds[0];
  await writeFile(recordPath, JSON.stringify(record, null, 2));
}
const { task } = await api(`/tasks/${record.taskId}`);
console.log(
  JSON.stringify(
    {
      id: task.id,
      state: task.state,
      remoteId: task.remoteId,
      error: task.error,
      outputIds: task.outputIds,
    },
    null,
    2,
  ),
);
