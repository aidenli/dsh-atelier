/** 收集前后端依赖的许可原文，随构建产物分发，不包含本机绝对路径。 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notices = new Map();
async function collect(dir, name) {
  const files = await readdir(dir).catch(() => []);
  const texts = [];
  for (const file of files.filter((v) =>
    /^(licen[sc]e|copying|notice)(\.|$)/i.test(v),
  )) {
    try {
      texts.push(await readFile(resolve(dir, file), "utf8"));
    } catch {
      /* 许可同名目录不当作文本文件。 */
    }
  }
  if (texts.length) notices.set(name, texts.join("\n\n"));
}
for (const project of ["frontend", "backend"]) {
  const store = resolve(root, `${project}/node_modules/.pnpm`);
  for (const entry of await readdir(store)) {
    const modules = resolve(store, entry, "node_modules");
    for (const name of await readdir(modules).catch(() => [])) {
      const names = name.startsWith("@")
        ? (await readdir(resolve(modules, name))).map((v) => `${name}/${v}`)
        : [name];
      for (const pkg of names) {
        const dir = resolve(modules, pkg);
        try {
          const manifest = JSON.parse(
            await readFile(resolve(dir, "package.json"), "utf8"),
          );
          await collect(dir, `${manifest.name}@${manifest.version}`);
        } catch {
          /* pnpm 管理项或非包目录跳过。 */
        }
      }
    }
  }
}
await writeFile(
  resolve(root, "plugin/lib/THIRD_PARTY_NOTICES.txt"),
  "DSH Atelier third-party notices\nIncludes installed build dependencies for completeness.\n\n" +
    [...notices]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, text]) => `===== ${name} =====\n${text}`)
      .join("\n\n"),
);
