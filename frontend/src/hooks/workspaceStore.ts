/** 每个插件实例一份轻量状态；会话只决定草稿写入目标，不决定右侧导航和列表范围。 */
import type { WorkspaceState, WorkspaceStore } from "../../../contracts/types";
export function createWorkspaceStore(): WorkspaceStore {
  let state: WorkspaceState = {
    view: "motion-transfer",
    page: 1,
    filter: "",
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}
