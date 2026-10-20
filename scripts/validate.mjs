import fs from "node:fs";
const worker = fs.readFileSync("dist/server/index.js", "utf8");
const hosting = JSON.parse(fs.readFileSync("dist/.openai/hosting.json", "utf8"));
if (!worker.includes("export default")) throw new Error("Missing Worker default export");
if (worker.includes("__INDEX_HTML__") || worker.includes("__APP_JS__") || worker.includes("__ENROLLMENTS_JS__")) throw new Error("Unresolved build placeholder");
if (hosting.static != null) throw new Error("Worker manifest must not declare static hosting");
if (hosting.d1 !== "DB") throw new Error("D1 binding DB is required");
console.log("Worker artifact validated");
