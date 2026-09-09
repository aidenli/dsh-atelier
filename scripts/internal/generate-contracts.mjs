/** OpenAPI 是公开契约源；生成 TypeScript，并支持只读一致性检查，不依赖 Go。 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schema = JSON.parse(
  await readFile(resolve(root, "contracts/openapi.json"), "utf8"),
);
const type = (s) =>
  s.$ref
    ? s.$ref.split("/").at(-1)
    : s.type === "array"
      ? `(${type(s.items)})[]`
      : s.type === "object"
        ? s.additionalProperties
          ? `Record<string, ${type(s.additionalProperties)}>`
          : "Record<string, unknown>"
        : s.type === "integer" || s.type === "number"
          ? "number"
          : s.type === "boolean"
            ? "boolean"
            : "string";
let output =
  "// 自动生成：node scripts/internal/generate-contracts.mjs；公开字段以 openapi.json 为准。\n";
for (const [name, s] of Object.entries(schema.components.schemas).sort(
  ([a], [b]) => a.localeCompare(b),
)) {
  output += `\n/** ${name}：公开接口类型，不包含后端内部执行字段。 */\nexport interface ${name} {\n`;
  for (const [key, value] of Object.entries(s.properties))
    output += `  ${key}${s.required?.includes(key) ? "" : "?"}: ${type(value)};\n`;
  output += "}\n";
}
const prettier = createRequire(resolve(root, "frontend/package.json"))(
  "prettier",
);
output = await prettier.format(output, { parser: "typescript" });
const path = resolve(root, "contracts/generated.ts");
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== output)
    throw new Error("公开类型与 OpenAPI 不一致，请重新生成");
  console.log("公开契约一致性检查通过");
} else await writeFile(path, output);
