/** Typert 保留插件版本查询契约；业务请求使用具名同源 GET/POST 文件路由。 */
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { versionInfo } from "./version.ts";
declare module "@deepseek-ai/cordis" {
  interface Context {
    atelier: AtelierRemote;
  }
}
export class AtelierRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, "atelier");
  }
  /** 返回插件版本，不携带业务配置。 */
  @Remote async getVersion(): Promise<string> {
    return JSON.stringify(await versionInfo());
  }
}
