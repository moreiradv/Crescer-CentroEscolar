import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";

const database = new DatabaseSync(":memory:");
for (const file of fs.readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join("drizzle", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) database.exec(statement);
}

const numberValue = value => typeof value === "bigint" ? Number(value) : value;
const normalizeRow = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numberValue(value)]));
class D1Statement {
  constructor(sql) { this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return normalizeRow(database.prepare(this.sql).get(...this.values)); }
  all() { return { results: database.prepare(this.sql).all(...this.values).map(normalizeRow) }; }
  run() { const result = database.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; }
}
const DB = { prepare: sql => new D1Statement(sql), batch: async statements => Promise.all(statements.map(statement => /^(SELECT|PRAGMA)/i.test(statement.sql.trim()) ? statement.all() : statement.run())) };

const token = "progression-test-token";
const tokenHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
const now = Date.now();
database.prepare(`INSERT INTO users (username,username_key,name,role,initials,password_hash,password_salt,status,must_change_password,created_at,updated_at) VALUES ('admin','admin','Admin Teste','Administrador','AT','x','x','active',0,?,?)`).run(now, now);
database.prepare(`INSERT INTO sessions (user_id,token_hash,expires_at,created_at) VALUES (1,?,?,?)`).run(tokenHash, now + 86400000, now);
database.prepare(`INSERT INTO classes (name,grade_level,shift,school_year,status,created_at,updated_at) VALUES ('Infantil V','Infantil V','Matutino',2026,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO classes (name,grade_level,shift,school_year,status,created_at,updated_at) VALUES ('1º Ano','1º Ano','Matutino',2027,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO students (registration,name,birth_date,guardian_name,guardian_phone,class_id,status,created_at,updated_at) VALUES ('NAD-001','Nadine','2021-03-10','Responsável','63999999999',1,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO student_class_history (student_id,class_id,school_year,grade_level_snapshot,class_name_snapshot,result_status,joined_at,created_at,updated_at) VALUES (1,1,2026,'Infantil V','Infantil V','active',?,?,?)`).run(now, now, now);
database.prepare(`INSERT INTO attendance_records (attendance_date,class_id,student_id,school_year,scope_key,status,created_at,updated_at) VALUES ('2026-10-01',1,1,2026,'class','present',?,?)`).run(now, now);
database.prepare(`INSERT INTO agenda_entries (agenda_date,class_id,subject,content,materials,status,school_year,created_at,updated_at) VALUES ('2026-10-01',1,'Linguagem','Atividade 2026','[]','Concluída',2026,?,?)`).run(now, now);
database.prepare(`INSERT INTO classes (name,grade_level,shift,school_year,status,created_at,updated_at) VALUES ('6º Ano A','6º Ano','Vespertino',2026,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO classes (name,grade_level,shift,school_year,status,created_at,updated_at) VALUES ('6º Ano Retenção','6º Ano','Vespertino',2027,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO students (registration,name,birth_date,guardian_name,guardian_phone,class_id,status,created_at,updated_at) VALUES ('BRU-002','Bruno','2014-05-10','Responsável','63999999999',3,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO student_class_history (student_id,class_id,school_year,grade_level_snapshot,class_name_snapshot,result_status,joined_at,created_at,updated_at) VALUES (2,3,2026,'6º Ano','6º Ano A','active',?,?,?)`).run(now, now, now);

const api = async (pathname, options = {}) => {
  const response = await worker.fetch(new Request(`https://test.local${pathname}`, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) } }), { DB });
  const body = await response.json(); if (!response.ok) throw new Error(`${response.status}: ${body.error}`); return body;
};

const prepared = await api("/api/progressions");
assert.equal(prepared.rules.length, 11);
const nadineCandidate = prepared.candidates.find(candidate => candidate.name === "Nadine");
assert.equal(nadineCandidate.targetYear, 2027);
assert.equal(nadineCandidate.suggestedClassId, 2);
const confirmed = await api("/api/progressions/confirm", { method: "POST", body: JSON.stringify({ studentId: 1, classId: 2, resultStatus: "completed" }) });
assert.equal(confirmed.enrollmentPrepared, true);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM students WHERE name='Nadine'`).get().total, 1);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM student_class_history WHERE student_id=1`).get().total, 2);
assert.equal(database.prepare(`SELECT class_id FROM students WHERE id=1`).get().class_id, 2);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM attendance_records WHERE student_id=1 AND class_id=1 AND school_year=2026`).get().total, 1);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM agenda_entries WHERE class_id=1 AND school_year=2026`).get().total, 1);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM enrollments WHERE student_id=1 AND class_id=2 AND school_year=2027 AND status='draft'`).get().total, 1);
const folders = await api("/api/students");
assert.equal(folders.students.filter(student => student.id === 1).length, 2);
assert.deepEqual(folders.students.filter(student => student.id === 1).map(student => student.school_year).sort(), [2026, 2027]);
await api("/api/students/2/promote", { method: "POST", body: JSON.stringify({ classId: 4, resultStatus: "retained", notes: "Retenção confirmada pela Administração" }) });
assert.equal(database.prepare(`SELECT COUNT(*) total FROM students WHERE name='Bruno'`).get().total, 1);
assert.equal(database.prepare(`SELECT result_status FROM student_class_history WHERE student_id=2 AND class_id=3`).get().result_status, "retained");
assert.equal(database.prepare(`SELECT COUNT(*) total FROM student_class_history WHERE student_id=2`).get().total, 2);
const after = await api("/api/progressions");
assert.equal(after.candidates.some(candidate => candidate.id === 1 && candidate.targetYear === 2027), false);
console.log("Progression integration test passed: unique students, annual folders, preserved 2026 records, prepared 2027 enrollment and retention exception.");
