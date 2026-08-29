import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const roots = ["src", "tests", "scripts", "load"];
const files = [];
const check = promisify(execFile);

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
  }
}

for (const root of roots) await walk(root);

for (const file of files) {
  const text = await readFile(file, "utf8");
  const exported = [...text.matchAll(/export (?:class|function|const) ([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  for (const name of exported) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error(`${file}: invalid export ${name}`);
  }
  await check(process.execPath, ["--check", file]);
}

console.log(`Typecheck passed (${files.length} modules checked)`);
