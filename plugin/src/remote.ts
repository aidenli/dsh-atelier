/** Typert 对外只暴露结构稳定的 JSON 命令；业务字段由后端 HTTP 服务校验。 */
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Backend } from "./backend.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    atelier: AtelierRemote;
  }
}

/** AtelierRemote 负责跨进程传输，不复制后端的任务执行或重试规则。 */
export class AtelierRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly backend: Backend,
  ) {
    super(ctx, "atelier");
  }
  /**
   * 执行页面 JSON 命令，失败通过 Typert Remote 错误返回。
   * @param command 包含 method、path、body 的 JSON 字符串，或连接配置命令。
   * @returns 不含密钥的业务 JSON。
   */
  @Remote
  async request(command: string): Promise<string> {
    if (command.length > 1_000_000) throw new Error("命令过大");
    const value = JSON.parse(command) as {
      method: string;
      path: string;
      body?: unknown;
    };
    if (value.path === "/connection")
      return JSON.stringify(
        await this.backend.connection(
          value.method === "PUT"
            ? (value.body as Parameters<Backend["connection"]>[0])
            : undefined,
        ),
      );
    return JSON.stringify(
      await this.backend.request(value.method, value.path, value.body),
    );
  }
}
