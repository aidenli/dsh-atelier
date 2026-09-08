/** 内部持久化类型扩展公开契约；凭据、上传文件名和结果 URL 不得返回浏览器。 */
import type {
  Asset as PublicAsset,
  Task as PublicTask,
} from "../../../contracts/generated.js";
export type {
  Attempt,
  BatchRequest,
  Config,
  Event,
  Mapping,
  Parameters,
  Plan,
  TaskSpec,
  Workflow,
} from "../../../contracts/generated.js";
export interface Asset extends PublicAsset {
  path: string;
}
export interface ResultURL {
  url: string;
  outputType: string;
}
export interface UploadSnapshot {
  image: string;
  video: string;
  accountHash: string;
  providerUrl: string;
}
export interface Task extends PublicTask {
  accountHash: string;
  uploads?: UploadSnapshot;
  results?: ResultURL[];
}
/** 未知提交同样停止自动执行，必须人工绑定原任务 ID。 */
export const terminal = (state: string) =>
  ["succeeded", "failed", "cancelled", "submission_unknown"].includes(state);
export const now = () => new Date().toISOString();
