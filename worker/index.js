const INDEX_HTML = __INDEX_HTML__;
const STYLES = __STYLES__;
const APP_JS = __APP_JS__;
const LOGO_BASE64 = __LOGO_BASE64__;

const SESSION_COOKIE = "crescer_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 40000;
const ALLOWED_ROLES = new Set(["Coordenação", "Financeiro", "Administrador", "Professor"]);
const MANAGER_ROLES = new Set(["Administrador", "Coordenação"]);
const PEDAGOGICAL_ROLES = new Set(["Administrador", "Coordenação", "Professor"]);
const ALLOWED_ATTENDANCE = new Set(["present", "late", "justified", "absent"]);
const ALLOWED_SHIFTS = new Set(["Matutino", "Vespertino", "Integral", "Noturno"]);
const SEED_USERS = [
  { username: "Thays Barros", name: "Thays Barros", role: "Coordenação", initials: "TB", salt: "653627e933cad1080cc44235a32b238c", passwordHash: "78d416075865200487080d916a7536cc3b1839f10059941e8f40e09273af4aa0", previousHash: "0ac0ecd42796c22b3cd22f19670776913adc99b5d161ca1d9565011e7c2e2cac" },
  { username: "Thayane Barros", name: "Thayane Barros", role: "Financeiro", initials: "TB", salt: "4b5fd8796b6f2257674ba55378e3430b", passwordHash: "c95e5cb2cea878267157f84340d5973869f77c83bbc5d395fe937fcb5faceedd", previousHash: "e7485f084e03929bba8e87974f960ebfeae3720128a5a2d2c5556e84ed291764" },
  { username: "Estagiárias 2026", name: "Estagiárias 2026", role: "Administrador", initials: "E26", salt: "0c478a30216e83d6ec85e59d553722be", passwordHash: "e7fc80643488689442ab273a9ae0b605d102b18671c09affa41dadeface01468", previousHash: "bf067d61de3095873784573220019b1088f4ff4fb8ffd132f95237cb022ad362" },
];

function normalizeUsername(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
}

function safeUser(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role, initials: row.initials, status: row.status };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

function securityHeaders(contentType, cacheControl = "no-cache") {
  return {
    "content-type": contentType,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "SAMEORIGIN",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
  };
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return bytesToHex(bits);
}

async function hashToken(token) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function secureEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get("cookie") || "").split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf("=");
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

async function seedUsers(db) {
  const now = Date.now();
  await db.batch(SEED_USERS.map(user => db.prepare(`INSERT OR IGNORE INTO users (username, username_key, name, role, initials, password_hash, password_salt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(user.username, normalizeUsername(user.username), user.name, user.role, user.initials, user.passwordHash, user.salt, now, now)));
  await db.batch(SEED_USERS.map(user => db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE username_key = ? AND password_hash = ?`)
    .bind(user.passwordHash, user.salt, now, normalizeUsername(user.username), user.previousHash)));
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20000) throw new Error("Dados enviados são muito grandes.");
  return request.json();
}

async function getSession(request, db) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await db.prepare(`SELECT u.id, u.username, u.name, u.role, u.initials, u.status, s.id AS session_id, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1`).bind(tokenHash).first();
  if (!row || row.status !== "active" || row.expires_at <= Date.now()) {
    if (row?.session_id) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.session_id).run();
    return null;
  }
  return { ...safeUser(row), sessionId: row.session_id };
}

async function requireManager(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  if (!MANAGER_ROLES.has(user.role)) return { error: json({ error: "Apenas administração e coordenação podem realizar esta ação." }, 403) };
  return { user };
}

async function requirePedagogical(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  if (!PEDAGOGICAL_ROLES.has(user.role)) return { error: json({ error: "Seu perfil não possui acesso às funções pedagógicas." }, 403) };
  return { user };
}

async function requireUser(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  return { user };
}

function initialsFor(name) {
  return name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
}

async function audit(db, actorId, action, targetId, details) {
  await db.prepare(`INSERT INTO audit_logs (actor_user_id, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(actorId, action, targetId ?? null, details ?? null, Date.now()).run();
}

async function handleApi(request, env, path) {
  const db = env.DB;
  if (!db) return json({ error: "Banco de dados indisponível." }, 503);

  if (path === "/api/login" && request.method === "POST") {
    await seedUsers(db);
    const body = await readJson(request);
    const usernameKey = normalizeUsername(body.username);
    if (!usernameKey || typeof body.password !== "string") return json({ error: "Informe usuário e senha." }, 400);
    const user = await db.prepare(`SELECT * FROM users WHERE username_key = ? LIMIT 1`).bind(usernameKey).first();
    if (!user || user.status !== "active") return json({ error: "Usuário ou senha incorretos." }, 401);
    const candidateHash = await hashPassword(body.password, user.password_salt);
    if (!secureEqual(candidateHash, user.password_hash)) return json({ error: "Usuário ou senha incorretos." }, 401);
    const token = `${randomHex(32)}${randomHex(16)}`;
    const tokenHash = await hashToken(token);
    const now = Date.now();
    await db.prepare(`INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`)
      .bind(user.id, tokenHash, now + SESSION_SECONDS * 1000, now).run();
    await audit(db, user.id, "login", user.id, null);
    return json({ user: safeUser(user) }, 200, { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
  }

  if (path === "/api/session" && request.method === "GET") {
    const user = await getSession(request, db);
    return json({ user: user ? safeUser(user) : null }, user ? 200 : 401);
  }

  if (path === "/api/logout" && request.method === "POST") {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await hashToken(token)).run();
    return json({ ok: true }, 200, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
  }

  if (path === "/api/summary" && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
    const [classes, students, agendas, teachers, attendanceToday, recordedClasses, trendResult] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS total FROM classes WHERE status = 'active'`),
      db.prepare(`SELECT COUNT(*) AS total FROM students WHERE status = 'active'`),
      db.prepare(`SELECT COUNT(*) AS total FROM agenda_entries`),
      db.prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'Professor' AND status = 'active'`),
      db.prepare(`SELECT status, COUNT(*) AS total FROM attendance_records WHERE attendance_date = ? GROUP BY status`).bind(today),
      db.prepare(`SELECT COUNT(DISTINCT class_id) AS total FROM attendance_records WHERE attendance_date = ?`).bind(today),
      db.prepare(`SELECT attendance_date, COUNT(*) AS total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended FROM attendance_records GROUP BY attendance_date ORDER BY attendance_date DESC LIMIT 7`),
    ]);
    const attendance = { present: 0, late: 0, justified: 0, absent: 0 };
    attendanceToday.results.forEach(row => { attendance[row.status] = Number(row.total) || 0; });
    const totalAttendance = Object.values(attendance).reduce((sum, value) => sum + value, 0);
    const attendancePercent = totalAttendance ? Math.round(((attendance.present + attendance.late) / totalAttendance) * 1000) / 10 : 0;
    return json({
      classes: classes.results[0]?.total || 0,
      students: students.results[0]?.total || 0,
      agendas: agendas.results[0]?.total || 0,
      teachers: teachers.results[0]?.total || 0,
      attendance,
      attendanceTotal: totalAttendance,
      attendancePercent,
      pendingClasses: Math.max(0, Number(classes.results[0]?.total || 0) - Number(recordedClasses.results[0]?.total || 0)),
      trend: trendResult.results.reverse().map(row => ({ date: row.attendance_date, total: Number(row.total), percent: row.total ? Math.round((Number(row.attended) / Number(row.total)) * 1000) / 10 : 0 })),
    });
  }

  if (path === "/api/classes" && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    const result = await db.prepare(`SELECT c.*, COUNT(s.id) AS student_count FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active' GROUP BY c.id ORDER BY c.school_year DESC, c.name`).all();
    return json({ classes: result.results });
  }

  if (path === "/api/classes" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const name = String(body.name || "").trim(); const gradeLevel = String(body.gradeLevel || "").trim(); const shift = String(body.shift || ""); const schoolYear = Number(body.schoolYear); const teacherName = String(body.teacherName || "").trim(); const now = Date.now();
    if (name.length < 2 || gradeLevel.length < 2 || !ALLOWED_SHIFTS.has(shift) || !Number.isInteger(schoolYear) || schoolYear < 2020 || schoolYear > 2100) return json({ error: "Preencha nome, etapa, turno e ano letivo corretamente." }, 400);
    try {
      const result = await db.prepare(`INSERT INTO classes (name, grade_level, shift, school_year, teacher_name, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
        .bind(name, gradeLevel, shift, schoolYear, teacherName || null, auth.user.id, now, now).run();
      await audit(db, auth.user.id, "class_created", result.meta.last_row_id, `${name} • ${schoolYear}`);
      return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Já existe uma turma com esse nome neste ano letivo." }, 409);
      throw error;
    }
  }

  const classMatch = path.match(/^\/api\/classes\/(\d+)$/);
  if (classMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const id = Number(classMatch[1]); const body = await readJson(request); const name = String(body.name || "").trim(); const gradeLevel = String(body.gradeLevel || "").trim(); const shift = String(body.shift || ""); const schoolYear = Number(body.schoolYear); const teacherName = String(body.teacherName || "").trim();
    if (name.length < 2 || gradeLevel.length < 2 || !ALLOWED_SHIFTS.has(shift) || !Number.isInteger(schoolYear)) return json({ error: "Preencha os dados da turma corretamente." }, 400);
    try {
      const result = await db.prepare(`UPDATE classes SET name = ?, grade_level = ?, shift = ?, school_year = ?, teacher_name = ?, status = ?, updated_at = ? WHERE id = ?`)
        .bind(name, gradeLevel, shift, schoolYear, teacherName || null, body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
      if (!result.meta.changes) return json({ error: "Turma não encontrada." }, 404);
      await audit(db, auth.user.id, "class_updated", id, name); return json({ ok: true });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Já existe uma turma com esse nome neste ano letivo." }, 409);
      throw error;
    }
  }

  if (classMatch && request.method === "DELETE") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const id = Number(classMatch[1]); const count = await db.prepare(`SELECT COUNT(*) AS total FROM students WHERE class_id = ?`).bind(id).first();
    if (count.total > 0) return json({ error: "Mova ou remova os alunos antes de excluir a turma." }, 400);
    await db.prepare(`DELETE FROM classes WHERE id = ?`).bind(id).run(); await audit(db, auth.user.id, "class_deleted", id, null); return json({ ok: true });
  }

  if (path === "/api/students" && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    const classId = Number(new URL(request.url).searchParams.get("class_id") || 0);
    const statement = classId
      ? db.prepare(`SELECT s.*, c.name AS class_name, c.shift AS class_shift FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.class_id = ? ORDER BY s.name`).bind(classId)
      : db.prepare(`SELECT s.*, c.name AS class_name, c.shift AS class_shift FROM students s LEFT JOIN classes c ON c.id = s.class_id ORDER BY s.name`);
    const result = await statement.all(); return json({ students: result.results });
  }

  if (path === "/api/students" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const registration = String(body.registration || "").trim(); const name = String(body.name || "").trim(); const birthDate = String(body.birthDate || "").trim(); const guardianName = String(body.guardianName || "").trim(); const guardianPhone = String(body.guardianPhone || "").trim(); const classId = Number(body.classId); const now = Date.now();
    if (registration.length < 2 || name.length < 3 || !Number.isInteger(classId) || classId < 1) return json({ error: "Informe matrícula, nome e turma do aluno." }, 400);
    const klass = await db.prepare(`SELECT id FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first(); if (!klass) return json({ error: "Selecione uma turma ativa." }, 400);
    try {
      const result = await db.prepare(`INSERT INTO students (registration, name, birth_date, guardian_name, guardian_phone, class_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
        .bind(registration, name, birthDate || null, guardianName || null, guardianPhone || null, classId, auth.user.id, now, now).run();
      await audit(db, auth.user.id, "student_created", result.meta.last_row_id, `${registration} • ${name}`); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Essa matrícula já está cadastrada." }, 409);
      throw error;
    }
  }

  const studentMatch = path.match(/^\/api\/students\/(\d+)$/);
  if (studentMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const id = Number(studentMatch[1]); const body = await readJson(request); const registration = String(body.registration || "").trim(); const name = String(body.name || "").trim(); const classId = Number(body.classId);
    if (registration.length < 2 || name.length < 3 || !Number.isInteger(classId) || classId < 1) return json({ error: "Informe matrícula, nome e turma do aluno." }, 400);
    try {
      const result = await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = ?, status = ?, updated_at = ? WHERE id = ?`)
        .bind(registration, name, String(body.birthDate || "").trim() || null, String(body.guardianName || "").trim() || null, String(body.guardianPhone || "").trim() || null, classId, body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
      if (!result.meta.changes) return json({ error: "Aluno não encontrado." }, 404);
      await audit(db, auth.user.id, "student_updated", id, `${registration} • ${name}`); return json({ ok: true });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Essa matrícula já está cadastrada." }, 409);
      throw error;
    }
  }

  if (studentMatch && request.method === "DELETE") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const id = Number(studentMatch[1]); const existing = await db.prepare(`SELECT registration, name FROM students WHERE id = ?`).bind(id).first(); if (!existing) return json({ error: "Aluno não encontrado." }, 404);
    await db.prepare(`DELETE FROM students WHERE id = ?`).bind(id).run(); await audit(db, auth.user.id, "student_deleted", id, `${existing.registration} • ${existing.name}`); return json({ ok: true });
  }

  if (path === "/api/agendas" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const result = await db.prepare(`SELECT a.*, c.name AS class_name, u.name AS created_by_name FROM agenda_entries a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).all();
    return json({ agendas: result.results.map(row => ({ ...row, materials: JSON.parse(row.materials || "[]") })) });
  }

  if (path === "/api/agendas" && request.method === "POST") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const subject = String(body.subject || "").trim(); const content = String(body.content || "").trim(); const status = String(body.status || "Pendente"); const materials = Array.isArray(body.materials) ? body.materials.map(String).slice(0, 20) : []; const now = Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1 || subject.length < 2 || content.length < 3) return json({ error: "Preencha data, turma, disciplina e conteúdo." }, 400);
    const result = await db.prepare(`INSERT INTO agenda_entries (agenda_date, class_id, subject, content, activity, materials, status, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(date, classId, subject, content, String(body.activity || "").trim() || null, JSON.stringify(materials), status, String(body.notes || "").trim() || null, auth.user.id, now, now).run();
    await audit(db, auth.user.id, "agenda_created", result.meta.last_row_id, content); return json({ ok: true, id: result.meta.last_row_id }, 201);
  }

  const agendaMatch = path.match(/^\/api\/agendas\/(\d+)$/);
  if (agendaMatch && request.method === "PUT") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const id = Number(agendaMatch[1]); const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const subject = String(body.subject || "").trim(); const content = String(body.content || "").trim(); const materials = Array.isArray(body.materials) ? body.materials.map(String).slice(0, 20) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1 || subject.length < 2 || content.length < 3) return json({ error: "Preencha data, turma, disciplina e conteúdo." }, 400);
    const result = await db.prepare(`UPDATE agenda_entries SET agenda_date = ?, class_id = ?, subject = ?, content = ?, activity = ?, materials = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .bind(date, classId, subject, content, String(body.activity || "").trim() || null, JSON.stringify(materials), String(body.status || "Pendente"), String(body.notes || "").trim() || null, Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Agenda não encontrada." }, 404);
    await audit(db, auth.user.id, "agenda_updated", id, content); return json({ ok: true });
  }

  if (agendaMatch && request.method === "DELETE") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const id = Number(agendaMatch[1]); const existing = await db.prepare(`SELECT content FROM agenda_entries WHERE id = ?`).bind(id).first();
    if (!existing) return json({ error: "Agenda não encontrada." }, 404);
    await db.prepare(`DELETE FROM agenda_entries WHERE id = ?`).bind(id).run(); await audit(db, auth.user.id, "agenda_deleted", id, existing.content); return json({ ok: true });
  }

  if (path === "/api/attendance" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams; const date = String(params.get("date") || ""); const classId = Number(params.get("class_id") || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1) return json({ error: "Informe data e turma." }, 400);
    const result = await db.prepare(`SELECT s.id AS student_id, s.registration, s.name, COALESCE(a.status, 'present') AS status, COALESCE(a.notes, '') AS notes FROM students s LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = ? WHERE s.class_id = ? AND s.status = 'active' ORDER BY s.name`).bind(date, classId).all();
    return json({ records: result.results });
  }

  if (path === "/api/attendance" && request.method === "POST") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const records = Array.isArray(body.records) ? body.records : []; const now = Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1 || records.length > 300 || records.some(item => !Number.isInteger(Number(item.studentId)) || !ALLOWED_ATTENDANCE.has(String(item.status)))) return json({ error: "Os dados de frequência são inválidos." }, 400);
    if (records.length) await db.batch(records.map(item => db.prepare(`INSERT INTO attendance_records (attendance_date, class_id, student_id, status, notes, recorded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attendance_date, student_id) DO UPDATE SET class_id = excluded.class_id, status = excluded.status, notes = excluded.notes, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at`)
      .bind(date, classId, Number(item.studentId), String(item.status), String(item.notes || "").trim() || null, auth.user.id, now, now)));
    await audit(db, auth.user.id, "attendance_saved", classId, `${date} • ${records.length} alunos`); return json({ ok: true, count: records.length });
  }

  if (path === "/api/indicators" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const [distributionResult, classResult, riskResult] = await db.batch([
      db.prepare(`SELECT status, COUNT(*) AS total FROM attendance_records GROUP BY status`),
      db.prepare(`SELECT c.id, c.name, COUNT(DISTINCT s.id) AS student_count, COUNT(a.id) AS record_count, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active' LEFT JOIN attendance_records a ON a.student_id = s.id WHERE c.status = 'active' GROUP BY c.id ORDER BY CASE WHEN COUNT(a.id) = 0 THEN 0 ELSE CAST(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id) END DESC, c.name`),
      db.prepare(`SELECT s.id, s.name, s.registration, c.name AS class_name, COUNT(a.id) AS record_count, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended, SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absences FROM students s JOIN classes c ON c.id = s.class_id LEFT JOIN attendance_records a ON a.student_id = s.id WHERE s.status = 'active' GROUP BY s.id HAVING COUNT(a.id) > 0 AND (CAST(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id)) < 0.85 ORDER BY (CAST(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id)) ASC LIMIT 12`),
    ]);
    const distribution = { present: 0, late: 0, justified: 0, absent: 0 };
    distributionResult.results.forEach(row => { distribution[row.status] = Number(row.total) || 0; });
    const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
    const overallPercent = total ? Math.round(((distribution.present + distribution.late) / total) * 1000) / 10 : 0;
    const classRanking = classResult.results.map(row => ({ ...row, percent: row.record_count ? Math.round((Number(row.attended) / Number(row.record_count)) * 1000) / 10 : 0 }));
    const riskStudents = riskResult.results.map(row => ({ ...row, percent: Math.round((Number(row.attended) / Number(row.record_count)) * 1000) / 10 }));
    return json({ distribution, total, overallPercent, classRanking, riskStudents });
  }

  if (path === "/api/audit" && request.method === "GET") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const result = await db.prepare(`SELECT a.id, a.action, a.details, a.created_at, u.name AS actor_name, u.initials AS actor_initials FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 300`).all();
    return json({ entries: result.results });
  }

  if (path === "/api/system/reset" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    await db.batch([
      db.prepare(`DELETE FROM attendance_records`),
      db.prepare(`DELETE FROM agenda_entries`),
      db.prepare(`DELETE FROM students`),
      db.prepare(`DELETE FROM classes`),
      db.prepare(`DELETE FROM audit_logs`),
    ]);
    return json({ ok: true, message: "Dados pedagógicos e histórico foram zerados." });
  }

  if (path === "/api/users" && request.method === "GET") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const result = await db.prepare(`SELECT id, username, name, role, initials, status, created_at, updated_at FROM users ORDER BY CASE role WHEN 'Administrador' THEN 1 WHEN 'Coordenação' THEN 2 ELSE 3 END, name`).all();
    return json({ users: result.results });
  }

  if (path === "/api/users" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const role = String(body.role || "");
    const password = String(body.password || "");
    if (name.length < 3 || username.length < 3 || password.length < 8 || !ALLOWED_ROLES.has(role)) return json({ error: "Preencha nome, usuário, perfil e uma senha com pelo menos 8 caracteres." }, 400);
    const salt = randomHex(16); const passwordHash = await hashPassword(password, salt); const now = Date.now();
    try {
      const result = await db.prepare(`INSERT INTO users (username, username_key, name, role, initials, password_hash, password_salt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(username, normalizeUsername(username), name, role, initialsFor(name), passwordHash, salt, body.status === "inactive" ? "inactive" : "active", now, now).run();
      await audit(db, auth.user.id, "user_created", result.meta.last_row_id, username);
      return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Esse nome de usuário já está em uso." }, 409);
      throw error;
    }
  }

  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const targetId = Number(userMatch[1]); const existing = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(targetId).first();
    if (!existing) return json({ error: "Usuário não encontrado." }, 404);
    const body = await readJson(request); const name = String(body.name || "").trim(); const username = String(body.username || "").trim(); const role = String(body.role || ""); const status = body.status === "inactive" ? "inactive" : "active";
    if (name.length < 3 || username.length < 3 || !ALLOWED_ROLES.has(role)) return json({ error: "Preencha nome, usuário e perfil corretamente." }, 400);
    if (existing.role === "Administrador" && (role !== "Administrador" || status !== "active")) {
      const count = await db.prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'Administrador' AND status = 'active'`).first();
      if (count.total <= 1) return json({ error: "O sistema precisa manter pelo menos um administrador ativo." }, 400);
    }
    try {
      if (body.password) {
        if (String(body.password).length < 8) return json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, 400);
        const salt = randomHex(16); const passwordHash = await hashPassword(String(body.password), salt);
        await db.prepare(`UPDATE users SET username = ?, username_key = ?, name = ?, role = ?, initials = ?, status = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`)
          .bind(username, normalizeUsername(username), name, role, initialsFor(name), status, passwordHash, salt, Date.now(), targetId).run();
      } else {
        await db.prepare(`UPDATE users SET username = ?, username_key = ?, name = ?, role = ?, initials = ?, status = ?, updated_at = ? WHERE id = ?`)
          .bind(username, normalizeUsername(username), name, role, initialsFor(name), status, Date.now(), targetId).run();
      }
      await audit(db, auth.user.id, "user_updated", targetId, username); return json({ ok: true });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Esse nome de usuário já está em uso." }, 409);
      throw error;
    }
  }

  if (userMatch && request.method === "DELETE") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const targetId = Number(userMatch[1]); if (targetId === auth.user.id) return json({ error: "Você não pode remover o usuário que está usando agora." }, 400);
    const existing = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(targetId).first(); if (!existing) return json({ error: "Usuário não encontrado." }, 404);
    if (existing.role === "Administrador" && existing.status === "active") {
      const count = await db.prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'Administrador' AND status = 'active'`).first();
      if (count.total <= 1) return json({ error: "O sistema precisa manter pelo menos um administrador ativo." }, 400);
    }
    await audit(db, auth.user.id, "user_deleted", targetId, existing.username);
    await db.prepare(`DELETE FROM users WHERE id = ?`).bind(targetId).run();
    return json({ ok: true });
  }

  return json({ error: "Rota não encontrada." }, 404);
}

function decodeBase64(value) {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url.pathname);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/" || url.pathname === "/index.html") return new Response(INDEX_HTML, { headers: securityHeaders("text/html; charset=utf-8") });
      if (url.pathname === "/styles.css") return new Response(STYLES, { headers: securityHeaders("text/css; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/app.js") return new Response(APP_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/assets/logo-crescer.png") return new Response(decodeBase64(LOGO_BASE64), { headers: securityHeaders("image/png", "public, max-age=86400") });
      return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
    } catch (error) {
      console.error("Request failed", error);
      return url.pathname.startsWith("/api/") ? json({ error: "Erro interno. Tente novamente." }, 500) : new Response("Internal error", { status: 500 });
    }
  },
};
