/** 串行事件轮询和代次控制，保证旧筛选响应不能覆盖新的页面快照。 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  Asset,
  Bridge,
  Event,
  Health,
  TaskPage,
  Workflow,
} from "../../../contracts/types";
import { message } from "../components/common";
export function useWorkspaceData(bridge: Bridge) {
  const { page, filter } = useSyncExternalStore(
    bridge.workspace.subscribe,
    bridge.workspace.getSnapshot,
  );
  const setPage = (page: number) => bridge.workspace.update({ page });
  const setFilter = (filter: string) => bridge.workspace.update({ filter });
  const [data, setData] = useState<TaskPage>({
      items: [],
      total: 0,
      page: 1,
      summary: {},
    }),
    [assets, setAssets] = useState<Asset[]>([]),
    [workflows, setWorkflows] = useState<Workflow[]>([]),
    [health, setHealth] = useState<Health>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const generation = useRef(0),
    locked = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [tasks, materials, definitions, status] = await Promise.all([
        bridge.request<TaskPage>("GET", `/tasks?page=${page}&state=${filter}`),
        bridge.request<Asset[]>("GET", "/assets"),
        bridge.request<Workflow[]>("GET", "/workflows"),
        bridge.request<Health>("GET", "/health"),
      ]);
      if (current !== generation.current) return;
      setData(tasks);
      setAssets(materials);
      setWorkflows(definitions);
      setHealth(status);
      setError("");
    } catch (e) {
      if (current === generation.current) setError(message(e));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [bridge, page, filter]);
  useEffect(() => {
    let stopped = false,
      cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    void refresh();
    async function poll() {
      try {
        const events = await bridge.request<Event[]>(
          "GET",
          `/events?after=${cursor}`,
        );
        if (stopped) return;
        if (events.length) {
          cursor = events[events.length - 1].seq;
          await refresh();
        }
      } catch {
        if (!stopped) await refresh();
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      generation.current++;
      clearTimeout(timer);
    };
  }, [bridge, refresh]);
  // 同步锁覆盖连续点击；返回布尔值让浮层仅在业务提交成功后关闭。
  const act = async (fn: () => Promise<unknown>) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return {
    data,
    assets,
    workflows,
    health,
    error,
    setError,
    busy,
    loading,
    page,
    setPage,
    filter,
    setFilter,
    refresh,
    act,
  };
}
