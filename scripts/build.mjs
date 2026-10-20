import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file));
let worker = read("worker/index.js").toString("utf8");
worker = worker
  .replace("__INDEX_HTML__", () => JSON.stringify(read("web/index.html").toString("utf8")))
  .replace("__STYLES__", () => JSON.stringify(read("web/styles.css").toString("utf8")))
  .replace("__APP_JS__", () => JSON.stringify(read("web/app.js").toString("utf8")))
  .replace("__ENROLLMENTS_JS__", () => JSON.stringify(read("web/enrollments.js").toString("utf8")))
  .replace("__LOGO_BASE64__", () => JSON.stringify(read("web/assets/logo-crescer.png").toString("base64")));

const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "server"), { recursive: true });
fs.mkdirSync(path.join(dist, ".openai"), { recursive: true });
fs.writeFileSync(path.join(dist, "server", "index.js"), worker);
fs.copyFileSync(path.join(root, ".openai", "hosting.json"), path.join(dist, ".openai", "hosting.json"));
console.log("Built Worker artifact in dist/server/index.js");
