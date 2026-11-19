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
const teacherToken = "teacher-scope-test-token";
const teacherTokenHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(teacherToken))).toString("hex");
const managerToken = "manager-scope-test-token";
const managerTokenHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(managerToken))).toString("hex");
const now = Date.now();
database.prepare(`INSERT INTO users (username,username_key,name,role,initials,password_hash,password_salt,status,must_change_password,created_at,updated_at) VALUES ('admin','admin','Admin Teste','Administrador','AT','x','x','active',0,?,?)`).run(now, now);
database.prepare(`INSERT INTO sessions (user_id,token_hash,expires_at,created_at) VALUES (1,?,?,?)`).run(tokenHash, now + 86400000, now);
database.prepare(`INSERT INTO users (username,username_key,name,role,initials,password_hash,password_salt,status,must_change_password,created_at,updated_at) VALUES ('professor','professor','Professor Teste','Professor','PT','x','x','active',0,?,?)`).run(now, now);
database.prepare(`INSERT INTO sessions (user_id,token_hash,expires_at,created_at) VALUES (2,?,?,?)`).run(teacherTokenHash, now + 86400000, now);
database.prepare(`INSERT INTO users (username,username_key,name,role,initials,password_hash,password_salt,status,must_change_password,created_at,updated_at) VALUES ('gestao','gestao','Gestão Teste','Coordenação','GT','x','x','active',0,?,?)`).run(now, now);
database.prepare(`INSERT INTO sessions (user_id,token_hash,expires_at,created_at) VALUES (3,?,?,?)`).run(managerTokenHash, now + 86400000, now);
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
database.prepare(`INSERT INTO subjects (name,education_stage,sort_order,status,created_by,created_at,updated_at) VALUES ('História','Ensino Fundamental',1,'active',1,?,?)`).run(now, now);
database.prepare(`INSERT INTO subjects (name,education_stage,sort_order,status,created_by,created_at,updated_at) VALUES ('Geografia','Ensino Fundamental',2,'active',1,?,?)`).run(now, now);
database.prepare(`INSERT INTO subjects (name,education_stage,sort_order,status,created_by,created_at,updated_at) VALUES ('Arte','Ensino Fundamental',3,'active',1,?,?)`).run(now, now);
database.prepare(`INSERT INTO subjects (name,education_stage,sort_order,status,created_by,created_at,updated_at) VALUES ('Ciências','Ensino Fundamental',4,'active',1,?,?)`).run(now, now);
database.prepare(`INSERT INTO classes (name,grade_level,shift,school_year,status,created_at,updated_at) VALUES ('5º Ano A','5º Ano','Matutino',2026,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO classes (name,grade_level,shift,school_year,status,created_at,updated_at) VALUES ('5º Ano B','5º Ano','Matutino',2026,'active',?,?)`).run(now, now);
database.prepare(`INSERT INTO teacher_assignments (user_id,education_stage,class_id,subject_id,school_year,can_attendance,can_agenda,status,created_by,created_at,updated_at) VALUES (2,'Ensino Fundamental',3,1,2026,1,1,'active',1,?,?)`).run(now, now);
database.prepare(`INSERT INTO teacher_assignments (user_id,education_stage,class_id,subject_id,school_year,can_attendance,can_agenda,status,created_by,created_at,updated_at) VALUES (2,'Ensino Fundamental',3,2,2026,1,1,'active',1,?,?)`).run(now, now);

const requestApi = async (pathname, options = {}, authToken = token) => {
  const response = await worker.fetch(new Request(`https://test.local${pathname}`, { ...options, headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json", ...(options.headers || {}) } }), { DB });
  const body = await response.json(); return { response, body };
};
const api = async (pathname, options = {}, authToken = token) => {
  const { response, body } = await requestApi(pathname, options, authToken); if (!response.ok) throw new Error(`${response.status}: ${body.error}`); return body;
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
const generalAgenda = await api("/api/agendas", { method: "POST", body: JSON.stringify({ date: "2026-11-01", classId: 1, subjectId: null, noAgenda: false, agenda: "", materials: [] }) });
assert.equal(generalAgenda.agenda.subject_id, null);
assert.equal(generalAgenda.agenda.content, "Agenda registrada");
const noAgenda = await api("/api/agendas", { method: "POST", body: JSON.stringify({ date: "2026-11-01", classId: 2, subjectId: null, noAgenda: true, agenda: "", materials: [] }) });
assert.equal(noAgenda.agenda.no_agenda, 1);
assert.equal(noAgenda.agenda.content, "Não tem agenda");
await assert.rejects(() => api("/api/agendas", { method: "POST", body: JSON.stringify({ date: "2026-11-01", classId: 2, subjectId: null, noAgenda: false, agenda: "Conteúdo conflitante", materials: [] }) }), /marcadas como ‘Não tem agenda’/);
const dailyStatus = await api("/api/agenda-status?date=2026-11-01");
assert.equal(dailyStatus.statuses.find(item => item.id === 1).status, "with_agenda");
assert.equal(dailyStatus.statuses.find(item => item.id === 2).status, "no_agenda");
assert.equal(dailyStatus.statuses.find(item => item.id === 3).status, "no_record");

const teacherSessionHistory = await api("/api/session", { headers: { "x-teacher-assignment-id": "1" } }, teacherToken);
assert.equal(teacherSessionHistory.user.assignments.length, 2);
assert.equal(teacherSessionHistory.user.assignment.subject_name, "História");
const teacherSessionGeography = await api("/api/session", { headers: { "x-teacher-assignment-id": "2" } }, teacherToken);
assert.equal(teacherSessionGeography.user.assignment.subject_name, "Geografia");
const teacherIndicatorAttempt = await requestApi("/api/indicators", { headers: { "x-teacher-assignment-id": "1" } }, teacherToken);
assert.equal(teacherIndicatorAttempt.response.status, 403);
const teacherOtherClassAttempt = await requestApi("/api/agendas", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ date: "2026-11-02", classId: 1, subjectId: 1, agenda: "Não autorizado", materials: [] }) }, teacherToken);
assert.equal(teacherOtherClassAttempt.response.status, 403);
const teacherOtherSubjectAttempt = await requestApi("/api/agendas", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ date: "2026-11-02", classId: 3, subjectId: 2, agenda: "Não autorizado", materials: [] }) }, teacherToken);
assert.equal(teacherOtherSubjectAttempt.response.status, 201);
const teacherMissingSubjectAttempt = await requestApi("/api/agendas", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ date: "2026-11-02", classId: 3, subjectId: null, agenda: "Não autorizado", materials: [] }) }, teacherToken);
assert.equal(teacherMissingSubjectAttempt.response.status, 403);
const teacherAgenda = await api("/api/agendas", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ date: "2026-11-02", classId: 3, subjectId: 1, agenda: "Conteúdo de História", materials: [] }) }, teacherToken);
assert.equal(teacherAgenda.agenda.subject_id, 1);
const multiSubjectAgenda = await api("/api/agendas", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ date: "2026-11-03", classId: 3, subjectIds: [1, 2], agenda: "Atividade interdisciplinar", materials: [] }) }, teacherToken);
assert.deepEqual(multiSubjectAgenda.agenda.subject_ids, [2, 1]);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM agenda_entries WHERE id=?`).get(multiSubjectAgenda.id).total, 1);
assert.equal(database.prepare(`SELECT COUNT(*) total FROM agenda_subjects WHERE agenda_id=?`).get(multiSubjectAgenda.id).total, 2);
const teacherAgendas = await api("/api/agendas", { headers: { "x-teacher-assignment-id": "1" } }, teacherToken);
assert.equal(teacherAgendas.agendas.every(entry => entry.class_id === 3 && entry.subject_ids.includes(1)), true);
const geographyAgendas = await api("/api/agendas", { headers: { "x-teacher-assignment-id": "2" } }, teacherToken);
assert.equal(geographyAgendas.agendas.some(entry => entry.id === multiSubjectAgenda.id && entry.subject_ids.includes(1) && entry.subject_ids.includes(2)), true);
const teacherAttendanceAttempt = await requestApi("/api/attendance", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ date: "2026-11-02", classId: 1, records: [] }) }, teacherToken);
assert.equal(teacherAttendanceAttempt.response.status, 403);
const teacherLibraryRead = await requestApi("/api/library-books", { headers: { "x-teacher-assignment-id": "1" } }, teacherToken);
assert.equal(teacherLibraryRead.response.status, 200);
const teacherLibraryWrite = await requestApi("/api/library-books", { method: "POST", headers: { "x-teacher-assignment-id": "1" }, body: JSON.stringify({ title: "Livro proibido", author: "Autor" }) }, teacherToken);
assert.equal(teacherLibraryWrite.response.status, 403);
database.prepare(`DELETE FROM teacher_assignments WHERE user_id=2`).run();
const subjects = (await api("/api/academic-config")).subjects;
const subjectId = name => subjects.find(item => item.name === name && item.education_stage === "Ensino Fundamental").id;
const createAssignment = (schoolYear, gradeLevel, subjectName) => api("/api/users/2/assignments", { method: "POST", body: JSON.stringify({ educationStage: "Ensino Fundamental", schoolYear, gradeLevel, subjectId: subjectId(subjectName), canAttendance: true, canAgenda: true }) });
const arts2026 = await createAssignment(2026, "5º Ano", "Arte");
const science2026 = await createAssignment(2026, "6º Ano", "Ciências");
const portuguese2026 = await createAssignment(2026, "2º Ano", "Português");
await createAssignment(2027, "5º Ano", "Ciências");
await createAssignment(2028, "6º Ano", "História");
await createAssignment(2029, "7º Ano", "Geografia");
const persistedUsers = await api("/api/users");
const persistedTeacher = persistedUsers.users.find(user => Number(user.id) === 2);
assert.ok(persistedTeacher, `Professor 2 ausente; IDs retornados: ${persistedUsers.users.map(user => user.id).join(",")}`);
assert.equal(persistedTeacher.assignments.filter(item => item.status === "active").length, 6);
assert.deepEqual([...new Set(persistedTeacher.assignments.map(item => item.school_year))].sort(), [2026, 2027, 2028, 2029]);
assert.equal(persistedTeacher.assignments.some(item => item.grade_level === "5º Ano" && item.school_year === 2026 && item.subject_name === "Arte"), true);
assert.equal(persistedTeacher.assignments.some(item => item.grade_level === "6º Ano" && item.school_year === 2026 && item.subject_name === "Ciências"), true);
assert.equal(persistedTeacher.assignments.some(item => item.grade_level === "2º Ano" && item.school_year === 2026 && item.subject_name === "Português"), true);
const teacherAfterLogin = await api("/api/session", { headers: { "x-teacher-assignment-id": String(science2026.id) } }, teacherToken);
assert.equal(teacherAfterLogin.user.assignments.length, 6);
assert.equal(teacherAfterLogin.user.assignment.subject_name, "Ciências");
await api(`/api/teacher-assignments/${science2026.id}`, { method: "PUT", body: JSON.stringify({ educationStage: "Ensino Fundamental", schoolYear: 2026, gradeLevel: "3º Ano", subjectId: subjectId("Matemática"), canAttendance: true, canAgenda: true, status: "active" }) });
await api(`/api/teacher-assignments/${arts2026.id}`, { method: "PUT", body: JSON.stringify({ status: "inactive" }) });
const reactivated = await createAssignment(2026, "5º Ano", "Arte");
assert.equal(reactivated.id, arts2026.id);
assert.equal(reactivated.reactivated, true);
assert.equal(database.prepare(`SELECT status FROM teacher_assignments WHERE id=?`).get(arts2026.id).status, "active");
const afterEdit = await api("/api/users");
const editedTeacher = afterEdit.users.find(user => Number(user.id) === 2);
assert.equal(editedTeacher.assignments.some(item => item.grade_level === "3º Ano" && item.subject_name === "Matemática"), true);
assert.equal(editedTeacher.assignments.some(item => item.id === portuguese2026.id && item.subject_name === "Português"), true);
const managerSession = await api("/api/session", {}, managerToken);
assert.equal(managerSession.user.role, "Gestão Escolar");
const managerUsers = await requestApi("/api/users", {}, managerToken);
assert.equal(managerUsers.response.status, 200);
assert.equal(managerUsers.body.users.find(user => user.username === "gestao").role, "Gestão Escolar");
const managerProgressions = await requestApi("/api/progressions", {}, managerToken);
assert.equal(managerProgressions.response.status, 200);
console.log("Integration tests passed: six persistent teacher assignments across 2026-2029, edit/reactivation without data loss, post-login recovery, strict server scope, progression/history, multidisciplinary agenda and read-only teacher library.");
