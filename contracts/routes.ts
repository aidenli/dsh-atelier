/** 操作式接口白名单：读取仅 GET，写入仅 POST；路径不包含资源 ID。 */
export const readOperations = [
  "getHealth",
  "getConfig",
  "listWorkflows",
  "listProjects",
  "getProject",
  "listAssets",
  "getAssetSelection",
  "listTasks",
  "getTask",
  "listEvents",
] as const;
export const writeOperations = [
  "saveConfig",
  "saveWorkflow",
  "deleteWorkflow",
  "deleteAssets",
  "createTasks",
  "cancelTask",
  "retryTask",
  "reconcileTask",
  "ackEvent",
] as const;
