import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "tests", "scripts", "load"];
const issues = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    if (entry.isFile() && /\.(mjs|css|html|md|sql)$/.test(entry.name)) await check(path);
  }
}

async function check(path) {
  const text = await readFile(path, "utf8");
  if (/\t/.test(text)) issues.push(`${path}: contains tabs`);
  if (/[ \t]+$/m.test(text)) issues.push(`${path}: contains trailing whitespace`);
  if (!text.endsWith("\n")) issues.push(`${path}: missing final newline`);
  if (path.endsWith(".mjs") && /console\.log/.test(text) && !path.includes("scripts") && !path.includes("load")) {
    issues.push(`${path}: unexpected console.log`);
  }
}

for (const root of roots) await walk(root);

if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log("Lint passed");
