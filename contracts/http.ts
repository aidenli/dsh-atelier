/** Host 和浏览器共用响应解码，HTTP 文本错误不能作为 JSON 业务数据解析。 */
export async function readJSON(response: Response): Promise<unknown> {
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      response.ok
        ? `后端返回格式异常（HTTP ${response.status}），请检查服务地址与版本`
        : `后端请求失败（HTTP ${response.status}），请检查服务地址并重启新版后端`,
    );
  }
  if (!response.ok) {
    const reason =
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string"
        ? value.error
        : "后端请求失败";
    throw new Error(`${reason}（HTTP ${response.status}）`);
  }
  return value;
}
