/** 独立 Node 服务入口；关闭 HTTP 和调度器之后才释放数据库独占锁。 */
import { parseArgs } from "node:util";
import { Store } from "./storage/store.js";
import { assertLegacyStopped } from "./storage/legacy.js";
import { Service } from "./media/service.js";
import { Files } from "./media/files.js";
import { Runner } from "./scheduler/runner.js";
import { router } from "./httpapi/router.js";
const { values } = parseArgs({
  options: {
    listen: { type: "string", default: "127.0.0.1:8787" },
    data: { type: "string", default: ".runtime/default" },
    "parent-pipe": { type: "boolean", default: false },
  },
});
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
if (values["parent-pipe"]) {
  process.stdin.resume();
  process.stdin.once("end", () => stop.abort());
  process.stdin.once("error", () => stop.abort());
}
let store: Store | undefined;
try {
  await assertLegacyStopped(values.data);
  store = new Store(values.data);
  const service = new Service(store),
    files = new Files(service);
  await files.initialize();
  const app = await router(service, files, () => stop.abort());
  const address = new URL("http://" + values.listen);
  await app.listen({
    host: address.hostname.replace(/^\[|\]$/g, ""),
    port: Number(address.port || 80),
  });
  const worker = new Runner(service, files).run(stop.signal);
  const abort = new Promise<void>((done) => {
    if (stop.signal.aborted) done();
    else stop.signal.addEventListener("abort", () => done(), { once: true });
  });
  try {
    await Promise.race([worker, abort]);
  } finally {
    stop.abort();
    // 给进行中的 HTTP 请求十五秒收尾，超时关闭其连接；数据库仍须等所有调度写入结束。
    const timer = setTimeout(() => app.server.closeAllConnections(), 15000);
    timer.unref();
    try {
      await app.close();
      await worker;
    } finally {
      clearTimeout(timer);
    }
  }
} catch {
  console.error("Atelier 后端启动或调度失败，请检查配置、数据目录和端口");
  process.exitCode = 1;
} finally {
  store?.close();
  process.stdin.pause();
}
