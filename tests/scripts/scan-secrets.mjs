/** 扫描 Git 待提交内容，只报告位置，不把可疑凭据写入日志。 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
const working = process.argv.includes("--working-tree");
const files = [
  ...new Set(
    execFileSync(
      "git",
      working
        ? [
            "ls-files",
            "-co",
            "--exclude-standard",
            "-z",
            "--",
            existsSync("backend/package.json") ? "." : "dsh-atelier",
            ".github",
          ]
        : ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
].filter((file) => !working || existsSync(file));
let failures = 0;
const patterns = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,})/,
  /(?:apiKey|api_key|api key|token|密钥|令牌)["'\s:=：]+["']?[a-f0-9]{28,}/i,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
];
for (const file of files) {
  const content = working
    ? readFileSync(file, "utf8")
    : execFileSync("git", ["show", `:${file}`], {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      });
  content.split(/\r?\n/).forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) {
      console.error(`可疑凭据：${file}:${index + 1}`);
      failures++;
    }
  });
}
if (failures) process.exitCode = 1;
else
  console.log(
    `已扫描 ${files.length} 个${working ? "项目工作树" : "暂存"}文件，未发现匹配的凭据模式；提交前仍需核对文件清单。`,
  );
