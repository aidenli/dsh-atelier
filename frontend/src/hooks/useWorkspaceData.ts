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
        bridge.get<TaskPage>(`/listTasks?page=${page}&state=${filter}`),
        bridge.get<Asset[]>("/listAssets"),
        bridge.get<Workflow[]>("/listWorkflows"),
        bridge.get<Health>("/getHealth"),
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
    /**
     * 全局事件消费者只负责推进游标和触发刷新，不直接修改任务状态。
     * 这样多个页面共享同一个事件流，主动操作仍通过 act() 立即刷新，
     * 事件轮询则负责补齐后台调度、重启恢复和其他会话产生的变化。
     */
    let stopped = false;
    const cursorKey = "atelier:event-cursor";
    let cursor =
      Number.parseInt(localStorage.getItem(cursorKey) || "0", 10) || 0;
    let timer: ReturnType<typeof setTimeout>;
    void refresh();
    async function poll() {
      try {
        const events = await bridge.get<Event[]>(`/listEvents?after=${cursor}`);
        if (stopped) return;
        if (events.length) {
          cursor = events[events.length - 1].seq;
          localStorage.setItem(cursorKey, String(cursor));
          window.dispatchEvent(
            new CustomEvent("atelier:events", { detail: events }),
          );
          await refresh();
        }
      } catch {
        // 事件接口暂时不可用时不刷新完整业务快照；否则每 2 秒会同时
        // 重复请求任务、素材、工作流和健康状态，形成错误状态下的请求风暴。
        // 下一轮仍使用原游标重试，恢复后会补齐期间积累的事件。
      }
      // listEvents 是插件的全局增量入口，固定两秒查询一次。
      // 任务是否运行、当前页面是否隐藏，都不能改变事件游标的推进节奏；
      // 页面数据只在收到新事件后刷新，避免各页面重新建立自己的轮询周期。
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
