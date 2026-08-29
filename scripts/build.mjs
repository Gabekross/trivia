import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const out = join(process.cwd(), "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(process.cwd(), "src"), join(out, "src"), { recursive: true });
await cp(join(process.cwd(), "api"), join(out, "api"), { recursive: true });
await cp(join(process.cwd(), "scripts"), join(out, "scripts"), { recursive: true });
await cp(join(process.cwd(), "supabase"), join(out, "supabase"), { recursive: true });
await cp(join(process.cwd(), "README.md"), join(out, "README.md"));
await cp(join(process.cwd(), "package.json"), join(out, "package.json"));
await cp(join(process.cwd(), "vercel.json"), join(out, "vercel.json"));
await cp(join(process.cwd(), ".env.example"), join(out, ".env.example"));
console.log("Build complete: dist/");
