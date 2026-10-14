import { mkdir, writeFile } from "node:fs/promises";

await mkdir(new URL("../server-dist", import.meta.url), { recursive: true });
await writeFile(
  new URL("../server-dist/package.json", import.meta.url),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);
