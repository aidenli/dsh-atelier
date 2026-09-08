/** 业务实体复用 OpenAPI 生成类型；本文件只声明浏览器适配层和分页组合。 */
import type { Asset, Task, Workflow } from "./generated";
export type { Parameters, Workflow, Asset, Task, Event } from "./generated";
export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  summary: Record<string, number>;
}
export interface ConnectionSettings {
  backendUrl: string;
  mode: "managed" | "external";
}
/** 平台适配层提供稳定快照订阅，React 业务页面不导入 DSH 服务。 */
export interface ThemeSource {
  getSnapshot(): {
    active: { colorScheme: "light" | "dark"; tokens: Record<string, string> };
    revision: number;
  };
  subscribe(listener: () => void): () => void;
}
export interface Health {
  apiVersion?: number;
  capabilities?: string[];
}
/** 页面依赖的最小桥接能力；Host 实现不进入 React 构建。 */
export interface Bridge {
  workspace: WorkspaceStore;
  openSession(sessionId: string): Promise<void>;
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  fileUrl(id: string, download?: boolean): string;
  upload(sessionId: string, file: File): Promise<Asset>;
  select(sessionId: string, assets: Asset[]): Promise<void>;
  connection(settings?: ConnectionSettings): Promise<ConnectionSettings>;
}
/** 工作台状态属于插件实例，避免 DSH 按 session 重建插槽时丢失右侧导航。 */
export interface WorkspaceState {
  view: string;
  task?: string;
  workflow?: Workflow;
  page: number;
  filter: string;
}
export interface WorkspaceStore {
  getSnapshot(): WorkspaceState;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<WorkspaceState>): void;
}
