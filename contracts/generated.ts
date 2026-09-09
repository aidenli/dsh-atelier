// 自动生成：node scripts/internal/generate-contracts.mjs；公开字段以 openapi.json 为准。

/** Asset：公开接口类型，不包含后端内部执行字段。 */
export interface Asset {
  createdAt: string;
  deletedAt?: string;
  id: string;
  kind: string;
  mime: string;
  name: string;
  sessionId: string;
  sha256: string;
  size: number;
}

/** Attempt：公开接口类型，不包含后端内部执行字段。 */
export interface Attempt {
  createdAt: string;
  error: string;
  id: string;
  number: number;
  remoteId: string;
  state: string;
  taskId: string;
  updatedAt: string;
}

/** BatchRequest：公开接口类型，不包含后端内部执行字段。 */
export interface BatchRequest {
  requestId: string;
  sessionId: string;
  tasks: TaskSpec[];
}

/** Config：公开接口类型，不包含后端内部执行字段。 */
export interface Config {
  apiKey?: string;
  baseUrl: string;
}

/** DeleteAssetsRequest：公开接口类型，不包含后端内部执行字段。 */
export interface DeleteAssetsRequest {
  ids: string[];
  sessionId?: string;
}

/** Event：公开接口类型，不包含后端内部执行字段。 */
export interface Event {
  createdAt: string;
  delivered: boolean;
  entityId: string;
  kind: string;
  message: string;
  notify: boolean;
  seq: number;
  sessionId: string;
}

/** Health：公开接口类型，不包含后端内部执行字段。 */
export interface Health {
  apiVersion: number;
  capabilities: string[];
  status: string;
  version: string;
}

/** Mapping：公开接口类型，不包含后端内部执行字段。 */
export interface Mapping {
  fieldName: string;
  nodeId: string;
}

/** Parameters：公开接口类型，不包含后端内部执行字段。 */
export interface Parameters {
  frames: number;
  height: number;
  instanceType?: string;
  skip: number;
  width: number;
}

/** Plan：公开接口类型，不包含后端内部执行字段。 */
export interface Plan {
  createdAt: string;
  fingerprint: string;
  id: string;
  requestId: string;
  sessionId: string;
  taskIds: string[];
}

/** Project：公开接口类型，不包含后端内部执行字段。 */
export interface Project {
  id: string;
  type: string;
  title: string;
  sessionId: string;
  taskIds: string[];
  createdAt: string;
  state?: string;
  completed?: number;
  totalTasks?: number;
  imageId?: string;
}

/** ProjectPage：公开接口类型，不包含后端内部执行字段。 */
export interface ProjectPage {
  items: Project[];
  page: number;
  total: number;
}

/** Task：公开接口类型，不包含后端内部执行字段。 */
export interface Task {
  attempt: number;
  cancelRequested: boolean;
  createdAt: string;
  error: string;
  errorKind: string;
  failures: number;
  id: string;
  imageId: string;
  nextRunAt: string;
  outputIds: string[];
  parameters: Parameters;
  planId: string;
  projectId?: string;
  providerUrl: string;
  remoteId: string;
  remoteState: string;
  revision: number;
  sessionId: string;
  state: string;
  title: string;
  updatedAt: string;
  videoId: string;
  workflow: Workflow;
}

/** TaskSpec：公开接口类型，不包含后端内部执行字段。 */
export interface TaskSpec {
  imageId: string;
  parameters?: Parameters;
  title: string;
  videoId: string;
  workflowId: string;
}

/** Workflow：公开接口类型，不包含后端内部执行字段。 */
export interface Workflow {
  createdAt: string;
  defaults: Parameters;
  enabled: boolean;
  id: string;
  mapping: Record<string, Mapping>;
  name: string;
  remoteId: string;
  revision: number;
  updatedAt: string;
}
