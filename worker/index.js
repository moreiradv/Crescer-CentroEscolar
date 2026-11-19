const INDEX_HTML = __INDEX_HTML__;
const STYLES = __STYLES__;
const APP_JS = __APP_JS__;
const ENROLLMENTS_JS = __ENROLLMENTS_JS__;
const LIBRARY_JS = __LIBRARY_JS__;
const REPORTS_JS = __REPORTS_JS__;
const PROGRESSIONS_JS = __PROGRESSIONS_JS__;
const AGENDA_STATUS_JS = __AGENDA_STATUS_JS__;
const HELP_JS = __HELP_JS__;
const LOGO_BASE64 = __LOGO_BASE64__;

const SESSION_COOKIE = "crescer_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 40000;
const EMAIL_VERIFICATION_SECONDS = 60 * 60 * 24;
const PASSWORD_RESET_SECONDS = 60 * 30;
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const RECOVERY_MAX_ATTEMPTS = 5;
const ALLOWED_EXTERNAL_ORIGINS = new Set([
  "https://moreiradv.github.io",
  "https://crescer-escola-web.vercel.app",
]);
const ALLOWED_ROLES = new Set(["Coordenação", "Financeiro", "Administrador", "Professor"]);
const MANAGER_ROLES = new Set(["Administrador", "Coordenação", "Gestão Escolar"]);
const PEDAGOGICAL_ROLES = new Set(["Administrador", "Coordenação", "Gestão Escolar", "Professor"]);
const ENROLLMENT_ROLES = new Set(["Administrador", "Coordenação", "Gestão Escolar", "Financeiro"]);
const ALLOWED_ATTENDANCE = new Set(["present", "late", "justified", "absent"]);
const ALLOWED_SHIFTS = new Set(["Matutino", "Vespertino", "Integral", "Noturno"]);

function normalizeUsername(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
}

const internalRole = role => role === "Gestão Escolar" ? "Coordenação" : role;
const displayRole = role => role === "Coordenação" ? "Gestão Escolar" : role;

function safeUser(row) {
  return { id: row.id, username: row.username, name: row.name, role: displayRole(row.role), initials: row.initials, status: row.status, email: row.email || null, pendingEmail: row.pending_email || null, emailVerified: !!row.email_verified_at, emailVerifiedAt: row.email_verified_at || null, mustChangePassword: !!(row.must_change_password ?? row.mustChangePassword), assignments: row.assignments || [], assignment: row.assignment || null };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

function withCors(response, request) {
  const origin = request.headers.get("origin") || "";
  if (!ALLOWED_EXTERNAL_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", "content-type, authorization, x-teacher-assignment-id");
  headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function securityHeaders(contentType, cacheControl = "no-cache") {
  return {
    "content-type": contentType,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "SAMEORIGIN",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'self'",
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

function bootstrapUsers(env) {
  try {
    const parsed = JSON.parse(env.BOOTSTRAP_USERS_JSON || "{}");
    return Array.isArray(parsed.users) ? parsed.users.map(user => ({ ...user, role: internalRole(user.role) })).filter(user => user.username && user.passwordHash && user.salt && ALLOWED_ROLES.has(user.role)) : [];
  } catch {
    return [];
  }
}

async function seedUsers(db, env) {
  const users = bootstrapUsers(env);
  if (!users.length) return;
  const now = Date.now();
  await db.batch(users.map(user => db.prepare(`INSERT OR IGNORE INTO users (username, username_key, name, role, initials, password_hash, password_salt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(user.username, normalizeUsername(user.username), user.name, user.role, user.initials, user.passwordHash, user.salt, now, now)));
  await db.batch(users.filter(user => user.previousHash).map(user => db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE username_key = ? AND password_hash = ?`)
    .bind(user.passwordHash, user.salt, now, normalizeUsername(user.username), user.previousHash)));
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20000) throw new Error("Dados enviados são muito grandes.");
  return request.json();
}

async function getSession(request, db) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await db.prepare(`SELECT u.id, u.username, u.name, u.role, u.initials, u.status, u.email, u.pending_email, u.email_verified_at, u.must_change_password, s.id AS session_id, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1`).bind(tokenHash).first();
  if (!row || row.status !== "active" || row.expires_at <= Date.now()) {
    if (row?.session_id) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.session_id).run();
    return null;
  }
  return { ...safeUser(row), sessionId: row.session_id };
}

async function teacherAssignments(db, userId) {
  const result = await db.prepare(`SELECT ta.*, c.name AS class_name, c.grade_level, c.shift, s.name AS subject_name FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id LEFT JOIN subjects s ON s.id = ta.subject_id WHERE ta.user_id = ? AND ta.status = 'active' ORDER BY ta.school_year DESC, c.name, s.name`).bind(userId).all();
  return result.results;
}

async function enrichUser(db, user, assignmentId = 0) {
  if (!user || user.role !== "Professor") return user;
  const assignments = await teacherAssignments(db, user.id);
  const assignment = assignments.find(item => Number(item.id) === Number(assignmentId)) || assignments[0] || null;
  return { ...user, assignments, assignment };
}

function teacherScopeViolation(user, classId, subjectId = null, capability = "agenda") {
  if (user.role !== "Professor") return null;
  const assignment = user.assignment;
  if (!assignment || assignment.status !== "active") return "Sua conta de professor ainda não possui uma turma ativa vinculada.";
  if (Number(assignment.class_id) !== Number(classId)) return "Sua conta não possui acesso a esta turma.";
  if (Number(assignment.school_year) !== Number(user.requestedSchoolYear || assignment.school_year)) return "Sua conta não possui acesso a este ano letivo.";
  if (capability === "agenda" && !assignment.can_agenda) return "A Agenda Escolar não está habilitada para esta conta.";
  if (capability === "attendance" && !assignment.can_attendance) return "A frequência não está habilitada para esta conta.";
  if (assignment.subject_id && Number(assignment.subject_id) !== Number(subjectId || 0)) return "Sua conta não possui acesso a esta disciplina.";
  return null;
}

async function validatedTeacherAssignment(db, body, actorId = null) {
  let classId = Number(body.classId); const stage = String(body.educationStage || ""); const subjectId = Number(body.subjectId) || null;
  const schoolYear = Number(body.schoolYear); const requestedGrade = officialGrade(body.gradeLevel);
  if (!DEFAULT_SUBJECTS[stage]) return { error: "Selecione a etapa de ensino do professor." };
  if (!Number.isInteger(classId) || classId <= 0) {
    if (!OFFICIAL_SCHOOL_YEARS.includes(schoolYear) || !requestedGrade) return { error: "Selecione um ano letivo e uma série oficiais." };
    const rows = (await db.prepare(`SELECT * FROM classes WHERE school_year = ? ORDER BY id`).bind(schoolYear).all()).results;
    let existing = rows.find(item => gradeKey(item.name) === gradeKey(requestedGrade));
    if (!existing) {
      const now = Date.now();
      const created = await db.prepare(`INSERT INTO classes (name, grade_level, shift, school_year, teacher_name, status, created_by, created_at, updated_at) VALUES (?, ?, 'Matutino', ?, NULL, 'active', ?, ?, ?)`)
        .bind(requestedGrade, requestedGrade, schoolYear, actorId, now, now).run();
      existing = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(created.meta.last_row_id).first();
    }
    classId = Number(existing.id);
  }
  const klass = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first(); if (!klass) return { error: "Série não encontrada." };
  const actualStage = educationStageFor(`${klass.grade_level} ${klass.name}`); if (actualStage !== stage) return { error: "A etapa selecionada não corresponde à turma." };
  if (!OFFICIAL_SCHOOL_YEARS.includes(Number(klass.school_year))) return { error: "O ano letivo deve ser 2026, 2027, 2028 ou 2029." };
  if (!officialGrade(klass.grade_level || klass.name)) return { error: "A série selecionada não pertence à estrutura oficial da escola." };
  if (!subjectId) return { error: "Selecione a disciplina do professor." };
  const subject = await db.prepare(`SELECT id FROM subjects WHERE id = ? AND education_stage = ? AND status = 'active'`).bind(subjectId, stage).first(); if (!subject) return { error: "A disciplina não pertence à etapa de ensino selecionada." };
  return { classId, stage, subjectId, schoolYear: Number(klass.school_year), canAttendance: body.canAttendance === false ? 0 : 1, canAgenda: body.canAgenda === false ? 0 : 1 };
}

function temporaryPassword() {
  const bytes = new Uint8Array(4); crypto.getRandomValues(bytes); return `Crescer@${[...bytes].map(value => value % 10).join("")}`;
}

function passwordChangeRequired(user) {
  return user?.mustChangePassword ? { error: json({ error: "Troque sua senha temporária para continuar.", code: "PASSWORD_CHANGE_REQUIRED" }, 403) } : null;
}

async function requireManager(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  if (!MANAGER_ROLES.has(user.role)) return { error: json({ error: "Apenas Administração e Gestão Escolar podem realizar esta ação." }, 403) };
  return { user };
}

async function requireAdmin(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  if (user.role !== "Administrador") return { error: json({ error: "Esta função é exclusiva da Administração." }, 403) };
  return { user };
}

async function requirePedagogical(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  if (!PEDAGOGICAL_ROLES.has(user.role)) return { error: json({ error: "Seu perfil não possui acesso às funções pedagógicas." }, 403) };
  return { user: await enrichUser(db, user, Number(request.headers.get("x-teacher-assignment-id") || 0)) };
}

async function requireUser(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  return { user: await enrichUser(db, user, Number(request.headers.get("x-teacher-assignment-id") || 0)) };
}

async function requireEnrollment(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  if (!ENROLLMENT_ROLES.has(user.role)) return { error: json({ error: "Seu perfil não possui acesso às matrículas." }, 403) };
  return { user };
}

function initialsFor(name) {
  return name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
}

async function audit(db, actorId, action, targetId, details) {
  await db.prepare(`INSERT INTO audit_logs (actor_user_id, action, target_user_id, details, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(actorId, action, targetId ?? null, details ?? null, Date.now()).run();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function publicAppOrigin(env) {
  return String(env.PUBLIC_APP_ORIGIN || "https://crescer-escola-web.vercel.app").replace(/\/$/, "");
}

async function sendTransactionalEmail(env, { to, subject, html, text, idempotencyKey }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("O serviço de e-mail ainda não está configurado.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${env.RESEND_API_KEY}`, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.message || "O provedor não confirmou o envio do e-mail.");
  return result;
}

async function emailInUse(db, emailKey, userId = 0) {
  return db.prepare(`SELECT id FROM users WHERE id != ? AND (email_key = ? OR pending_email_key = ?) LIMIT 1`).bind(Number(userId) || 0, emailKey, emailKey).first();
}

async function requestEmailVerification(db, env, { userId, email, actorId = null, username = "" }) {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new Error("Informe um endereço de e-mail válido.");
  if (await emailInUse(db, normalized, userId)) throw new Error("Este e-mail já está vinculado a outra conta.");
  const previous = await db.prepare(`SELECT pending_email, pending_email_key FROM users WHERE id = ?`).bind(userId).first();
  if (!previous) throw new Error("Usuário não encontrado.");
  const token = `${randomHex(32)}${randomHex(16)}`, tokenHash = await hashToken(token), now = Date.now();
  await db.batch([
    db.prepare(`UPDATE users SET pending_email = ?, pending_email_key = ?, updated_at = ? WHERE id = ?`).bind(normalized, normalized, now, userId),
    db.prepare(`INSERT INTO auth_tokens (user_id, type, token_hash, expires_at, consumed_at, created_at) VALUES (?, 'email_verification', ?, ?, NULL, ?)`).bind(userId, tokenHash, now + EMAIL_VERIFICATION_SECONDS * 1000, now),
  ]);
  const link = `${publicAppOrigin(env)}/?verify_email=${encodeURIComponent(token)}`;
  try {
    await sendTransactionalEmail(env, {
      to: normalized,
      subject: "Confirme seu e-mail no EduClass",
      text: `Confirme o e-mail da conta ${username || "EduClass"} acessando: ${link}. O link expira em 24 horas.`,
      html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2 style="color:#0a2463">Confirmação de e-mail — EduClass</h2><p>Confirme o endereço de recuperação da conta <strong>${escapeHtml(username)}</strong>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2457e6;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Confirmar meu e-mail</a></p><p>Este link expira em 24 horas. Se você não esperava esta mensagem, avise a Gestão Escolar.</p></div>`,
      idempotencyKey: `email-verification/${userId}/${tokenHash.slice(0, 16)}`,
    });
  } catch (error) {
    await db.batch([
      db.prepare(`DELETE FROM auth_tokens WHERE token_hash = ?`).bind(tokenHash),
      db.prepare(`UPDATE users SET pending_email = ?, pending_email_key = ?, updated_at = ? WHERE id = ?`).bind(previous.pending_email || null, previous.pending_email_key || null, Date.now(), userId),
    ]);
    throw error;
  }
  await db.prepare(`UPDATE auth_tokens SET consumed_at = ? WHERE user_id = ? AND type = 'email_verification' AND consumed_at IS NULL AND token_hash != ?`).bind(Date.now(), userId, tokenHash).run();
  await audit(db, actorId, "user_email_verification_sent", userId, normalized);
  return { email: normalized, status: "pending" };
}

async function recoveryRateLimited(db, identifierHash, ipHash) {
  const cutoff = Date.now() - RECOVERY_WINDOW_MS;
  const result = await db.prepare(`SELECT COUNT(*) AS total FROM recovery_requests WHERE created_at >= ? AND (identifier_hash = ? OR ip_hash = ?)`).bind(cutoff, identifierHash, ipHash).first();
  return Number(result?.total || 0) >= RECOVERY_MAX_ATTEMPTS;
}

const OFFICIAL_SCHOOL_YEARS = [2026, 2027, 2028, 2029];
const DEFAULT_GRADES = ["Infantil 3", "Infantil 4", "Infantil 5", "1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano", "6º Ano", "7º Ano"];
const DEFAULT_SUBJECTS = {
  "Educação Infantil": ["Matemática", "Natureza e Sociedade", "Educação Física", "Ensino Religioso", "Linguagem", "Arte"],
  "Ensino Fundamental": ["Inglês", "Português", "Matemática", "Ciências", "Geografia", "Ensino Religioso", "História", "Arte"],
};
const DEFAULT_COMPONENTS = { "Matemática": ["Oficina de Negócios"], "Ensino Religioso": ["Cidadania, Moral e Ética"], "Linguagem": ["Português", "Caligrafia"] };
const educationStageFor = value => /infantil|educação infantil/i.test(String(value || "")) ? "Educação Infantil" : "Ensino Fundamental";
const gradeKey = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/infantil\s+iii\b/g, "infantil 3").replace(/infantil\s+iv\b/g, "infantil 4").replace(/infantil\s+v\b/g, "infantil 5").replace(/[ºª°]/g, "").replace(/\s+/g, " ").trim();
const officialGrade = value => DEFAULT_GRADES.find(grade => gradeKey(grade) === gradeKey(value)) || null;

async function ensureAcademicData(db, userId) {
  const now = Date.now(); const operations = [];
  for (const [stage, names] of Object.entries(DEFAULT_SUBJECTS)) names.forEach((name, index) => operations.push(db.prepare(`INSERT OR IGNORE INTO subjects (name, education_stage, sort_order, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)`)
    .bind(name, stage, index + 1, userId, now, now)));
  await db.batch(operations);
  const subjects = (await db.prepare(`SELECT id, name, education_stage FROM subjects`).all()).results;
  const componentOps = [];
  for (const subject of subjects) if (subject.education_stage === "Educação Infantil" && DEFAULT_COMPONENTS[subject.name]) DEFAULT_COMPONENTS[subject.name].forEach((name, index) => componentOps.push(db.prepare(`INSERT OR IGNORE INTO subject_components (subject_id, name, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`)
    .bind(subject.id, name, index + 1, now, now)));
  if (componentOps.length) await db.batch(componentOps);
  await db.prepare(`INSERT OR IGNORE INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, joined_at, promoted_by, created_at, updated_at)
    SELECT s.id, c.id, c.school_year, c.grade_level, c.name, 'active', s.created_at, s.created_by, s.created_at, s.updated_at FROM students s JOIN classes c ON c.id = s.class_id`).run();
}

async function academicCatalog(db, userId) {
  await ensureAcademicData(db, userId);
  const [subjects, components] = await db.batch([
    db.prepare(`SELECT * FROM subjects ORDER BY education_stage, sort_order, name`),
    db.prepare(`SELECT * FROM subject_components ORDER BY subject_id, sort_order, name`),
  ]);
  return { subjects: subjects.results.map(subject => ({ ...subject, components: components.results.filter(component => Number(component.subject_id) === Number(subject.id)) })) };
}

async function agendaContext(db, classId, subjectId) {
  const [klass, subject] = await Promise.all([
    db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first(),
    db.prepare(`SELECT * FROM subjects WHERE id = ? AND status = 'active'`).bind(subjectId).first(),
  ]);
  if (!klass || !subject) return null;
  const educationStage = educationStageFor(`${klass.grade_level} ${klass.name}`);
  return subject.education_stage === educationStage ? { klass, subject, educationStage } : null;
}

async function optionalAgendaContext(db, classId, subjectId) {
  if (subjectId) return agendaContext(db, classId, subjectId);
  const klass = await db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first();
  return klass ? { klass, subject: null, educationStage: educationStageFor(`${klass.grade_level} ${klass.name}`) } : null;
}

function agendaSubjectIds(body) {
  const values = Array.isArray(body.subjectIds) ? body.subjectIds : [body.subjectId];
  return [...new Set(values.map(Number).filter(value => Number.isInteger(value) && value > 0))];
}

async function agendaSubjectsForRows(db, rows) {
  if (!rows.length) return rows;
  const links = (await db.prepare(`SELECT axs.agenda_id, s.id, s.name FROM agenda_subjects axs JOIN subjects s ON s.id = axs.subject_id ORDER BY s.name`).all()).results;
  return rows.map(row => {
    const subjects = links.filter(link => Number(link.agenda_id) === Number(row.id)).map(link => ({ id: Number(link.id), name: link.name }));
    if (!subjects.length && row.subject_id) subjects.push({ id: Number(row.subject_id), name: row.current_subject_name || row.subject || "Disciplina" });
    return { ...row, subject_ids: subjects.map(subject => subject.id), subject_names: subjects.map(subject => subject.name), subjects, subject: subjects.map(subject => subject.name).join(", ") || row.subject || "Sem disciplina", materials: JSON.parse(row.materials || "[]") };
  });
}

async function validateAgendaSubjects(db, user, classId, subjectIds) {
  const klass = await db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first();
  if (!klass) return { error: "Turma não encontrada." };
  const stage = educationStageFor(`${klass.grade_level} ${klass.name}`);
  let assignments = [];
  if (user.role === "Professor") {
    assignments = (user.assignments || []).filter(item => item.status === "active" && Number(item.class_id) === classId && Number(item.school_year) === Number(klass.school_year) && Number(item.can_agenda));
    if (!assignments.length) return { error: "Sua conta não possui acesso à Agenda desta turma.", status: 403 };
    if (stage === "Ensino Fundamental" && !subjectIds.length) return { error: "Selecione pelo menos uma disciplina autorizada.", status: 403 };
  }
  const available = (await db.prepare(`SELECT id, name, education_stage FROM subjects WHERE status = 'active'`).all()).results;
  const selected = subjectIds.map(id => available.find(subject => Number(subject.id) === id)).filter(Boolean);
  if (selected.length !== subjectIds.length || selected.some(subject => subject.education_stage !== stage)) return { error: "Uma das disciplinas escolhidas não pertence à etapa da turma." };
  if (user.role === "Professor") {
    const permitted = new Set(assignments.map(item => Number(item.subject_id)).filter(Boolean));
    if (subjectIds.some(id => !permitted.has(id))) return { error: "Sua conta não possui acesso a uma das disciplinas selecionadas.", status: 403 };
  }
  return { klass, stage, selected };
}

async function replaceAgendaSubjects(db, agendaId, subjectIds, now = Date.now()) {
  const operations = [db.prepare(`DELETE FROM agenda_subjects WHERE agenda_id = ?`).bind(agendaId)];
  for (const subjectId of subjectIds) operations.push(db.prepare(`INSERT INTO agenda_subjects (agenda_id, subject_id, created_at) VALUES (?, ?, ?)`).bind(agendaId, subjectId, now));
  await db.batch(operations);
}

async function conflictingAgenda(db, date, classId, subjectIds, exceptId = 0) {
  const candidates = (await db.prepare(`SELECT id, subject_id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? AND no_agenda = 0 AND id != ?`).bind(date, classId, exceptId).all()).results;
  if (!candidates.length) return null;
  const links = (await db.prepare(`SELECT agenda_id, subject_id FROM agenda_subjects`).all()).results;
  return candidates.find(candidate => {
    const existingIds = links.filter(link => Number(link.agenda_id) === Number(candidate.id)).map(link => Number(link.subject_id));
    if (!existingIds.length && candidate.subject_id) existingIds.push(Number(candidate.subject_id));
    return subjectIds.length ? existingIds.some(id => subjectIds.includes(id)) : existingIds.length === 0;
  }) || null;
}

const LIBRARY_IMAGE_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
const libraryKey = value => normalizeUsername(value).replace(/[^a-z0-9 ]/g, "").trim();
const nullableText = (value, max = 5000) => String(value || "").trim().slice(0, max) || null;

async function handleLibraryApi(request, env, path) {
  if (!path.startsWith("/api/library-books")) return null;
  const db = env.DB;
  const coverMatch = path.match(/^\/api\/library-books\/(\d+)\/cover$/);
  if (coverMatch) return json({ error: "A Biblioteca utiliza somente registros textuais e não aceita imagens de capa." }, 410);

  if (coverMatch && request.method === "GET") {
    const book = await db.prepare(`SELECT cover_key, cover_mime FROM library_books WHERE id = ?`).bind(Number(coverMatch[1])).first();
    if (!book?.cover_key || !env.BUCKET) return new Response("Capa não cadastrada", { status: 404 });
    const object = await env.BUCKET.get(book.cover_key); if (!object) return new Response("Capa não encontrada", { status: 404 });
    return new Response(object.body, { headers: { "content-type": book.cover_mime || object.httpMetadata?.contentType || "application/octet-stream", "cache-control": "public, max-age=3600", "etag": object.httpEtag || "" } });
  }

  if (coverMatch && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    if (!env.BUCKET) return json({ error: "O armazenamento de capas ainda não está disponível." }, 503);
    const id = Number(coverMatch[1]); const existing = await db.prepare(`SELECT title, cover_key FROM library_books WHERE id = ?`).bind(id).first();
    if (!existing) return json({ error: "Livro não encontrado." }, 404);
    const mime = String(request.headers.get("content-type") || "").split(";")[0].toLowerCase(); const extension = LIBRARY_IMAGE_TYPES.get(mime);
    if (!extension) return json({ error: "Envie uma capa em JPG, PNG ou WebP." }, 400);
    const bytes = await request.arrayBuffer(); if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) return json({ error: "A capa deve ter no máximo 5 MB." }, 400);
    const key = `library-covers/${id}/${randomHex(10)}.${extension}`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
    await db.prepare(`UPDATE library_books SET cover_key = ?, cover_mime = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(key, mime, auth.user.id, Date.now(), id).run();
    if (existing.cover_key && existing.cover_key !== key) await env.BUCKET.delete(existing.cover_key);
    await audit(db, auth.user.id, "library_cover_updated", id, existing.title); return json({ ok: true });
  }

  if (path === "/api/library-books" && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    if (!MANAGER_ROLES.has(auth.user.role) && auth.user.role !== "Professor") return json({ error: "Seu perfil não possui acesso à Biblioteca." }, 403);
    const search = String(new URL(request.url).searchParams.get("search") || "").trim();
    const result = search
      ? await db.prepare(`SELECT b.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM library_books b LEFT JOIN users creator ON creator.id = b.created_by LEFT JOIN users updater ON updater.id = b.updated_by WHERE b.title LIKE ? OR COALESCE(b.author, '') LIKE ? ORDER BY b.title LIMIT 500`).bind(`%${search}%`, `%${search}%`).all()
      : await db.prepare(`SELECT b.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM library_books b LEFT JOIN users creator ON creator.id = b.created_by LEFT JOIN users updater ON updater.id = b.updated_by ORDER BY b.title LIMIT 500`).all();
    return json({ books: result.results });
  }

  const bookMatch = path.match(/^\/api\/library-books\/(\d+)$/);
  if (bookMatch && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    if (!MANAGER_ROLES.has(auth.user.role) && auth.user.role !== "Professor") return json({ error: "Seu perfil não possui acesso à Biblioteca." }, 403);
    const book = await db.prepare(`SELECT b.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM library_books b LEFT JOIN users creator ON creator.id = b.created_by LEFT JOIN users updater ON updater.id = b.updated_by WHERE b.id = ?`).bind(Number(bookMatch[1])).first();
    return book ? json({ book }) : json({ error: "Livro não encontrado." }, 404);
  }

  if ((path === "/api/library-books" && request.method === "POST") || (bookMatch && request.method === "PUT")) {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const id = bookMatch ? Number(bookMatch[1]) : 0; const title = String(body.title || "").trim().slice(0, 240); const author = nullableText(body.author, 240); const quantity = body.quantity === "" || body.quantity == null ? null : Number(body.quantity); const now = Date.now();
    if (title.length < 2) return json({ error: "Informe o nome do livro." }, 400);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000)) return json({ error: "Informe uma quantidade de exemplares válida." }, 400);
    const duplicate = await db.prepare(`SELECT id FROM library_books WHERE title_key = ? AND author_key = ? AND id != ? LIMIT 1`).bind(libraryKey(title), libraryKey(author), id).first();
    if (duplicate) return json({ error: "Já existe um livro com o mesmo nome e autor no acervo." }, 409);
    const values = [title, libraryKey(title), author, libraryKey(author), nullableText(body.synopsis, 12000), nullableText(body.publisher, 240), null, nullableText(body.ageRange, 120), quantity, null];
    if (id) {
      const result = await db.prepare(`UPDATE library_books SET title = ?, title_key = ?, author = ?, author_key = ?, synopsis = ?, publisher = ?, publication_year = ?, age_range = ?, quantity = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...values, auth.user.id, now, id).run();
      if (!result.meta.changes) return json({ error: "Livro não encontrado." }, 404);
      const saved = await db.prepare(`SELECT * FROM library_books WHERE id = ?`).bind(id).first(); if (!saved) return json({ error: "O banco não confirmou a atualização do livro." }, 500);
      await audit(db, auth.user.id, "library_book_updated", id, title); return json({ ok: true, id, book: saved });
    }
    const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "America/Araguaina" }).format(new Date()); const code = `BIB-${year}-${randomHex(4).toUpperCase()}`;
    const result = await db.prepare(`INSERT INTO library_books (accession_code, title, title_key, author, author_key, synopsis, publisher, publication_year, age_range, quantity, notes, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(code, ...values, auth.user.id, auth.user.id, now, now).run();
    const savedId = Number(result.meta.last_row_id); if (!savedId || Number(result.meta.changes || 0) !== 1) return json({ error: "O banco não confirmou o salvamento do livro." }, 500);
    const saved = await db.prepare(`SELECT * FROM library_books WHERE id = ?`).bind(savedId).first(); if (!saved) return json({ error: "O livro não pôde ser recuperado após o salvamento." }, 500);
    await audit(db, auth.user.id, "library_book_created", savedId, title); return json({ ok: true, id: savedId, accessionCode: code, book: saved }, 201);
  }

  if (bookMatch && request.method === "DELETE") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const id = Number(bookMatch[1]); const existing = await db.prepare(`SELECT title, cover_key FROM library_books WHERE id = ?`).bind(id).first(); if (!existing) return json({ error: "Livro não encontrado." }, 404);
    if (existing.cover_key && env.BUCKET) await env.BUCKET.delete(existing.cover_key);
    await db.prepare(`DELETE FROM library_books WHERE id = ?`).bind(id).run(); await audit(db, auth.user.id, "library_book_deleted", id, existing.title); return json({ ok: true });
  }

  return json({ error: "Rota da Biblioteca não encontrada." }, 404);
}
const moneyCents = value => {
  if (Number.isInteger(value)) return Math.max(0, value);
  const normalized = String(value ?? "0").trim().replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
};

async function ensureDefaultGrades(db, userId) {
  const now = Date.now();
  await db.batch(DEFAULT_GRADES.map(name => db.prepare(`INSERT OR IGNORE INTO grades (name, enrollment_fee_cents, monthly_fee_cents, status, created_by, created_at, updated_at) VALUES (?, 0, 0, 'active', ?, ?, ?)`)
    .bind(name, userId, now, now)));
}

async function enrollmentCatalog(db, userId) {
  await ensureDefaultGrades(db, userId);
  const [grades, books, uniforms, classesResult] = await db.batch([
    db.prepare(`SELECT * FROM grades ORDER BY id`),
    db.prepare(`SELECT b.*, g.name AS grade_name FROM books b JOIN grades g ON g.id = b.grade_id ORDER BY g.id, b.name`),
    db.prepare(`SELECT * FROM uniform_items ORDER BY name, size`),
    db.prepare(`SELECT id, name, grade_level, shift, school_year, status FROM classes ORDER BY school_year DESC, name`),
  ]);
  return { grades: grades.results, books: books.results, uniforms: uniforms.results, classes: classesResult.results };
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).map(item => ({ id: Number(item.id), quantity: Number(item.quantity) })).filter(item => Number.isInteger(item.id) && item.id > 0 && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 50);
}

async function pricedEnrollmentItems(db, gradeId, bookSelection, uniformSelection) {
  const books = cleanItems(bookSelection); const uniforms = cleanItems(uniformSelection);
  const bookRows = books.length ? (await db.prepare(`SELECT * FROM books WHERE id IN (${books.map(() => "?").join(",")}) AND status = 'active'`).bind(...books.map(item => item.id)).all()).results : [];
  const uniformRows = uniforms.length ? (await db.prepare(`SELECT * FROM uniform_items WHERE id IN (${uniforms.map(() => "?").join(",")}) AND status = 'active'`).bind(...uniforms.map(item => item.id)).all()).results : [];
  if (bookRows.length !== books.length || uniformRows.length !== uniforms.length) throw new Error("Um dos produtos selecionados não está mais disponível.");
  const items = [];
  for (const selected of books) {
    const product = bookRows.find(row => Number(row.id) === selected.id);
    if (Number(product.grade_id) !== gradeId) throw new Error("Selecione apenas livros da série escolhida.");
    if (product.stock_enabled && selected.quantity > Number(product.stock_quantity)) throw new Error(`Estoque insuficiente para ${product.name}.`);
    items.push({ type: "book", sourceId: product.id, description: product.name, size: null, unit: Number(product.price_cents), quantity: selected.quantity, subtotal: Number(product.price_cents) * selected.quantity, stockEnabled: !!product.stock_enabled });
  }
  for (const selected of uniforms) {
    const product = uniformRows.find(row => Number(row.id) === selected.id);
    if (product.stock_enabled && selected.quantity > Number(product.stock_quantity)) throw new Error(`Estoque insuficiente para ${product.name} ${product.size}.`);
    items.push({ type: "uniform", sourceId: product.id, description: product.name, size: product.size, category: product.category || "regular", unit: Number(product.price_cents), quantity: selected.quantity, subtotal: Number(product.price_cents) * selected.quantity, stockEnabled: !!product.stock_enabled });
  }
  return items;
}

async function handleEnrollmentApi(request, db, path) {
  if (!path.startsWith("/api/enrollment") && !path.startsWith("/api/grades") && !path.startsWith("/api/books") && !path.startsWith("/api/uniforms")) return null;
  const auth = await requireEnrollment(request, db); if (auth.error) return auth.error;

  if (path === "/api/enrollment-config" && request.method === "GET") return json(await enrollmentCatalog(db, auth.user.id));

  if (path === "/api/grades" && request.method === "POST") {
    const body = await readJson(request); const name = String(body.name || "").trim(); const now = Date.now();
    if (name.length < 2) return json({ error: "Informe o nome da série." }, 400);
    try {
      const result = await db.prepare(`INSERT INTO grades (name, enrollment_fee_cents, monthly_fee_cents, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(name, moneyCents(body.enrollmentFeeCents), moneyCents(body.monthlyFeeCents), body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      await audit(db, auth.user.id, "grade_created", result.meta.last_row_id, name); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Essa série já está cadastrada." }, 409); throw error; }
  }
  const gradeMatch = path.match(/^\/api\/grades\/(\d+)$/);
  if (gradeMatch && request.method === "PUT") {
    const body = await readJson(request); const id = Number(gradeMatch[1]); const name = String(body.name || "").trim();
    if (name.length < 2) return json({ error: "Informe o nome da série." }, 400);
    try {
      const result = await db.prepare(`UPDATE grades SET name = ?, enrollment_fee_cents = ?, monthly_fee_cents = ?, status = ?, updated_at = ? WHERE id = ?`)
        .bind(name, moneyCents(body.enrollmentFeeCents), moneyCents(body.monthlyFeeCents), body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
      if (!result.meta.changes) return json({ error: "Série não encontrada." }, 404);
      await audit(db, auth.user.id, "grade_updated", id, name); return json({ ok: true });
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Essa série já está cadastrada." }, 409); throw error; }
  }

  if (path === "/api/books" && request.method === "POST") {
    const body = await readJson(request); const name = String(body.name || "").trim(); const gradeId = Number(body.gradeId); const now = Date.now();
    if (name.length < 2 || !Number.isInteger(gradeId)) return json({ error: "Informe nome e série do livro." }, 400);
    try {
      const result = await db.prepare(`INSERT INTO books (name, grade_id, price_cents, stock_enabled, stock_quantity, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(name, gradeId, moneyCents(body.priceCents), body.stockEnabled ? 1 : 0, Math.max(0, Number(body.stockQuantity) || 0), body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      await audit(db, auth.user.id, "book_created", result.meta.last_row_id, name); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Esse livro já existe para a série." }, 409); throw error; }
  }
  const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
  if (bookMatch && request.method === "PUT") {
    const body = await readJson(request); const id = Number(bookMatch[1]); const name = String(body.name || "").trim(); const gradeId = Number(body.gradeId);
    const result = await db.prepare(`UPDATE books SET name = ?, grade_id = ?, price_cents = ?, stock_enabled = ?, stock_quantity = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, gradeId, moneyCents(body.priceCents), body.stockEnabled ? 1 : 0, Math.max(0, Number(body.stockQuantity) || 0), body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Livro não encontrado." }, 404);
    await audit(db, auth.user.id, "book_updated", id, name); return json({ ok: true });
  }

  if (path === "/api/uniforms" && request.method === "POST") {
    const body = await readJson(request); const name = String(body.name || "").trim(); const size = String(body.size || "").trim(); const category = body.category === "physical_education" ? "physical_education" : "regular"; const productType = body.productType === "set" ? "set" : "single"; const components = String(body.components || "").trim(); const now = Date.now();
    if (name.length < 2 || !size || (productType === "set" && components.length < 3)) return json({ error: "Informe produto, tamanho e os componentes do conjunto." }, 400);
    try {
      const result = await db.prepare(`INSERT INTO uniform_items (name, size, category, product_type, components, price_cents, stock_enabled, stock_quantity, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(name, size, category, productType, components || null, moneyCents(body.priceCents), body.stockEnabled ? 1 : 0, Math.max(0, Number(body.stockQuantity) || 0), body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      await audit(db, auth.user.id, "uniform_created", result.meta.last_row_id, `${name} • ${size}`); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Essa peça e tamanho já estão cadastrados." }, 409); throw error; }
  }
  const uniformMatch = path.match(/^\/api\/uniforms\/(\d+)$/);
  if (uniformMatch && request.method === "PUT") {
    const body = await readJson(request); const id = Number(uniformMatch[1]); const name = String(body.name || "").trim(); const size = String(body.size || "").trim(); const category = body.category === "physical_education" ? "physical_education" : "regular"; const productType = body.productType === "set" ? "set" : "single"; const components = String(body.components || "").trim();
    if (name.length < 2 || !size || (productType === "set" && components.length < 3)) return json({ error: "Informe produto, tamanho e os componentes do conjunto." }, 400);
    const result = await db.prepare(`UPDATE uniform_items SET name = ?, size = ?, category = ?, product_type = ?, components = ?, price_cents = ?, stock_enabled = ?, stock_quantity = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, size, category, productType, components || null, moneyCents(body.priceCents), body.stockEnabled ? 1 : 0, Math.max(0, Number(body.stockQuantity) || 0), body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Peça não encontrada." }, 404);
    await audit(db, auth.user.id, "uniform_updated", id, `${name} • ${size}`); return json({ ok: true });
  }

  if (path === "/api/enrollments" && request.method === "GET") {
    const params = new URL(request.url).searchParams; const search = String(params.get("search") || "").trim(); const gradeId = Number(params.get("grade_id") || 0); const classId = Number(params.get("class_id") || 0); const from = String(params.get("from") || ""); const to = String(params.get("to") || "");
    const where = []; const values = [];
    if (search) { where.push(`(e.student_name LIKE ? OR e.registration LIKE ? OR e.guardian_name LIKE ?)`); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (gradeId) { where.push(`e.grade_id = ?`); values.push(gradeId); }
    if (classId) { where.push(`e.class_id = ?`); values.push(classId); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push(`e.enrollment_date >= ?`); values.push(from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push(`e.enrollment_date <= ?`); values.push(to); }
    const result = await db.prepare(`SELECT e.*, u.name AS created_by_name FROM enrollments e LEFT JOIN users u ON u.id = e.created_by ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.enrollment_date DESC, e.created_at DESC LIMIT 500`).bind(...values).all();
    return json({ enrollments: result.results });
  }

  if (path === "/api/enrollment-student-lookup" && request.method === "GET") {
    const params = new URL(request.url).searchParams; const registration = String(params.get("registration") || "").trim(); const name = String(params.get("name") || "").trim(); const birthDate = String(params.get("birth_date") || "").trim();
    if (!registration && (name.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate))) return json({ student: null });
    const student = registration
      ? await db.prepare(`SELECT s.*, c.name AS class_name, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.registration = ? LIMIT 1`).bind(registration).first()
      : await db.prepare(`SELECT s.*, c.name AS class_name, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE lower(trim(s.name)) = lower(trim(?)) AND s.birth_date = ? LIMIT 1`).bind(name, birthDate).first();
    return json({ student: student || null });
  }

  const enrollmentMatch = path.match(/^\/api\/enrollments\/(\d+)$/);
  if (enrollmentMatch && request.method === "GET") {
    const id = Number(enrollmentMatch[1]); const enrollment = await db.prepare(`SELECT e.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM enrollments e LEFT JOIN users creator ON creator.id = e.created_by LEFT JOIN users updater ON updater.id = e.updated_by WHERE e.id = ?`).bind(id).first();
    if (!enrollment) return json({ error: "Matrícula não encontrada." }, 404);
    const [items, history] = await db.batch([
      db.prepare(`SELECT * FROM enrollment_items WHERE enrollment_id = ? ORDER BY item_type, id`).bind(id),
      db.prepare(`SELECT h.*, u.name AS user_name FROM enrollment_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.enrollment_id = ? ORDER BY h.created_at DESC`).bind(id),
    ]);
    return json({ enrollment, items: items.results, history: history.results });
  }

  if ((path === "/api/enrollments" && request.method === "POST") || (enrollmentMatch && request.method === "PUT")) {
    const body = await readJson(request); const id = enrollmentMatch ? Number(enrollmentMatch[1]) : 0; const existing = id ? await db.prepare(`SELECT * FROM enrollments WHERE id = ?`).bind(id).first() : null;
    if (id && !existing) return json({ error: "Matrícula não encontrada." }, 404);
    const registration = String(body.registration || existing?.registration || "").trim(); const studentName = String(body.studentName || "").trim(); const birthDate = String(body.birthDate || ""); const guardianName = String(body.guardianName || "").trim(); const guardianPhone = String(body.guardianPhone || "").trim(); const enrollmentDate = String(body.enrollmentDate || ""); const gradeId = Number(body.gradeId); const classId = Number(body.classId) || null; const notes = String(body.notes || "").trim(); const completing = body.status === "completed"; const now = Date.now();
    if (registration.length < 2 || studentName.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || guardianName.length < 3 || guardianPhone.length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(enrollmentDate) || !Number.isInteger(gradeId)) return json({ error: "Preencha matrícula, aluno, nascimento, série, responsável, telefone e data." }, 400);
    const grade = await db.prepare(`SELECT * FROM grades WHERE id = ?`).bind(gradeId).first(); if (!grade || grade.status !== "active") return json({ error: "Selecione uma série ativa." }, 400);
    const klass = classId ? await db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first() : null; if (classId && !klass) return json({ error: "Selecione uma turma ativa." }, 400);
    const schoolYear = Number(klass?.school_year || enrollmentDate.slice(0, 4));
    const duplicate = await db.prepare(`SELECT id FROM enrollments WHERE registration = ? AND school_year = ? AND id != ? AND status != 'cancelled' LIMIT 1`).bind(registration, schoolYear, id || 0).first(); if (duplicate) return json({ error: "Este aluno já possui matrícula neste ano letivo." }, 409);
    const studentExists = completing || existing?.status === "completed" ? await db.prepare(`SELECT * FROM students WHERE registration = ? OR (lower(trim(name)) = lower(trim(?)) AND birth_date = ?) ORDER BY CASE WHEN registration = ? THEN 0 ELSE 1 END LIMIT 1`).bind(registration, studentName, birthDate, registration).first() : null;
    if (studentExists && existing?.student_id && Number(studentExists.id) !== Number(existing.student_id)) return json({ error: "Os dados informados pertencem a outro cadastro de aluno." }, 409);
    if (studentExists) { const sameYear = await db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND school_year = ? AND id != ? AND status != 'cancelled' LIMIT 1`).bind(studentExists.id, schoolYear, id || 0).first(); if (sameYear) return json({ error: "Este aluno já possui matrícula neste ano letivo." }, 409); }
    if (existing?.status === "completed") {
      await db.prepare(`UPDATE enrollments SET registration = ?, student_name = ?, birth_date = ?, grade_id = ?, class_id = ?, class_name_snapshot = ?, school_year = ?, guardian_name = ?, guardian_phone = ?, enrollment_date = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(registration, studentName, birthDate, gradeId, classId, klass?.name || null, schoolYear, guardianName, guardianPhone, enrollmentDate, notes || null, auth.user.id, now, id).run();
      if (existing.student_id) {
        const current = await db.prepare(`SELECT s.class_id, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?`).bind(existing.student_id).first(); const canMoveCurrent = classId && Number(schoolYear) >= Number(current?.school_year || 0);
        await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = CASE WHEN ? THEN ? ELSE class_id END, updated_at = ? WHERE id = ?`).bind(registration, studentName, birthDate, guardianName, guardianPhone, canMoveCurrent ? 1 : 0, classId, now, existing.student_id).run();
        if (canMoveCurrent && Number(current?.class_id) !== classId) await db.batch([
          db.prepare(`UPDATE student_class_history SET result_status = 'transferred', left_at = ?, updated_at = ? WHERE student_id = ? AND class_id = ? AND left_at IS NULL`).bind(now, now, existing.student_id, current?.class_id),
          db.prepare(`INSERT OR IGNORE INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).bind(existing.student_id, classId, schoolYear, klass.grade_level, klass.name, now, auth.user.id, now, now),
        ]);
      }
      await db.prepare(`INSERT INTO enrollment_history (enrollment_id, user_id, action, details, created_at) VALUES (?, ?, 'updated', ?, ?)`).bind(id, auth.user.id, "Dados cadastrais atualizados; valores originais preservados", now).run();
      await audit(db, auth.user.id, "enrollment_updated", id, `${registration} • ${studentName}`); return json({ ok: true, id, preservedPrices: true });
    }
    const items = await pricedEnrollmentItems(db, gradeId, body.books, body.uniforms); const booksTotal = items.filter(item => item.type === "book").reduce((sum, item) => sum + item.subtotal, 0); const uniformRegularTotal = items.filter(item => item.type === "uniform" && item.category !== "physical_education").reduce((sum, item) => sum + item.subtotal, 0); const uniformPhysicalTotal = items.filter(item => item.type === "uniform" && item.category === "physical_education").reduce((sum, item) => sum + item.subtotal, 0); const uniformsTotal = uniformRegularTotal + uniformPhysicalTotal; const includeFirst = body.includeFirstMonthly ? 1 : 0; const initialTotal = Number(grade.enrollment_fee_cents) + booksTotal + uniformsTotal + (includeFirst ? Number(grade.monthly_fee_cents) : 0); const status = completing ? "completed" : "draft";
    let enrollmentId = id;
    if (!id) {
      const code = `MAT-${enrollmentDate.replace(/-/g, "")}-${randomHex(3).toUpperCase()}`;
      const result = await db.prepare(`INSERT INTO enrollments (code, registration, student_name, birth_date, grade_id, grade_name_snapshot, class_id, class_name_snapshot, school_year, guardian_name, guardian_phone, enrollment_date, notes, status, enrollment_fee_cents, monthly_fee_cents, books_total_cents, uniforms_total_cents, uniform_regular_total_cents, uniform_physical_total_cents, include_first_monthly, initial_total_cents, created_by, updated_by, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(code, registration, studentName, birthDate, gradeId, grade.name, classId, klass?.name || null, schoolYear, guardianName, guardianPhone, enrollmentDate, notes || null, status, grade.enrollment_fee_cents, grade.monthly_fee_cents, booksTotal, uniformsTotal, uniformRegularTotal, uniformPhysicalTotal, includeFirst, initialTotal, auth.user.id, auth.user.id, now, now, completing ? now : null).run();
      enrollmentId = Number(result.meta.last_row_id);
    } else {
      await db.prepare(`UPDATE enrollments SET registration = ?, student_name = ?, birth_date = ?, grade_id = ?, grade_name_snapshot = ?, class_id = ?, class_name_snapshot = ?, school_year = ?, guardian_name = ?, guardian_phone = ?, enrollment_date = ?, notes = ?, status = ?, enrollment_fee_cents = ?, monthly_fee_cents = ?, books_total_cents = ?, uniforms_total_cents = ?, uniform_regular_total_cents = ?, uniform_physical_total_cents = ?, include_first_monthly = ?, initial_total_cents = ?, updated_by = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
        .bind(registration, studentName, birthDate, gradeId, grade.name, classId, klass?.name || null, schoolYear, guardianName, guardianPhone, enrollmentDate, notes || null, status, grade.enrollment_fee_cents, grade.monthly_fee_cents, booksTotal, uniformsTotal, uniformRegularTotal, uniformPhysicalTotal, includeFirst, initialTotal, auth.user.id, now, completing ? now : null, id).run();
    }
    const operations = [db.prepare(`DELETE FROM enrollment_items WHERE enrollment_id = ?`).bind(enrollmentId)];
    items.forEach(item => operations.push(db.prepare(`INSERT INTO enrollment_items (enrollment_id, item_type, source_id, description, size, category, unit_price_cents, quantity, subtotal_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(enrollmentId, item.type, item.sourceId, item.description, item.size, item.category || null, item.unit, item.quantity, item.subtotal)));
    if (completing) items.filter(item => item.stockEnabled).forEach(item => operations.push(db.prepare(item.type === "book" ? `UPDATE books SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?` : `UPDATE uniform_items SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?`).bind(item.quantity, now, item.sourceId, item.quantity)));
    operations.push(db.prepare(`INSERT INTO enrollment_history (enrollment_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)`).bind(enrollmentId, auth.user.id, completing ? "completed" : (id ? "updated_draft" : "created_draft"), `${registration} • ${studentName}`, now));
    await db.batch(operations);
    if (completing) {
      let studentId = studentExists?.id || null;
      if (!studentId) {
        const studentResult = await db.prepare(`INSERT INTO students (registration, name, birth_date, guardian_name, guardian_phone, class_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).bind(registration, studentName, birthDate, guardianName, guardianPhone, classId, auth.user.id, now, now).run(); studentId = studentResult.meta.last_row_id;
      } else {
        const currentClass = studentExists?.class_id ? await db.prepare(`SELECT school_year FROM classes WHERE id = ?`).bind(studentExists.class_id).first() : null; const canMoveCurrent = classId && Number(schoolYear) >= Number(currentClass?.school_year || 0);
        if (canMoveCurrent && Number(studentExists?.class_id) !== classId) await db.prepare(`UPDATE student_class_history SET result_status = 'transferred', left_at = ?, updated_at = ? WHERE student_id = ? AND class_id = ? AND left_at IS NULL`).bind(now, now, studentId, studentExists?.class_id).run();
        await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = CASE WHEN ? THEN ? ELSE class_id END, status = 'active', updated_at = ? WHERE id = ?`).bind(registration, studentName, birthDate, guardianName, guardianPhone, canMoveCurrent ? 1 : 0, classId, now, studentId).run();
      }
      await db.prepare(`UPDATE enrollments SET student_id = ?, school_year = ? WHERE id = ?`).bind(studentId, schoolYear, enrollmentId).run();
      if (classId) await db.prepare(`INSERT OR IGNORE INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).bind(studentId, classId, schoolYear, klass.grade_level, klass.name, now, auth.user.id, now, now).run();
    }
    await audit(db, auth.user.id, completing ? "enrollment_completed" : (id ? "enrollment_updated" : "enrollment_draft"), enrollmentId, `${registration} • ${studentName}`);
    return json({ ok: true, id: enrollmentId, status }, id ? 200 : 201);
  }

  return json({ error: "Rota de matrículas não encontrada." }, 404);
}

async function confirmProgression(db, user, studentId, targetClassId, resultStatus = "completed", notes = "") {
  const now = Date.now(); const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
  await ensureDefaultGrades(db, user.id);
  const [student, targetClass] = await Promise.all([
    db.prepare(`SELECT s.*, c.school_year AS current_year, c.name AS current_class_name, c.grade_level AS current_grade_level FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?`).bind(studentId).first(),
    db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(targetClassId).first(),
  ]);
  if (!student || !targetClass) return { error: "Aluno ou turma de destino não encontrado.", status: 404 };
  if (Number(student.class_id) === Number(targetClassId)) return { error: "Escolha uma turma diferente da atual.", status: 400 };
  if (Number(targetClass.school_year) <= Number(student.current_year || 0)) return { error: "A progressão deve apontar para um ano letivo posterior.", status: 400 };
  const existingLink = await db.prepare(`SELECT id FROM student_class_history WHERE student_id = ? AND class_id = ? LIMIT 1`).bind(studentId, targetClassId).first();
  if (existingLink) return { error: "Este aluno já possui vínculo com a turma de destino.", status: 409 };
  const [gradeRows, ruleRows] = await Promise.all([db.prepare(`SELECT * FROM grades WHERE status = 'active' ORDER BY id`).all(), db.prepare(`SELECT * FROM progression_rules WHERE status = 'active'`).all()]);
  const currentRule = ruleRows.results.find(item => gradeKey(item.from_grade) === gradeKey(student.current_grade_level) || gradeKey(item.from_grade) === gradeKey(student.current_class_name)); const targetKeys = [targetClass.grade_level, targetClass.name, currentRule?.to_grade].filter(Boolean).map(gradeKey);
  const grade = gradeRows.results.find(item => targetKeys.includes(gradeKey(item.name))) || gradeRows.results.find(item => targetKeys.some(key => key.startsWith(gradeKey(item.name))));
  if (!grade) return { error: `Cadastre a série “${targetClass.grade_level}” nas configurações de Matrículas antes de confirmar.`, status: 409 };
  const existingEnrollment = await db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND school_year = ? AND status != 'cancelled' LIMIT 1`).bind(studentId, targetClass.school_year).first();
  const normalizedResult = ["completed", "retained", "transferred"].includes(resultStatus) ? resultStatus : "completed";
  const operations = [
    db.prepare(`UPDATE student_class_history SET result_status = ?, notes = ?, left_at = ?, updated_at = ? WHERE student_id = ? AND class_id = ? AND left_at IS NULL`).bind(normalizedResult, String(notes || "").trim() || null, now, now, studentId, student.class_id),
    db.prepare(`INSERT INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, notes, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`).bind(studentId, targetClassId, targetClass.school_year, targetClass.grade_level, targetClass.name, now, user.id, now, now),
    db.prepare(`UPDATE students SET class_id = ?, status = 'active', updated_at = ? WHERE id = ?`).bind(targetClassId, now, studentId),
  ];
  if (!existingEnrollment) {
    const code = `MAT-${today.replace(/-/g, "")}-${randomHex(3).toUpperCase()}`; const initialTotal = Number(grade.enrollment_fee_cents || 0);
    operations.push(db.prepare(`INSERT INTO enrollments (code, registration, student_id, student_name, birth_date, grade_id, grade_name_snapshot, class_id, class_name_snapshot, school_year, guardian_name, guardian_phone, enrollment_date, notes, status, enrollment_fee_cents, monthly_fee_cents, books_total_cents, uniforms_total_cents, uniform_regular_total_cents, uniform_physical_total_cents, include_first_monthly, initial_total_cents, created_by, updated_by, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, NULL)`)
      .bind(code, student.registration, studentId, student.name, student.birth_date || "", grade.id, grade.name, targetClassId, targetClass.name, targetClass.school_year, student.guardian_name || "", student.guardian_phone || "", today, `Progressão preparada automaticamente de ${student.current_class_name || "turma anterior"} para ${targetClass.name}.`, grade.enrollment_fee_cents, grade.monthly_fee_cents, initialTotal, user.id, user.id, now, now));
  }
  await db.batch(operations);
  await audit(db, user.id, "student_promoted", studentId, `${student.name} → ${targetClass.name} • ${targetClass.school_year}`);
  return { ok: true, studentId, targetClassId, schoolYear: targetClass.school_year, enrollmentPrepared: !existingEnrollment };
}

async function handleApi(request, env, path) {
  const db = env.DB;
  if (!db) return json({ error: "Banco de dados indisponível." }, 503);

  if (path === "/api/auth/capabilities" && request.method === "GET") {
    return json({ emailRecovery: !!(env.RESEND_API_KEY && env.EMAIL_FROM), verificationRequired: true });
  }

  if (path === "/api/auth/verify-email" && request.method === "POST") {
    const body = await readJson(request), token = String(body.token || "");
    if (token.length < 32) return json({ error: "O link de verificação é inválido." }, 400);
    const tokenHash = await hashToken(token), now = Date.now();
    const record = await db.prepare(`SELECT t.id AS token_id, t.user_id, t.expires_at, t.consumed_at, u.username, u.pending_email, u.pending_email_key FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.type = 'email_verification' LIMIT 1`).bind(tokenHash).first();
    if (!record || record.consumed_at || record.expires_at <= now || !record.pending_email || !record.pending_email_key) return json({ error: "Este link expirou ou já foi utilizado. Solicite uma nova verificação à Gestão Escolar." }, 400);
    try {
      await db.batch([
        db.prepare(`UPDATE users SET email = pending_email, email_key = pending_email_key, email_verified_at = ?, pending_email = NULL, pending_email_key = NULL, updated_at = ? WHERE id = ?`).bind(now, now, record.user_id),
        db.prepare(`UPDATE auth_tokens SET consumed_at = ? WHERE user_id = ? AND type = 'email_verification' AND consumed_at IS NULL`).bind(now, record.user_id),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Este e-mail já foi confirmado em outra conta. Procure a Gestão Escolar." }, 409);
      throw error;
    }
    await audit(db, record.user_id, "user_email_verified", record.user_id, record.pending_email);
    return json({ ok: true, message: "E-mail verificado. A recuperação de senha já está disponível para esta conta." });
  }

  if (path === "/api/auth/forgot-password" && request.method === "POST") {
    const body = await readJson(request), identifier = String(body.identifier || "").trim(), identifierKey = identifier.includes("@") ? normalizeEmail(identifier) : normalizeUsername(identifier);
    if (!identifierKey) return json({ error: "Informe seu usuário ou e-mail." }, 400);
    const identifierHash = await hashToken(identifierKey), ipHash = await hashToken(request.headers.get("cf-connecting-ip") || "unknown"), now = Date.now();
    if (await recoveryRateLimited(db, identifierHash, ipHash)) return json({ error: "Muitas solicitações. Aguarde 15 minutos e tente novamente." }, 429);
    const user = await db.prepare(`SELECT id, username, name, email FROM users WHERE status = 'active' AND email_verified_at IS NOT NULL AND (username_key = ? OR email_key = ?) LIMIT 1`).bind(identifierKey, identifierKey).first();
    const requestResult = await db.prepare(`INSERT INTO recovery_requests (user_id, identifier_hash, ip_hash, kind, status, created_at) VALUES (?, ?, ?, 'password_reset', 'requested', ?)`).bind(user?.id || null, identifierHash, ipHash, now).run();
    if (!user) return json({ ok: true, message: "Se existir uma conta com e-mail verificado, as instruções serão enviadas." }, 202);
    const token = `${randomHex(32)}${randomHex(16)}`, tokenHash = await hashToken(token), link = `${publicAppOrigin(env)}/?reset_password=${encodeURIComponent(token)}`;
    await db.prepare(`INSERT INTO auth_tokens (user_id, type, token_hash, expires_at, consumed_at, created_at) VALUES (?, 'password_reset', ?, ?, NULL, ?)`).bind(user.id, tokenHash, now + PASSWORD_RESET_SECONDS * 1000, now).run();
    try {
      await sendTransactionalEmail(env, {
        to: user.email,
        subject: "Redefinição de senha do EduClass",
        text: `Redefina a senha da conta ${user.username} acessando: ${link}. O link expira em 30 minutos e só pode ser usado uma vez.`,
        html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2 style="color:#0a2463">Redefinição de senha — EduClass</h2><p>Recebemos uma solicitação para a conta <strong>${escapeHtml(user.username)}</strong>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2457e6;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Criar nova senha</a></p><p>O link expira em 30 minutos e funciona uma única vez. Se você não solicitou a alteração, ignore esta mensagem.</p></div>`,
        idempotencyKey: `password-reset/${user.id}/${tokenHash.slice(0, 16)}`,
      });
      await db.prepare(`UPDATE recovery_requests SET status = 'sent' WHERE id = ?`).bind(requestResult.meta.last_row_id).run();
    } catch (error) {
      await db.batch([
        db.prepare(`DELETE FROM auth_tokens WHERE token_hash = ?`).bind(tokenHash),
        db.prepare(`UPDATE recovery_requests SET status = 'failed' WHERE id = ?`).bind(requestResult.meta.last_row_id),
      ]);
      return json({ error: "Não foi possível enviar o e-mail de recuperação. Tente novamente mais tarde ou procure a Gestão Escolar." }, 503);
    }
    return json({ ok: true, message: "Se existir uma conta com e-mail verificado, as instruções serão enviadas." }, 202);
  }

  if (path === "/api/auth/reset-password" && request.method === "POST") {
    const body = await readJson(request), token = String(body.token || ""), password = String(body.password || ""), confirmPassword = String(body.confirmPassword || "");
    if (password.length < 8) return json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, 400);
    if (password !== confirmPassword) return json({ error: "As senhas não coincidem." }, 400);
    const tokenHash = await hashToken(token), now = Date.now();
    const record = await db.prepare(`SELECT t.id AS token_id, t.user_id, t.expires_at, t.consumed_at, u.username, u.name, u.email FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.type = 'password_reset' LIMIT 1`).bind(tokenHash).first();
    if (!record || record.consumed_at || record.expires_at <= now) return json({ error: "Este link expirou ou já foi utilizado. Solicite uma nova recuperação." }, 400);
    const salt = randomHex(16), passwordHash = await hashPassword(password, salt);
    await db.batch([
      db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).bind(passwordHash, salt, now, record.user_id),
      db.prepare(`UPDATE auth_tokens SET consumed_at = ? WHERE user_id = ? AND type = 'password_reset' AND consumed_at IS NULL`).bind(now, record.user_id),
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(record.user_id),
      db.prepare(`UPDATE recovery_requests SET status = 'completed' WHERE id = (SELECT id FROM recovery_requests WHERE user_id = ? AND kind = 'password_reset' ORDER BY created_at DESC LIMIT 1)`).bind(record.user_id),
    ]);
    await audit(db, record.user_id, "password_recovered", record.user_id, null);
    let notificationSent = true;
    try { await sendTransactionalEmail(env, { to: record.email, subject: "Sua senha do EduClass foi alterada", text: `A senha da conta ${record.username} foi alterada. Se não foi você, procure imediatamente a Gestão Escolar.`, html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2 style="color:#0a2463">Senha alterada — EduClass</h2><p>A senha da conta <strong>${escapeHtml(record.username)}</strong> foi alterada.</p><p>Se não foi você, procure imediatamente a Gestão Escolar.</p></div>`, idempotencyKey: `password-changed/${record.user_id}/${now}` }); } catch { notificationSent = false; }
    return json({ ok: true, notificationSent, message: notificationSent ? "Senha alterada com segurança. Entre novamente." : "Senha alterada, mas a notificação por e-mail não pôde ser enviada." });
  }

  const libraryResponse = await handleLibraryApi(request, env, path);
  if (libraryResponse) return libraryResponse;

  const enrollmentResponse = await handleEnrollmentApi(request, db, path);
  if (enrollmentResponse) return enrollmentResponse;

  if (path === "/api/login" && request.method === "POST") {
    await seedUsers(db, env);
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
    const externalClient = ALLOWED_EXTERNAL_ORIGINS.has(request.headers.get("origin") || "");
    return json({ user: safeUser(await enrichUser(db, safeUser(user))), ...(externalClient ? { token } : {}) }, 200, { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
  }

  if (path === "/api/session" && request.method === "GET") {
    const user = await getSession(request, db);
    return json({ user: user ? safeUser(await enrichUser(db, user, Number(request.headers.get("x-teacher-assignment-id") || 0))) : null }, user ? 200 : 401);
  }

  if (path === "/api/logout" && request.method === "POST") {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : parseCookies(request)[SESSION_COOKIE];
    if (token) await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await hashToken(token)).run();
    return json({ ok: true }, 200, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
  }

  if (path === "/api/me/password" && request.method === "POST") {
    const user = await getSession(request, db); if (!user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
    const body = await readJson(request); const password = String(body.password || "");
    if (password.length < 8) return json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, 400);
    const salt = randomHex(16); const passwordHash = await hashPassword(password, salt); const now = Date.now();
    await db.batch([
      db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).bind(passwordHash, salt, now, user.id),
      db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`).bind(user.id, user.sessionId),
    ]);
    await audit(db, user.id, "password_changed", user.id, null);
    const updated = await db.prepare(`SELECT id, username, name, role, initials, status, email, pending_email, email_verified_at, must_change_password FROM users WHERE id = ?`).bind(user.id).first();
    return json({ ok: true, user: safeUser(await enrichUser(db, safeUser(updated))) });
  }

  if (path === "/api/academic-config" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const catalog = await academicCatalog(db, auth.user.id);
    if (auth.user.role === "Professor") {
      if (!auth.user.assignment) return json({ subjects: [] });
      const related = (auth.user.assignments || []).filter(item => item.status === "active" && Number(item.class_id) === Number(auth.user.assignment.class_id) && Number(item.school_year) === Number(auth.user.assignment.school_year));
      const permittedIds = new Set(related.map(item => Number(item.subject_id)).filter(Boolean));
      catalog.subjects = auth.user.assignment.education_stage === "Ensino Fundamental"
        ? catalog.subjects.filter(subject => permittedIds.has(Number(subject.id)))
        : catalog.subjects.filter(subject => subject.education_stage === "Educação Infantil");
    }
    return json(catalog);
  }

  if (path === "/api/subjects" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const name = String(body.name || "").trim(); const stage = String(body.educationStage || ""); const now = Date.now();
    if (name.length < 2 || !DEFAULT_SUBJECTS[stage]) return json({ error: "Informe disciplina e etapa de ensino." }, 400);
    try { const result = await db.prepare(`INSERT INTO subjects (name, education_stage, sort_order, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(name, stage, Math.max(0, Number(body.sortOrder) || 0), body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      await audit(db, auth.user.id, "subject_created", result.meta.last_row_id, `${stage} • ${name}`); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Essa disciplina já existe nesta etapa." }, 409); throw error; }
  }
  const subjectMatch = path.match(/^\/api\/subjects\/(\d+)$/);
  if (subjectMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const id = Number(subjectMatch[1]); const name = String(body.name || "").trim(); const stage = String(body.educationStage || "");
    if (name.length < 2 || !DEFAULT_SUBJECTS[stage]) return json({ error: "Informe disciplina e etapa de ensino." }, 400);
    const result = await db.prepare(`UPDATE subjects SET name = ?, education_stage = ?, sort_order = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, stage, Math.max(0, Number(body.sortOrder) || 0), body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Disciplina não encontrada." }, 404);
    await audit(db, auth.user.id, "subject_updated", id, `${stage} • ${name}`); return json({ ok: true });
  }

  if (path === "/api/subject-components" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const subjectId = Number(body.subjectId); const name = String(body.name || "").trim(); const now = Date.now();
    if (!Number.isInteger(subjectId) || name.length < 2) return json({ error: "Informe disciplina e conteúdo complementar." }, 400);
    try { const result = await db.prepare(`INSERT INTO subject_components (subject_id, name, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`)
      .bind(subjectId, name, Math.max(0, Number(body.sortOrder) || 0), now, now).run();
      await audit(db, auth.user.id, "subject_component_created", result.meta.last_row_id, name); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Esse conteúdo complementar já existe." }, 409); throw error; }
  }
  const componentMatch = path.match(/^\/api\/subject-components\/(\d+)$/);
  if (componentMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const id = Number(componentMatch[1]); const name = String(body.name || "").trim();
    const result = await db.prepare(`UPDATE subject_components SET name = ?, sort_order = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, Math.max(0, Number(body.sortOrder) || 0), body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Conteúdo complementar não encontrado." }, 404);
    await audit(db, auth.user.id, "subject_component_updated", id, name); return json({ ok: true });
  }

  if (path === "/api/summary" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
    if (auth.user.role === "Professor") {
      const assignment = auth.user.assignment; if (!assignment) return json({ classes: 0, students: 0, agendas: 0, teachers: 1, attendance: { present: 0, late: 0, justified: 0, absent: 0 }, attendanceTotal: 0, attendancePercent: 0, pendingClasses: 1, trend: [] });
      const scopeKey = assignment.education_stage === "Ensino Fundamental" ? `subject:${assignment.subject_id}` : "class";
      const [students, agendas, attendanceToday, trendResult] = await db.batch([
        db.prepare(`SELECT COUNT(*) AS total FROM students WHERE class_id = ? AND status = 'active'`).bind(assignment.class_id),
        assignment.education_stage === "Ensino Fundamental" ? db.prepare(`SELECT COUNT(*) AS total FROM agenda_entries WHERE class_id = ? AND subject_id = ?`).bind(assignment.class_id, assignment.subject_id) : db.prepare(`SELECT COUNT(*) AS total FROM agenda_entries WHERE class_id = ?`).bind(assignment.class_id),
        db.prepare(`SELECT status, COUNT(*) AS total FROM attendance_records WHERE attendance_date = ? AND class_id = ? AND scope_key = ? GROUP BY status`).bind(today, assignment.class_id, scopeKey),
        db.prepare(`SELECT attendance_date, COUNT(*) AS total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended FROM attendance_records WHERE class_id = ? AND scope_key = ? GROUP BY attendance_date ORDER BY attendance_date DESC LIMIT 7`).bind(assignment.class_id, scopeKey),
      ]);
      const attendance = { present: 0, late: 0, justified: 0, absent: 0 }; attendanceToday.results.forEach(row => attendance[row.status] = Number(row.total) || 0); const total = Object.values(attendance).reduce((sum, value) => sum + value, 0);
      return json({ classes: 1, students: students.results[0]?.total || 0, agendas: agendas.results[0]?.total || 0, teachers: 1, attendance, attendanceTotal: total, attendancePercent: total ? Math.round(((attendance.present + attendance.late) / total) * 1000) / 10 : 0, pendingClasses: total ? 0 : 1, trend: trendResult.results.reverse().map(row => ({ date: row.attendance_date, total: Number(row.total), percent: row.total ? Math.round((Number(row.attended) / Number(row.total)) * 1000) / 10 : 0 })) });
    }
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

  if (path === "/api/progressions" && request.method === "GET") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    await Promise.all([ensureAcademicData(db, auth.user.id), ensureDefaultGrades(db, auth.user.id)]);
    const [ruleResult, studentResult, classResult, historyResult] = await db.batch([
      db.prepare(`SELECT * FROM progression_rules ORDER BY id`),
      db.prepare(`SELECT s.id, s.registration, s.name, s.birth_date, s.class_id, c.name AS class_name, c.grade_level, c.shift, c.school_year FROM students s JOIN classes c ON c.id = s.class_id WHERE s.status = 'active' ORDER BY c.school_year, c.name, s.name`),
      db.prepare(`SELECT * FROM classes WHERE status = 'active' ORDER BY school_year, name`),
      db.prepare(`SELECT student_id, school_year FROM student_class_history`),
    ]);
    const rules = ruleResult.results; const classes = classResult.results; const candidates = []; const linkedYears = new Set(historyResult.results.map(item => `${item.student_id}:${item.school_year}`));
    for (const student of studentResult.results) {
      const rule = rules.find(item => item.status === "active" && (gradeKey(item.from_grade) === gradeKey(student.grade_level) || gradeKey(item.from_grade) === gradeKey(student.class_name))); if (!rule) continue;
      const targetYear = Number(student.school_year) + 1;
      if (linkedYears.has(`${student.id}:${targetYear}`)) continue;
      const destinations = classes.filter(item => Number(item.school_year) === targetYear); const matchesTarget = item => gradeKey(item.grade_level) === gradeKey(rule.to_grade) || gradeKey(item.name) === gradeKey(rule.to_grade); const suggested = destinations.find(item => matchesTarget(item) && item.shift === student.shift) || destinations.find(matchesTarget) || null;
      candidates.push({ ...student, ruleId: rule.id, targetGrade: rule.to_grade, targetYear, suggestedClassId: suggested?.id || null, destinations: destinations.map(item => ({ id: item.id, name: item.name, grade_level: item.grade_level, shift: item.shift, school_year: item.school_year })) });
    }
    return json({ rules, candidates });
  }

  if (path === "/api/progression-rules" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error; const body = await readJson(request); const fromGrade = String(body.fromGrade || "").trim(); const toGrade = String(body.toGrade || "").trim(); const now = Date.now();
    if (fromGrade.length < 2 || toGrade.length < 2 || gradeKey(fromGrade) === gradeKey(toGrade)) return json({ error: "Informe séries de origem e destino diferentes." }, 400);
    try { const result = await db.prepare(`INSERT INTO progression_rules (from_grade, to_grade, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(fromGrade, toGrade, body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run(); await audit(db, auth.user.id, "progression_rule_created", result.meta.last_row_id, `${fromGrade} → ${toGrade}`); return json({ ok: true, id: result.meta.last_row_id }, 201); } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Já existe uma regra para esta série de origem." }, 409); throw error; }
  }

  const progressionRuleMatch = path.match(/^\/api\/progression-rules\/(\d+)$/);
  if (progressionRuleMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error; const body = await readJson(request); const fromGrade = String(body.fromGrade || "").trim(); const toGrade = String(body.toGrade || "").trim();
    if (fromGrade.length < 2 || toGrade.length < 2 || gradeKey(fromGrade) === gradeKey(toGrade)) return json({ error: "Informe séries de origem e destino diferentes." }, 400);
    try { const result = await db.prepare(`UPDATE progression_rules SET from_grade = ?, to_grade = ?, status = ?, updated_at = ? WHERE id = ?`).bind(fromGrade, toGrade, body.status === "inactive" ? "inactive" : "active", Date.now(), Number(progressionRuleMatch[1])).run(); if (!result.meta.changes) return json({ error: "Regra não encontrada." }, 404); await audit(db, auth.user.id, "progression_rule_updated", Number(progressionRuleMatch[1]), `${fromGrade} → ${toGrade}`); return json({ ok: true }); } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Já existe uma regra para esta série de origem." }, 409); throw error; }
  }

  if (path === "/api/progressions/confirm" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error; const body = await readJson(request); const result = await confirmProgression(db, auth.user, Number(body.studentId), Number(body.classId), String(body.resultStatus || "completed"), String(body.notes || ""));
    return result.error ? json({ error: result.error }, result.status) : json(result);
  }

  if (path === "/api/classes" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id);
    const result = auth.user.role === "Professor"
      ? await db.prepare(`SELECT c.*, COUNT(s.id) AS student_count FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active' WHERE c.id = ? GROUP BY c.id`).bind(auth.user.assignment?.class_id || 0).all()
      : await db.prepare(`SELECT c.*, COUNT(DISTINCT h.student_id) AS student_count FROM classes c LEFT JOIN student_class_history h ON h.class_id = c.id GROUP BY c.id ORDER BY c.school_year DESC, c.name`).all();
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
    const id = Number(classMatch[1]); const count = await db.prepare(`SELECT COUNT(*) AS total FROM student_class_history WHERE class_id = ?`).bind(id).first();
    if (count.total > 0) return json({ error: "Esta turma possui histórico de alunos e não pode ser excluída. Marque-a como inativa para preservar os registros." }, 400);
    await db.prepare(`DELETE FROM classes WHERE id = ?`).bind(id).run(); await audit(db, auth.user.id, "class_deleted", id, null); return json({ ok: true });
  }

  if (path === "/api/students" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id);
    const requestedClassId = Number(new URL(request.url).searchParams.get("class_id") || 0); const classId = auth.user.role === "Professor" ? Number(auth.user.assignment?.class_id || 0) : requestedClassId;
    if (auth.user.role === "Professor" && !classId) return json({ students: [] });
    const statement = auth.user.role === "Professor"
      ? db.prepare(`SELECT s.*, c.name AS class_name, c.shift AS class_shift, c.school_year, c.id AS membership_class_id, 1 AS is_current FROM students s JOIN classes c ON c.id = s.class_id WHERE s.class_id = ? ORDER BY s.name`).bind(classId)
      : classId
        ? db.prepare(`SELECT s.*, h.class_id AS membership_class_id, h.result_status, h.left_at, c.name AS class_name, c.shift AS class_shift, h.school_year, CASE WHEN s.class_id = h.class_id THEN 1 ELSE 0 END AS is_current FROM student_class_history h JOIN students s ON s.id = h.student_id LEFT JOIN classes c ON c.id = h.class_id WHERE h.class_id = ? ORDER BY h.school_year DESC, s.name`).bind(classId)
        : db.prepare(`SELECT s.*, h.class_id AS membership_class_id, h.result_status, h.left_at, c.name AS class_name, c.shift AS class_shift, h.school_year, CASE WHEN s.class_id = h.class_id THEN 1 ELSE 0 END AS is_current FROM student_class_history h JOIN students s ON s.id = h.student_id LEFT JOIN classes c ON c.id = h.class_id ORDER BY h.school_year DESC, c.name, s.name`);
    const result = await statement.all(); return json({ students: result.results });
  }

  if (path === "/api/students" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const registration = String(body.registration || "").trim(); const name = String(body.name || "").trim(); const birthDate = String(body.birthDate || "").trim(); const guardianName = String(body.guardianName || "").trim(); const guardianPhone = String(body.guardianPhone || "").trim(); const classId = Number(body.classId); const now = Date.now();
    if (registration.length < 2 || name.length < 3 || !Number.isInteger(classId) || classId < 1) return json({ error: "Informe matrícula, nome e turma do aluno." }, 400);
    const klass = await db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first(); if (!klass) return json({ error: "Selecione uma turma ativa." }, 400);
    const sameStudent = birthDate ? await db.prepare(`SELECT id, registration FROM students WHERE lower(trim(name)) = lower(trim(?)) AND birth_date = ? LIMIT 1`).bind(name, birthDate).first() : null;
    if (sameStudent) return json({ error: `Este aluno já está cadastrado com a matrícula ${sameStudent.registration}. Edite o cadastro existente ou faça a nova matrícula por ele.` }, 409);
    try {
      const result = await db.prepare(`INSERT INTO students (registration, name, birth_date, guardian_name, guardian_phone, class_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
        .bind(registration, name, birthDate || null, guardianName || null, guardianPhone || null, classId, auth.user.id, now, now).run();
      await db.prepare(`INSERT INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
        .bind(result.meta.last_row_id, classId, klass.school_year, klass.grade_level, klass.name, now, auth.user.id, now, now).run();
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
    const [existing, targetClass] = await Promise.all([
      db.prepare(`SELECT * FROM students WHERE id = ?`).bind(id).first(),
      db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first(),
    ]);
    if (!existing) return json({ error: "Aluno não encontrado." }, 404);
    if (!targetClass) return json({ error: "Selecione uma turma ativa." }, 400);
    const duplicateIdentity = String(body.birthDate || "").trim() ? await db.prepare(`SELECT id FROM students WHERE id != ? AND lower(trim(name)) = lower(trim(?)) AND birth_date = ? LIMIT 1`).bind(id, name, String(body.birthDate || "").trim()).first() : null;
    if (duplicateIdentity) return json({ error: "Já existe outro cadastro com este nome e data de nascimento." }, 409);
    try {
      const result = await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = ?, status = ?, updated_at = ? WHERE id = ?`)
        .bind(registration, name, String(body.birthDate || "").trim() || null, String(body.guardianName || "").trim() || null, String(body.guardianPhone || "").trim() || null, classId, body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
      if (!result.meta.changes) return json({ error: "Aluno não encontrado." }, 404);
      if (Number(existing.class_id) !== classId) {
        const now = Date.now();
        await db.prepare(`UPDATE student_class_history SET result_status = 'transferred', left_at = ?, updated_at = ? WHERE student_id = ? AND class_id = ? AND left_at IS NULL`).bind(now, now, id, existing.class_id).run();
        await db.prepare(`INSERT OR IGNORE INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
          .bind(id, classId, targetClass.school_year, targetClass.grade_level, targetClass.name, now, auth.user.id, now, now).run();
      }
      await db.prepare(`UPDATE enrollments SET registration = ?, student_name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, updated_by = ?, updated_at = ? WHERE student_id = ?`).bind(registration, name, String(body.birthDate || "").trim(), String(body.guardianName || "").trim(), String(body.guardianPhone || "").trim(), auth.user.id, Date.now(), id).run();
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

  const studentHistoryMatch = path.match(/^\/api\/students\/(\d+)\/history$/);
  if (studentHistoryMatch && request.method === "GET") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id); const id = Number(studentHistoryMatch[1]);
    const student = await db.prepare(`SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?`).bind(id).first();
    if (!student) return json({ error: "Aluno não encontrado." }, 404);
    const history = await db.prepare(`SELECT h.*, u.name AS promoted_by_name FROM student_class_history h LEFT JOIN users u ON u.id = h.promoted_by WHERE h.student_id = ? ORDER BY h.school_year DESC, h.joined_at DESC`).bind(id).all();
    return json({ student, history: history.results });
  }

  const studentPromoteMatch = path.match(/^\/api\/students\/(\d+)\/promote$/);
  if (studentPromoteMatch && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const id = Number(studentPromoteMatch[1]); const body = await readJson(request); const result = await confirmProgression(db, auth.user, id, Number(body.classId), String(body.resultStatus || "completed"), String(body.notes || ""));
    return result.error ? json({ error: result.error }, result.status) : json(result);
  }

  if (path === "/api/agenda-status" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error; const date = String(new URL(request.url).searchParams.get("date") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Informe uma data válida." }, 400);
    const assignment = auth.user.role === "Professor" ? auth.user.assignment : null;
    if (auth.user.role === "Professor" && !assignment) return json({ date, statuses: [] });
    const result = assignment?.subject_id
      ? await db.prepare(`SELECT c.id, c.name, c.grade_level, c.shift, c.school_year, COUNT(DISTINCT a.id) AS record_count, SUM(CASE WHEN a.no_agenda = 0 THEN 1 ELSE 0 END) AS agenda_count, SUM(CASE WHEN a.no_agenda = 1 THEN 1 ELSE 0 END) AS no_agenda_count, GROUP_CONCAT(DISTINCT u.name) AS recorded_by_names, MAX(a.updated_at) AS last_updated_at FROM classes c LEFT JOIN agenda_entries a ON a.class_id = c.id AND a.agenda_date = ? AND (a.subject_id = ? OR EXISTS (SELECT 1 FROM agenda_subjects axs WHERE axs.agenda_id = a.id AND axs.subject_id = ?)) LEFT JOIN users u ON u.id = a.created_by WHERE c.id = ? AND c.status = 'active' GROUP BY c.id ORDER BY c.school_year DESC, c.name`).bind(date, assignment.subject_id, assignment.subject_id, assignment.class_id).all()
      : assignment
        ? await db.prepare(`SELECT c.id, c.name, c.grade_level, c.shift, c.school_year, COUNT(a.id) AS record_count, SUM(CASE WHEN a.no_agenda = 0 THEN 1 ELSE 0 END) AS agenda_count, SUM(CASE WHEN a.no_agenda = 1 THEN 1 ELSE 0 END) AS no_agenda_count, GROUP_CONCAT(DISTINCT u.name) AS recorded_by_names, MAX(a.updated_at) AS last_updated_at FROM classes c LEFT JOIN agenda_entries a ON a.class_id = c.id AND a.agenda_date = ? LEFT JOIN users u ON u.id = a.created_by WHERE c.id = ? AND c.status = 'active' GROUP BY c.id ORDER BY c.school_year DESC, c.name`).bind(date, assignment.class_id).all()
        : await db.prepare(`SELECT c.id, c.name, c.grade_level, c.shift, c.school_year, COUNT(a.id) AS record_count, SUM(CASE WHEN a.no_agenda = 0 THEN 1 ELSE 0 END) AS agenda_count, SUM(CASE WHEN a.no_agenda = 1 THEN 1 ELSE 0 END) AS no_agenda_count, GROUP_CONCAT(DISTINCT u.name) AS recorded_by_names, MAX(a.updated_at) AS last_updated_at FROM classes c LEFT JOIN agenda_entries a ON a.class_id = c.id AND a.agenda_date = ? LEFT JOIN users u ON u.id = a.created_by WHERE c.status = 'active' GROUP BY c.id ORDER BY c.school_year DESC, c.name`).bind(date).all();
    const statuses = result.results.map(row => ({ ...row, record_count: Number(row.record_count || 0), status: Number(row.agenda_count || 0) > 0 ? "with_agenda" : Number(row.no_agenda_count || 0) > 0 ? "no_agenda" : "no_record" }));
    return json({ date, statuses });
  }

  if (path === "/api/agendas" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const base = `SELECT a.*, c.name AS class_name, u.name AS created_by_name, sub.name AS current_subject_name FROM agenda_entries a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by LEFT JOIN subjects sub ON sub.id = a.subject_id`;
    const result = auth.user.role !== "Professor" ? await db.prepare(`${base} ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).all()
      : auth.user.assignment?.education_stage === "Ensino Fundamental" ? await db.prepare(`${base} WHERE a.class_id = ? AND (a.subject_id = ? OR EXISTS (SELECT 1 FROM agenda_subjects axs WHERE axs.agenda_id = a.id AND axs.subject_id = ?)) ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).bind(auth.user.assignment.class_id, auth.user.assignment.subject_id, auth.user.assignment.subject_id).all()
      : await db.prepare(`${base} WHERE a.class_id = ? ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).bind(auth.user.assignment?.class_id || 0).all();
    return json({ agendas: await agendaSubjectsForRows(db, result.results) });
  }

  if (path === "/api/agendas" && request.method === "POST") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id);
    const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const subjectIds = agendaSubjectIds(body); const subjectId = subjectIds[0] || null; const noAgenda = !!body.noAgenda; const content = noAgenda ? "Não tem agenda" : String(body.agenda || body.content || "").trim() || "Agenda registrada"; const materials = noAgenda ? [] : Array.isArray(body.materials) ? body.materials.map(String).slice(0, 20) : []; const now = Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1) return json({ error: "Preencha somente a data e a turma para identificar o registro." }, 400);
    const validation = await validateAgendaSubjects(db, auth.user, classId, subjectIds); if (validation.error) return json({ error: validation.error }, validation.status || 400);
    const context = { klass: validation.klass, educationStage: validation.stage, subject: validation.selected[0] || null };
    const conflict = noAgenda ? await db.prepare(`SELECT id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? LIMIT 1`).bind(date, classId).first() : await db.prepare(`SELECT id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? AND no_agenda = 1 LIMIT 1`).bind(date, classId).first(); if (conflict) return json({ error: noAgenda ? "Já existe uma agenda para esta turma e data. Edite ou remova o registro antes de marcar ‘Não tem agenda’." : "Esta turma e data estão marcadas como ‘Não tem agenda’. Edite esse registro antes de adicionar conteúdo." }, 409);
    const duplicate = await conflictingAgenda(db, date, classId, subjectIds); if (duplicate) return json({ error: "Já existe um registro equivalente para esta turma, data e disciplina. Edite o lançamento existente." }, 409);
    const result = await db.prepare(`INSERT INTO agenda_entries (agenda_date, class_id, subject, subject_id, subject_component, education_stage, school_year, grade_level, teacher_name, content, activity, homework, materials, status, no_agenda, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'Concluída', ?, ?, ?, ?, ?)`)
      .bind(date, classId, validation.selected.map(subject => subject.name).join(", ") || "Sem disciplina", subjectId, subjectIds.length === 1 ? String(body.subjectComponent || "").trim() || null : null, context.educationStage, context.klass.school_year, context.klass.grade_level, String(body.teacherName || "").trim() || context.klass.teacher_name || auth.user.name, content, JSON.stringify(materials), noAgenda ? 1 : 0, String(body.notes || "").trim() || null, auth.user.id, now, now).run();
    const savedId = Number(result.meta.last_row_id); if (!savedId || Number(result.meta.changes || 0) !== 1) return json({ error: "O banco não confirmou o salvamento da agenda." }, 500);
    await replaceAgendaSubjects(db, savedId, subjectIds, now);
    const saved = await db.prepare(`SELECT a.*, c.name AS class_name, u.name AS created_by_name FROM agenda_entries a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ?`).bind(savedId).first();
    if (!saved) return json({ error: "A agenda não pôde ser recuperada após o salvamento." }, 500);
    await audit(db, auth.user.id, "agenda_created", savedId, content); return json({ ok: true, id: savedId, agenda: (await agendaSubjectsForRows(db, [saved]))[0] }, 201);
  }

  const agendaMatch = path.match(/^\/api\/agendas\/(\d+)$/);
  if (agendaMatch && request.method === "PUT") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id);
    const id = Number(agendaMatch[1]); const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const subjectIds = agendaSubjectIds(body); const subjectId = subjectIds[0] || null; const noAgenda = !!body.noAgenda; const content = noAgenda ? "Não tem agenda" : String(body.agenda || body.content || "").trim() || "Agenda registrada"; const materials = noAgenda ? [] : Array.isArray(body.materials) ? body.materials.map(String).slice(0, 20) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1) return json({ error: "Preencha somente a data e a turma para identificar o registro." }, 400);
    const validation = await validateAgendaSubjects(db, auth.user, classId, subjectIds); if (validation.error) return json({ error: validation.error }, validation.status || 400);
    const context = { klass: validation.klass, educationStage: validation.stage, subject: validation.selected[0] || null };
    const conflict = noAgenda ? await db.prepare(`SELECT id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? AND id != ? LIMIT 1`).bind(date, classId, id).first() : await db.prepare(`SELECT id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? AND no_agenda = 1 AND id != ? LIMIT 1`).bind(date, classId, id).first(); if (conflict) return json({ error: noAgenda ? "Já existe outra agenda para esta turma e data." : "Esta turma e data já possuem outro registro ‘Não tem agenda’." }, 409);
    const duplicate = await conflictingAgenda(db, date, classId, subjectIds, id); if (duplicate) return json({ error: "Já existe outro registro equivalente para esta turma, data e disciplina." }, 409);
    const result = await db.prepare(`UPDATE agenda_entries SET agenda_date = ?, class_id = ?, subject = ?, subject_id = ?, subject_component = ?, education_stage = ?, school_year = ?, grade_level = ?, teacher_name = ?, content = ?, activity = NULL, homework = NULL, materials = ?, status = 'Concluída', no_agenda = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .bind(date, classId, validation.selected.map(subject => subject.name).join(", ") || "Sem disciplina", subjectId, subjectIds.length === 1 ? String(body.subjectComponent || "").trim() || null : null, context.educationStage, context.klass.school_year, context.klass.grade_level, String(body.teacherName || "").trim() || context.klass.teacher_name || auth.user.name, content, JSON.stringify(materials), noAgenda ? 1 : 0, String(body.notes || "").trim() || null, Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Agenda não encontrada." }, 404);
    await replaceAgendaSubjects(db, id, subjectIds);
    await audit(db, auth.user.id, "agenda_updated", id, content); return json({ ok: true });
  }

  if (agendaMatch && request.method === "DELETE") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const id = Number(agendaMatch[1]); const existing = await db.prepare(`SELECT content, class_id, subject_id FROM agenda_entries WHERE id = ?`).bind(id).first();
    if (!existing) return json({ error: "Agenda não encontrada." }, 404);
    const links = (await db.prepare(`SELECT subject_id FROM agenda_subjects WHERE agenda_id = ?`).bind(id).all()).results.map(item => Number(item.subject_id));
    const subjectIds = links.length ? links : existing.subject_id ? [Number(existing.subject_id)] : [];
    const validation = await validateAgendaSubjects(db, auth.user, Number(existing.class_id), subjectIds); if (validation.error) return json({ error: validation.error }, validation.status || 403);
    await db.prepare(`DELETE FROM agenda_entries WHERE id = ?`).bind(id).run(); await audit(db, auth.user.id, "agenda_deleted", id, existing.content); return json({ ok: true });
  }

  if (path === "/api/attendance" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams; const date = String(params.get("date") || ""); const classId = Number(params.get("class_id") || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1) return json({ error: "Informe data e turma." }, 400);
    const subjectId = auth.user.role === "Professor" && auth.user.assignment?.education_stage === "Ensino Fundamental" ? Number(auth.user.assignment.subject_id) : null;
    const scopeError = teacherScopeViolation(auth.user, classId, subjectId, "attendance"); if (scopeError) return json({ error: scopeError }, 403);
    const scopeKey = subjectId ? `subject:${subjectId}` : "class";
    const result = await db.prepare(`SELECT s.id AS student_id, s.registration, s.name, COALESCE(a.status, 'present') AS status, COALESCE(a.notes, '') AS notes FROM students s LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = ? AND a.scope_key = ? WHERE s.class_id = ? AND s.status = 'active' ORDER BY s.name`).bind(date, scopeKey, classId).all();
    return json({ records: result.results, subjectId, scopeKey });
  }

  if (path === "/api/attendance" && request.method === "POST") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const records = Array.isArray(body.records) ? body.records : []; const now = Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || classId < 1 || records.length > 300 || records.some(item => !Number.isInteger(Number(item.studentId)) || !ALLOWED_ATTENDANCE.has(String(item.status)))) return json({ error: "Os dados de frequência são inválidos." }, 400);
    const subjectId = auth.user.role === "Professor" && auth.user.assignment?.education_stage === "Ensino Fundamental" ? Number(auth.user.assignment.subject_id) : null;
    const scopeError = teacherScopeViolation(auth.user, classId, subjectId, "attendance"); if (scopeError) return json({ error: scopeError }, 403);
    const klass = await db.prepare(`SELECT school_year FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first(); if (!klass) return json({ error: "Turma não encontrada ou inativa." }, 404);
    if (records.length) {
      const ids = records.map(item => Number(item.studentId)); const valid = await db.prepare(`SELECT COUNT(*) AS total FROM students WHERE class_id = ? AND status = 'active' AND id IN (${ids.map(() => "?").join(",")})`).bind(classId, ...ids).first();
      if (Number(valid.total) !== new Set(ids).size || ids.length !== new Set(ids).size) return json({ error: "A lista contém alunos que não pertencem à turma autorizada." }, 400);
      const scopeKey = subjectId ? `subject:${subjectId}` : "class";
      await db.batch(records.map(item => db.prepare(`INSERT INTO attendance_records (attendance_date, class_id, student_id, subject_id, school_year, scope_key, status, notes, recorded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attendance_date, student_id, scope_key) DO UPDATE SET class_id = excluded.class_id, subject_id = excluded.subject_id, school_year = excluded.school_year, status = excluded.status, notes = excluded.notes, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at`)
        .bind(date, classId, Number(item.studentId), subjectId, klass.school_year, scopeKey, String(item.status), String(item.notes || "").trim() || null, auth.user.id, now, now)));
    }
    await audit(db, auth.user.id, "attendance_saved", classId, `${date} • ${records.length} alunos`); return json({ ok: true, count: records.length });
  }

  if (path === "/api/indicators" && request.method === "GET") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams;
    const from = String(params.get("from") || ""); const to = String(params.get("to") || "");
    const requestedClassId = Number(params.get("class_id") || 0); const requestedSubjectId = Number(params.get("subject_id") || 0); const requestedYear = Number(params.get("school_year") || 0);
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return json({ error: "O período informado é inválido." }, 400);
    const assignment = null;
    const classId = assignment ? Number(assignment.class_id) : requestedClassId;
    const subjectId = assignment ? Number(assignment.subject_id || 0) : requestedSubjectId;
    const schoolYear = assignment ? Number(assignment.school_year) : requestedYear;
    const where = []; const bindings = [];
    if (from) { where.push("a.attendance_date >= ?"); bindings.push(from); }
    if (to) { where.push("a.attendance_date <= ?"); bindings.push(to); }
    if (classId) { where.push("a.class_id = ?"); bindings.push(classId); }
    if (subjectId) { where.push("a.subject_id = ?"); bindings.push(subjectId); }
    if (schoolYear) { where.push("a.school_year = ?"); bindings.push(schoolYear); }
    const filterSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const prepared = sql => db.prepare(sql).bind(...bindings);
    const [distributionResult, classResult, riskResult, studentResult, trendResult, filterClassResult, filterSubjectResult, filterYearResult] = await db.batch([
      prepared(`SELECT a.status, COUNT(*) AS total FROM attendance_records a ${filterSql} GROUP BY a.status`),
      prepared(`SELECT c.id, c.name, c.school_year, COUNT(DISTINCT a.student_id) AS student_count, COUNT(a.id) AS record_count, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended, SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absences FROM attendance_records a JOIN classes c ON c.id = a.class_id ${filterSql} GROUP BY c.id, c.name, c.school_year ORDER BY CAST(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id) DESC, c.name`),
      prepared(`SELECT s.id, s.name, s.registration, c.name AS class_name, c.school_year, COALESCE(sub.name, 'Geral da turma') AS subject_name, COUNT(a.id) AS record_count, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended, SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absences FROM attendance_records a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = a.class_id LEFT JOIN subjects sub ON sub.id = a.subject_id ${filterSql} GROUP BY s.id, s.name, s.registration, c.name, c.school_year, sub.name HAVING COUNT(a.id) > 0 AND CAST(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id) < 0.85 ORDER BY CAST(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS REAL) / COUNT(a.id), s.name LIMIT 100`),
      prepared(`SELECT s.id, s.name, s.registration, c.name AS class_name, c.school_year, COALESCE(sub.name, 'Geral da turma') AS subject_name, COUNT(a.id) AS record_count, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended, SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absences, SUM(CASE WHEN a.status = 'justified' THEN 1 ELSE 0 END) AS justified FROM attendance_records a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = a.class_id LEFT JOIN subjects sub ON sub.id = a.subject_id ${filterSql} GROUP BY s.id, s.name, s.registration, c.name, c.school_year, sub.name ORDER BY c.name, s.name`),
      prepared(`SELECT a.attendance_date AS date, COUNT(*) AS total, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended FROM attendance_records a ${filterSql} GROUP BY a.attendance_date ORDER BY a.attendance_date`),
      db.prepare(`SELECT id, name, school_year FROM classes WHERE status = 'active' ORDER BY school_year DESC, name`),
      db.prepare(`SELECT id, name FROM subjects WHERE status = 'active' ORDER BY name`),
      db.prepare(`SELECT DISTINCT school_year FROM classes WHERE status = 'active' ORDER BY school_year DESC`),
    ]);
    const distribution = { present: 0, late: 0, justified: 0, absent: 0 };
    distributionResult.results.forEach(row => { distribution[row.status] = Number(row.total) || 0; });
    const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
    const overallPercent = total ? Math.round(((distribution.present + distribution.late) / total) * 1000) / 10 : 0;
    const withPercent = row => ({ ...row, student_count: Number(row.student_count || 0), record_count: Number(row.record_count || 0), attended: Number(row.attended || 0), absences: Number(row.absences || 0), justified: Number(row.justified || 0), percent: row.record_count ? Math.round((Number(row.attended) / Number(row.record_count)) * 1000) / 10 : 0 });
    const classRanking = classResult.results.map(withPercent);
    const riskStudents = riskResult.results.map(withPercent);
    const students = studentResult.results.map(withPercent);
    const trend = trendResult.results.map(row => ({ date: row.date, total: Number(row.total), attended: Number(row.attended), percent: row.total ? Math.round((Number(row.attended) / Number(row.total)) * 1000) / 10 : 0 }));
    let comparison = null;
    if (from && to) {
      const fromDate = new Date(`${from}T00:00:00Z`); const toDate = new Date(`${to}T00:00:00Z`); const days = Math.floor((toDate - fromDate) / 86400000) + 1;
      const previousToDate = new Date(fromDate.getTime() - 86400000); const previousFromDate = new Date(previousToDate.getTime() - (days - 1) * 86400000);
      const previousFrom = previousFromDate.toISOString().slice(0, 10); const previousTo = previousToDate.toISOString().slice(0, 10);
      const previousWhere = ["a.attendance_date >= ?", "a.attendance_date <= ?"]; const previousBindings = [previousFrom, previousTo];
      if (classId) { previousWhere.push("a.class_id = ?"); previousBindings.push(classId); }
      if (subjectId) { previousWhere.push("a.subject_id = ?"); previousBindings.push(subjectId); }
      if (schoolYear) { previousWhere.push("a.school_year = ?"); previousBindings.push(schoolYear); }
      const previous = await db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended FROM attendance_records a WHERE ${previousWhere.join(" AND ")}`).bind(...previousBindings).first();
      const previousTotal = Number(previous?.total || 0); const previousPercent = previousTotal ? Math.round((Number(previous.attended || 0) / previousTotal) * 1000) / 10 : 0;
      if (previousTotal) comparison = { from: previousFrom, to: previousTo, total: previousTotal, percent: previousPercent, difference: Math.round((overallPercent - previousPercent) * 10) / 10 };
    }
    const filterOptions = assignment ? { classes: filterClassResult.results.filter(row => Number(row.id) === classId), subjects: assignment.subject_id ? filterSubjectResult.results.filter(row => Number(row.id) === subjectId) : [], years: [schoolYear] } : { classes: filterClassResult.results, subjects: filterSubjectResult.results, years: filterYearResult.results.map(row => Number(row.school_year)) };
    return json({ distribution, total, overallPercent, studentCount: new Set(students.map(row => row.id)).size, classRanking, riskStudents, students, trend, comparison, filters: { from, to, classId: classId || null, subjectId: subjectId || null, schoolYear: schoolYear || null }, filterOptions });
  }

  if (path === "/api/audit" && request.method === "GET") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const result = await db.prepare(`SELECT a.id, a.action, a.details, a.created_at, u.name AS actor_name, u.initials AS actor_initials FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 300`).all();
    return json({ entries: result.results });
  }

  if (path === "/api/system/reset" && request.method === "POST") {
    const auth = await requireAdmin(request, db); if (auth.error) return auth.error;
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
    const result = await db.prepare(`SELECT id, username, name, role, initials, status, email, pending_email, email_verified_at, must_change_password, created_at, updated_at FROM users ORDER BY CASE role WHEN 'Administrador' THEN 1 WHEN 'Coordenação' THEN 2 WHEN 'Financeiro' THEN 3 ELSE 4 END, name`).all();
    const assignments = await db.prepare(`SELECT ta.*, c.name AS class_name, c.grade_level, c.shift, s.name AS subject_name FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id LEFT JOIN subjects s ON s.id = ta.subject_id ORDER BY ta.school_year DESC, c.name, s.name`).all();
    return json({ users: result.results.map(user => {
      const links = assignments.results.filter(item => Number(item.user_id) === Number(user.id));
      const primary = links.find(item => item.status === "active") || links[0] || null;
      return {
        ...user,
        role: displayRole(user.role),
        assignments: links,
        assignment_id: primary?.id || null,
        education_stage: primary?.education_stage || null,
        class_id: primary?.class_id || null,
        class_name: primary?.class_name || null,
        grade_level: primary?.grade_level || null,
        shift: primary?.shift || null,
        subject_id: primary?.subject_id || null,
        subject_name: primary?.subject_name || null,
        school_year: primary?.school_year || null,
        can_attendance: primary?.can_attendance ?? null,
        can_agenda: primary?.can_agenda ?? null,
        assignment_status: primary?.status || null,
      };
    }) });
  }

  if (path === "/api/users" && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const role = internalRole(String(body.role || ""));
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");
    const email = normalizeEmail(body.email);
    const emailEnabled = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
    if (name.length < 3 || username.length < 3 || password.length < 8 || !ALLOWED_ROLES.has(role)) return json({ error: "Preencha nome, usuário, perfil e uma senha com pelo menos 8 caracteres." }, 400);
    if (password !== confirmPassword) return json({ error: "As senhas não coincidem." }, 400);
    if (emailEnabled && !validEmail(email)) return json({ error: "Informe um e-mail individual válido para o novo usuário." }, 400);
    if (email && !validEmail(email)) return json({ error: "Informe um endereço de e-mail válido." }, 400);
    if (email && await emailInUse(db, email)) return json({ error: "Este e-mail já está vinculado a outra conta." }, 409);
    let assignment = null; if (role === "Professor") { await ensureAcademicData(db, auth.user.id); assignment = await validatedTeacherAssignment(db, body, auth.user.id); if (assignment.error) return json({ error: assignment.error }, 400); }
    const salt = randomHex(16); const passwordHash = await hashPassword(password, salt); const now = Date.now();
    try {
      const result = await db.prepare(`INSERT INTO users (username, username_key, name, role, initials, password_hash, password_salt, status, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(username, normalizeUsername(username), name, role, initialsFor(name), passwordHash, salt, body.status === "inactive" ? "inactive" : "active", now, now).run();
      if (role === "Professor") await db.prepare(`INSERT INTO teacher_assignments (user_id, education_stage, class_id, subject_id, school_year, can_attendance, can_agenda, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(result.meta.last_row_id, assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      if (email) {
        try { await requestEmailVerification(db, env, { userId: result.meta.last_row_id, email, actorId: auth.user.id, username }); }
        catch (error) { await db.prepare(`DELETE FROM users WHERE id = ?`).bind(result.meta.last_row_id).run(); throw error; }
      }
      await audit(db, auth.user.id, "user_created", result.meta.last_row_id, username);
      return json({ ok: true, id: result.meta.last_row_id, username, emailStatus: email ? "pending" : "missing", mustChangePassword: true }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Esse nome de usuário já está em uso." }, 409);
      throw error;
    }
  }

  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  const userEmailVerificationMatch = path.match(/^\/api\/users\/(\d+)\/email-verification$/);
  if (userEmailVerificationMatch && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const targetId = Number(userEmailVerificationMatch[1]), body = await readJson(request), existing = await db.prepare(`SELECT id, username, email, pending_email FROM users WHERE id = ?`).bind(targetId).first();
    if (!existing) return json({ error: "Usuário não encontrado." }, 404);
    const email = normalizeEmail(body.email || existing.pending_email || existing.email);
    if (existing.email === email && !existing.pending_email) return json({ error: "Este e-mail já está verificado para a conta." }, 400);
    try { const result = await requestEmailVerification(db, env, { userId: targetId, email, actorId: auth.user.id, username: existing.username }); return json({ ok: true, ...result, message: "Verificação enviada. O e-mail continuará pendente até a confirmação do usuário." }); }
    catch (error) { return json({ error: error.message || "Não foi possível enviar a verificação." }, /outra conta/.test(error.message) ? 409 : /válido/.test(error.message) ? 400 : 503); }
  }
  const assignmentCollectionMatch = path.match(/^\/api\/users\/(\d+)\/assignments$/);
  if (assignmentCollectionMatch && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const userId = Number(assignmentCollectionMatch[1]); const body = await readJson(request); await ensureAcademicData(db, auth.user.id); const assignment = await validatedTeacherAssignment(db, body, auth.user.id); if (assignment.error) return json({ error: assignment.error }, 400);
    const teacher = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'Professor'`).bind(userId).first(); if (!teacher) return json({ error: "Professor não encontrado." }, 404);
    const existing = assignment.subjectId
      ? await db.prepare(`SELECT id, status FROM teacher_assignments WHERE user_id = ? AND class_id = ? AND subject_id = ? AND school_year = ?`).bind(userId, assignment.classId, assignment.subjectId, assignment.schoolYear).first()
      : await db.prepare(`SELECT id, status FROM teacher_assignments WHERE user_id = ? AND class_id = ? AND subject_id IS NULL AND school_year = ?`).bind(userId, assignment.classId, assignment.schoolYear).first();
    const now = Date.now();
    if (existing) {
      if (existing.status === "active") return json({ error: "Esta atribuição já está cadastrada e ativa para o professor." }, 409);
      await db.prepare(`UPDATE teacher_assignments SET education_stage = ?, can_attendance = ?, can_agenda = ?, status = 'active', updated_at = ? WHERE id = ?`).bind(assignment.stage, assignment.canAttendance, assignment.canAgenda, now, existing.id).run();
      await audit(db, auth.user.id, "teacher_assignment_reactivated", userId, `${assignment.classId} • ${assignment.subjectId || 'geral'} • ${assignment.schoolYear}`); return json({ ok: true, id: existing.id, reactivated: true });
    }
    const result = await db.prepare(`INSERT INTO teacher_assignments (user_id, education_stage, class_id, subject_id, school_year, can_attendance, can_agenda, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).bind(userId, assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, auth.user.id, now, now).run();
    await audit(db, auth.user.id, "teacher_assignment_created", userId, `${assignment.classId} • ${assignment.subjectId || 'geral'} • ${assignment.schoolYear}`); return json({ ok: true, id: result.meta.last_row_id }, 201);
  }

  const assignmentMatch = path.match(/^\/api\/teacher-assignments\/(\d+)$/);
  if (assignmentMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error; const body = await readJson(request), id = Number(assignmentMatch[1]), current = await db.prepare(`SELECT * FROM teacher_assignments WHERE id = ?`).bind(id).first();
    if (!current) return json({ error: "Atribuição não encontrada." }, 404);
    if (body.classId !== undefined || body.educationStage !== undefined || body.subjectId !== undefined) {
      await ensureAcademicData(db, auth.user.id); const assignment = await validatedTeacherAssignment(db, body, auth.user.id); if (assignment.error) return json({ error: assignment.error }, 400);
      try {
        await db.prepare(`UPDATE teacher_assignments SET education_stage = ?, class_id = ?, subject_id = ?, school_year = ?, can_attendance = ?, can_agenda = ?, status = ?, updated_at = ? WHERE id = ?`).bind(assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
      } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Este professor já possui essa turma e disciplina neste ano letivo." }, 409); throw error; }
      await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(current.user_id).run();
      await audit(db, auth.user.id, "teacher_assignment_updated", current.user_id, `${assignment.classId} • ${assignment.subjectId || 'geral'} • ${assignment.schoolYear}`); return json({ ok: true, id });
    }
    const status = body.status === "inactive" ? "inactive" : "active"; await db.prepare(`UPDATE teacher_assignments SET status = ?, updated_at = ? WHERE id = ?`).bind(status, Date.now(), id).run(); await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(current.user_id).run(); await audit(db, auth.user.id, "teacher_assignment_status", id, status); return json({ ok: true, id });
  }

  if (userMatch && request.method === "PUT") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const targetId = Number(userMatch[1]); const existing = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(targetId).first();
    if (!existing) return json({ error: "Usuário não encontrado." }, 404);
    const body = await readJson(request); const name = String(body.name || "").trim(); const username = String(body.username || "").trim(); const role = internalRole(String(body.role || "")); const status = body.status === "inactive" ? "inactive" : "active";
    if (name.length < 3 || username.length < 3 || !ALLOWED_ROLES.has(role)) return json({ error: "Preencha nome, usuário e perfil corretamente." }, 400);
    const existingAssignmentCount = role === "Professor" ? await db.prepare(`SELECT COUNT(*) AS total FROM teacher_assignments WHERE user_id = ?`).bind(targetId).first() : { total: 0 };
    let assignment = null; if (role === "Professor" && (!Number(existingAssignmentCount.total) || body.updatePrimaryAssignment === true)) { await ensureAcademicData(db, auth.user.id); assignment = await validatedTeacherAssignment(db, body, auth.user.id); if (assignment.error) return json({ error: assignment.error }, 400); }
    if (existing.role === "Administrador" && (role !== "Administrador" || status !== "active")) {
      const count = await db.prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'Administrador' AND status = 'active'`).first();
      if (count.total <= 1) return json({ error: "O sistema precisa manter pelo menos um administrador ativo." }, 400);
    }
    try {
      if (body.password) {
        if (String(body.password).length < 8) return json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, 400);
        const salt = randomHex(16); const passwordHash = await hashPassword(String(body.password), salt);
        await db.prepare(`UPDATE users SET username = ?, username_key = ?, name = ?, role = ?, initials = ?, status = ?, password_hash = ?, password_salt = ?, must_change_password = 1, updated_at = ? WHERE id = ?`)
          .bind(username, normalizeUsername(username), name, role, initialsFor(name), status, passwordHash, salt, Date.now(), targetId).run();
      } else {
        await db.prepare(`UPDATE users SET username = ?, username_key = ?, name = ?, role = ?, initials = ?, status = ?, updated_at = ? WHERE id = ?`)
          .bind(username, normalizeUsername(username), name, role, initialsFor(name), status, Date.now(), targetId).run();
      }
      if (role === "Professor" && assignment) {
        const existingAssignment = await db.prepare(`SELECT id FROM teacher_assignments WHERE user_id = ? ORDER BY id LIMIT 1`).bind(targetId).first();
        if (existingAssignment) await db.prepare(`UPDATE teacher_assignments SET education_stage = ?, class_id = ?, subject_id = ?, school_year = ?, can_attendance = ?, can_agenda = ?, status = ?, updated_at = ? WHERE id = ?`).bind(assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, status, Date.now(), existingAssignment.id).run();
        else await db.prepare(`INSERT INTO teacher_assignments (user_id, education_stage, class_id, subject_id, school_year, can_attendance, can_agenda, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(targetId, assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, status, auth.user.id, Date.now(), Date.now()).run();
      }
      else if (role !== "Professor") await db.prepare(`UPDATE teacher_assignments SET status = 'inactive', updated_at = ? WHERE user_id = ? AND status = 'active'`).bind(Date.now(), targetId).run();
      if (status === "inactive" || role === "Professor" || body.password) await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetId).run();
      await audit(db, auth.user.id, "user_updated", targetId, username); return json({ ok: true });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ error: "Esse nome de usuário já está em uso." }, 409);
      throw error;
    }
  }

  const resetPasswordMatch = path.match(/^\/api\/users\/(\d+)\/reset-password$/);
  if (resetPasswordMatch && request.method === "POST") {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const targetId = Number(resetPasswordMatch[1]); const existing = await db.prepare(`SELECT username, name FROM users WHERE id = ?`).bind(targetId).first(); if (!existing) return json({ error: "Usuário não encontrado." }, 404);
    const password = temporaryPassword(); const salt = randomHex(16); const passwordHash = await hashPassword(password, salt); const now = Date.now();
    await db.batch([
      db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1, updated_at = ? WHERE id = ?`).bind(passwordHash, salt, now, targetId),
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetId),
      db.prepare(`INSERT INTO recovery_requests (user_id, identifier_hash, ip_hash, kind, status, created_at) VALUES (?, ?, ?, 'administrative_reset', 'completed', ?)`).bind(targetId, await hashToken(existing.username), await hashToken(request.headers.get("cf-connecting-ip") || "unknown"), now),
    ]);
    await audit(db, auth.user.id, "user_password_reset", targetId, existing.username); return json({ ok: true, username: existing.username, name: existing.name, temporaryPassword: password });
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
      if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
        const origin = request.headers.get("origin") || "";
        if (!ALLOWED_EXTERNAL_ORIGINS.has(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization, x-teacher-assignment-id", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-max-age": "86400", "vary": "Origin" } });
      }
      if (url.pathname.startsWith("/api/")) return withCors(await handleApi(request, env, url.pathname), request);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/" || url.pathname === "/index.html") return new Response(INDEX_HTML, { headers: securityHeaders("text/html; charset=utf-8") });
      if (url.pathname === "/styles.css") return new Response(STYLES, { headers: securityHeaders("text/css; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/app.js") return new Response(APP_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/enrollments.js") return new Response(ENROLLMENTS_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/library.js") return new Response(LIBRARY_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/reports.js") return new Response(REPORTS_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/progressions.js") return new Response(PROGRESSIONS_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/agenda-status.js") return new Response(AGENDA_STATUS_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/help.js") return new Response(HELP_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/assets/logo-crescer.png") return new Response(decodeBase64(LOGO_BASE64), { headers: securityHeaders("image/png", "public, max-age=86400") });
      return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
    } catch (error) {
      console.error("Request failed", error);
      return url.pathname.startsWith("/api/") ? withCors(json({ error: "Erro interno. Tente novamente." }, 500), request) : new Response("Internal error", { status: 500 });
    }
  },
};
