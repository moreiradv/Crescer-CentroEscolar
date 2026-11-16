import fs from "node:fs";
const worker = fs.readFileSync("dist/server/index.js", "utf8");
const hosting = JSON.parse(fs.readFileSync("dist/.openai/hosting.json", "utf8"));
if (!worker.includes("export default")) throw new Error("Missing Worker default export");
if (["__INDEX_HTML__", "__STYLES__", "__APP_JS__", "__ENROLLMENTS_JS__", "__LIBRARY_JS__", "__REPORTS_JS__", "__PROGRESSIONS_JS__", "__AGENDA_STATUS_JS__", "__HELP_JS__", "__LOGO_BASE64__"].some(placeholder => worker.includes(placeholder))) throw new Error("Unresolved build placeholder");
if (hosting.static != null) throw new Error("Worker manifest must not declare static hosting");
if (hosting.d1 !== "DB") throw new Error("D1 binding DB is required");
console.log("Worker artifact validated");
