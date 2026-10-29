const INDEX_HTML = __INDEX_HTML__;
const STYLES = __STYLES__;
const APP_JS = __APP_JS__;
const ENROLLMENTS_JS = __ENROLLMENTS_JS__;
const LIBRARY_JS = __LIBRARY_JS__;
const LOGO_BASE64 = __LOGO_BASE64__;

const SESSION_COOKIE = "crescer_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 40000;
const ALLOWED_EXTERNAL_ORIGINS = new Set([
  "https://moreiradv.github.io",
  "https://crescer-escola-web.vercel.app",
]);
const ALLOWED_ROLES = new Set(["Coordenação", "Financeiro", "Administrador", "Professor"]);
const MANAGER_ROLES = new Set(["Administrador", "Coordenação", "Financeiro"]);
const PEDAGOGICAL_ROLES = new Set(["Administrador", "Coordenação", "Financeiro", "Professor"]);
const ENROLLMENT_ROLES = new Set(["Administrador", "Coordenação", "Financeiro"]);
const ALLOWED_ATTENDANCE = new Set(["present", "late", "justified", "absent"]);
const ALLOWED_SHIFTS = new Set(["Matutino", "Vespertino", "Integral", "Noturno"]);

function normalizeUsername(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
}

function safeUser(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role, initials: row.initials, status: row.status, mustChangePassword: !!(row.must_change_password ?? row.mustChangePassword), assignment: row.assignment || null };
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
  headers.set("access-control-allow-headers", "content-type, authorization");
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

function bootstrapUsers(env) {
  try {
    const parsed = JSON.parse(env.BOOTSTRAP_USERS_JSON || "{}");
    return Array.isArray(parsed.users) ? parsed.users.filter(user => user.username && user.passwordHash && user.salt && ALLOWED_ROLES.has(user.role)) : [];
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
  const row = await db.prepare(`SELECT u.id, u.username, u.name, u.role, u.initials, u.status, u.must_change_password, s.id AS session_id, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1`).bind(tokenHash).first();
  if (!row || row.status !== "active" || row.expires_at <= Date.now()) {
    if (row?.session_id) await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.session_id).run();
    return null;
  }
  return { ...safeUser(row), sessionId: row.session_id };
}

async function teacherAssignment(db, userId) {
  return db.prepare(`SELECT ta.*, c.name AS class_name, c.grade_level, c.shift, s.name AS subject_name FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id LEFT JOIN subjects s ON s.id = ta.subject_id WHERE ta.user_id = ? AND ta.status = 'active' LIMIT 1`).bind(userId).first();
}

async function enrichUser(db, user) {
  if (!user || user.role !== "Professor") return user;
  return { ...user, assignment: await teacherAssignment(db, user.id) || null };
}

function teacherScopeViolation(user, classId, subjectId = null, capability = "agenda") {
  if (user.role !== "Professor") return null;
  const assignment = user.assignment;
  if (!assignment || assignment.status !== "active") return "Sua conta de professor ainda não possui uma turma ativa vinculada.";
  if (Number(assignment.class_id) !== Number(classId)) return "Sua conta não possui acesso a esta turma.";
  if (capability === "agenda" && !assignment.can_agenda) return "A Agenda Escolar não está habilitada para esta conta.";
  if (capability === "attendance" && !assignment.can_attendance) return "A frequência não está habilitada para esta conta.";
  if (assignment.education_stage === "Ensino Fundamental" && Number(assignment.subject_id) !== Number(subjectId)) return "Sua conta não possui acesso a esta disciplina.";
  return null;
}

async function validatedTeacherAssignment(db, body) {
  const classId = Number(body.classId); const stage = String(body.educationStage || ""); const subjectId = Number(body.subjectId) || null;
  if (!Number.isInteger(classId) || !DEFAULT_SUBJECTS[stage]) return { error: "Selecione a etapa e a turma do professor." };
  const klass = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first(); if (!klass) return { error: "Turma não encontrada." };
  const actualStage = educationStageFor(`${klass.grade_level} ${klass.name}`); if (actualStage !== stage) return { error: "A etapa selecionada não corresponde à turma." };
  if (stage === "Ensino Fundamental") {
    if (!subjectId) return { error: "Selecione a disciplina do professor." };
    const subject = await db.prepare(`SELECT id FROM subjects WHERE id = ? AND education_stage = ? AND status = 'active'`).bind(subjectId, stage).first(); if (!subject) return { error: "Disciplina inválida para o Ensino Fundamental." };
  }
  return { classId, stage, subjectId: stage === "Ensino Fundamental" ? subjectId : null, schoolYear: Number(klass.school_year), canAttendance: body.canAttendance === false ? 0 : 1, canAgenda: body.canAgenda === false ? 0 : 1 };
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
  if (!MANAGER_ROLES.has(user.role)) return { error: json({ error: "Apenas administração, coordenação e financeiro podem realizar esta ação." }, 403) };
  return { user };
}

async function requirePedagogical(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  if (!PEDAGOGICAL_ROLES.has(user.role)) return { error: json({ error: "Seu perfil não possui acesso às funções pedagógicas." }, 403) };
  return { user: await enrichUser(db, user) };
}

async function requireUser(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  const passwordBlock = passwordChangeRequired(user); if (passwordBlock) return passwordBlock;
  return { user: await enrichUser(db, user) };
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

const DEFAULT_GRADES = ["Infantil 3", "Infantil 4", "Infantil 5", "1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano", "6º Ano"];
const DEFAULT_SUBJECTS = {
  "Educação Infantil": ["Matemática", "Natureza e Sociedade", "Educação Física", "Ensino Religioso", "Linguagem", "Arte"],
  "Ensino Fundamental": ["Inglês", "Português", "Matemática", "Ciências", "Geografia", "Ensino Religioso", "História", "Arte"],
};
const DEFAULT_COMPONENTS = { "Matemática": ["Oficina de Negócios"], "Ensino Religioso": ["Cidadania, Moral e Ética"], "Linguagem": ["Português", "Caligrafia"] };
const educationStageFor = value => /infantil|educação infantil/i.test(String(value || "")) ? "Educação Infantil" : "Ensino Fundamental";

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

const LIBRARY_IMAGE_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
const libraryKey = value => normalizeUsername(value).replace(/[^a-z0-9 ]/g, "").trim();
const nullableText = (value, max = 5000) => String(value || "").trim().slice(0, max) || null;

async function handleLibraryApi(request, env, path) {
  if (!path.startsWith("/api/library-books")) return null;
  const db = env.DB;
  const coverMatch = path.match(/^\/api\/library-books\/(\d+)\/cover$/);

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
    if (auth.user.role === "Professor") return json({ error: "A Biblioteca não faz parte das permissões desta conta de professor." }, 403);
    const search = String(new URL(request.url).searchParams.get("search") || "").trim();
    const result = search
      ? await db.prepare(`SELECT b.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM library_books b LEFT JOIN users creator ON creator.id = b.created_by LEFT JOIN users updater ON updater.id = b.updated_by WHERE b.title LIKE ? OR COALESCE(b.author, '') LIKE ? ORDER BY b.title LIMIT 500`).bind(`%${search}%`, `%${search}%`).all()
      : await db.prepare(`SELECT b.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM library_books b LEFT JOIN users creator ON creator.id = b.created_by LEFT JOIN users updater ON updater.id = b.updated_by ORDER BY b.title LIMIT 500`).all();
    return json({ books: result.results });
  }

  const bookMatch = path.match(/^\/api\/library-books\/(\d+)$/);
  if (bookMatch && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    if (auth.user.role === "Professor") return json({ error: "A Biblioteca não faz parte das permissões desta conta de professor." }, 403);
    const book = await db.prepare(`SELECT b.*, creator.name AS created_by_name, updater.name AS updated_by_name FROM library_books b LEFT JOIN users creator ON creator.id = b.created_by LEFT JOIN users updater ON updater.id = b.updated_by WHERE b.id = ?`).bind(Number(bookMatch[1])).first();
    return book ? json({ book }) : json({ error: "Livro não encontrado." }, 404);
  }

  if ((path === "/api/library-books" && request.method === "POST") || (bookMatch && request.method === "PUT")) {
    const auth = await requireManager(request, db); if (auth.error) return auth.error;
    const body = await readJson(request); const id = bookMatch ? Number(bookMatch[1]) : 0; const title = String(body.title || "").trim().slice(0, 240); const author = nullableText(body.author, 240); const publicationYear = body.publicationYear === "" || body.publicationYear == null ? null : Number(body.publicationYear); const quantity = body.quantity === "" || body.quantity == null ? null : Number(body.quantity); const now = Date.now();
    if (title.length < 2) return json({ error: "Informe o nome do livro." }, 400);
    if (publicationYear !== null && (!Number.isInteger(publicationYear) || publicationYear < 1000 || publicationYear > 2200)) return json({ error: "Informe um ano de publicação válido." }, 400);
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000)) return json({ error: "Informe uma quantidade de exemplares válida." }, 400);
    const duplicate = await db.prepare(`SELECT id FROM library_books WHERE title_key = ? AND author_key = ? AND id != ? LIMIT 1`).bind(libraryKey(title), libraryKey(author), id).first();
    if (duplicate) return json({ error: "Já existe um livro com o mesmo nome e autor no acervo." }, 409);
    const values = [title, libraryKey(title), author, libraryKey(author), nullableText(body.synopsis, 12000), nullableText(body.publisher, 240), publicationYear, nullableText(body.ageRange, 120), quantity, nullableText(body.notes, 5000)];
    if (id) {
      const result = await db.prepare(`UPDATE library_books SET title = ?, title_key = ?, author = ?, author_key = ?, synopsis = ?, publisher = ?, publication_year = ?, age_range = ?, quantity = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...values, auth.user.id, now, id).run();
      if (!result.meta.changes) return json({ error: "Livro não encontrado." }, 404);
      await audit(db, auth.user.id, "library_book_updated", id, title); return json({ ok: true, id });
    }
    const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "America/Araguaina" }).format(new Date()); const code = `BIB-${year}-${randomHex(4).toUpperCase()}`;
    const result = await db.prepare(`INSERT INTO library_books (accession_code, title, title_key, author, author_key, synopsis, publisher, publication_year, age_range, quantity, notes, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(code, ...values, auth.user.id, auth.user.id, now, now).run();
    await audit(db, auth.user.id, "library_book_created", result.meta.last_row_id, title); return json({ ok: true, id: result.meta.last_row_id, accessionCode: code }, 201);
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
        const current = await db.prepare(`SELECT class_id FROM students WHERE id = ?`).bind(existing.student_id).first();
        await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = ?, updated_at = ? WHERE id = ?`).bind(registration, studentName, birthDate, guardianName, guardianPhone, classId, now, existing.student_id).run();
        if (classId && Number(current?.class_id) !== classId) await db.batch([
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
        if (classId && Number(studentExists?.class_id) !== classId) await db.prepare(`UPDATE student_class_history SET result_status = 'transferred', left_at = ?, updated_at = ? WHERE student_id = ? AND class_id = ? AND left_at IS NULL`).bind(now, now, studentId, studentExists?.class_id).run();
        await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = ?, status = 'active', updated_at = ? WHERE id = ?`).bind(registration, studentName, birthDate, guardianName, guardianPhone, classId, now, studentId).run();
      }
      await db.prepare(`UPDATE enrollments SET student_id = ?, school_year = ? WHERE id = ?`).bind(studentId, schoolYear, enrollmentId).run();
      if (classId) await db.prepare(`INSERT OR IGNORE INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).bind(studentId, classId, schoolYear, klass.grade_level, klass.name, now, auth.user.id, now, now).run();
    }
    await audit(db, auth.user.id, completing ? "enrollment_completed" : (id ? "enrollment_updated" : "enrollment_draft"), enrollmentId, `${registration} • ${studentName}`);
    return json({ ok: true, id: enrollmentId, status }, id ? 200 : 201);
  }

  return json({ error: "Rota de matrículas não encontrada." }, 404);
}

async function handleApi(request, env, path) {
  const db = env.DB;
  if (!db) return json({ error: "Banco de dados indisponível." }, 503);

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
    return json({ user: user ? safeUser(await enrichUser(db, user)) : null }, user ? 200 : 401);
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
    const updated = await db.prepare(`SELECT id, username, name, role, initials, status, must_change_password FROM users WHERE id = ?`).bind(user.id).first();
    return json({ ok: true, user: safeUser(await enrichUser(db, safeUser(updated))) });
  }

  if (path === "/api/academic-config" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const catalog = await academicCatalog(db, auth.user.id);
    if (auth.user.role === "Professor") {
      if (!auth.user.assignment) return json({ subjects: [] });
      catalog.subjects = auth.user.assignment.education_stage === "Ensino Fundamental"
        ? catalog.subjects.filter(subject => Number(subject.id) === Number(auth.user.assignment.subject_id))
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
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
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

  if (path === "/api/classes" && request.method === "GET") {
    const auth = await requireUser(request, db); if (auth.error) return auth.error;
    const result = auth.user.role === "Professor"
      ? await db.prepare(`SELECT c.*, COUNT(s.id) AS student_count FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active' WHERE c.id = ? GROUP BY c.id`).bind(auth.user.assignment?.class_id || 0).all()
      : await db.prepare(`SELECT c.*, COUNT(s.id) AS student_count FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active' GROUP BY c.id ORDER BY c.school_year DESC, c.name`).all();
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
    const requestedClassId = Number(new URL(request.url).searchParams.get("class_id") || 0); const classId = auth.user.role === "Professor" ? Number(auth.user.assignment?.class_id || 0) : requestedClassId;
    if (auth.user.role === "Professor" && !classId) return json({ students: [] });
    const statement = classId
      ? db.prepare(`SELECT s.*, c.name AS class_name, c.shift AS class_shift, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.class_id = ? ORDER BY c.school_year DESC, s.name`).bind(classId)
      : db.prepare(`SELECT s.*, c.name AS class_name, c.shift AS class_shift, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id ORDER BY c.school_year DESC, s.name`);
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
    const id = Number(studentPromoteMatch[1]); const body = await readJson(request); const classId = Number(body.classId); const resultStatus = ["completed", "retained", "transferred"].includes(body.resultStatus) ? body.resultStatus : "completed"; const now = Date.now();
    await ensureAcademicData(db, auth.user.id);
    const [student, targetClass] = await Promise.all([db.prepare(`SELECT s.*, c.school_year AS current_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?`).bind(id).first(), db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first()]);
    if (!student || !targetClass) return json({ error: "Aluno ou turma de destino não encontrado." }, 404);
    if (Number(student.class_id) === classId) return json({ error: "Escolha uma turma diferente da atual." }, 400);
    if (Number(targetClass.school_year) < Number(student.current_year || 0)) return json({ error: "A turma de destino precisa ser do mesmo ano ou de um ano posterior." }, 400);
    await db.batch([
      db.prepare(`UPDATE student_class_history SET result_status = ?, notes = ?, left_at = ?, updated_at = ? WHERE student_id = ? AND class_id = ? AND left_at IS NULL`).bind(resultStatus, String(body.notes || "").trim() || null, now, now, id, student.class_id),
      db.prepare(`INSERT OR IGNORE INTO student_class_history (student_id, class_id, school_year, grade_level_snapshot, class_name_snapshot, result_status, notes, joined_at, promoted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`).bind(id, classId, targetClass.school_year, targetClass.grade_level, targetClass.name, now, auth.user.id, now, now),
      db.prepare(`UPDATE students SET class_id = ?, status = 'active', updated_at = ? WHERE id = ?`).bind(classId, now, id),
    ]);
    await audit(db, auth.user.id, "student_promoted", id, `${student.name} → ${targetClass.name} • ${targetClass.school_year}`); return json({ ok: true });
  }

  if (path === "/api/agendas" && request.method === "GET") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const base = `SELECT a.*, c.name AS class_name, u.name AS created_by_name, sub.name AS current_subject_name FROM agenda_entries a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by LEFT JOIN subjects sub ON sub.id = a.subject_id`;
    const result = auth.user.role !== "Professor" ? await db.prepare(`${base} ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).all()
      : auth.user.assignment?.education_stage === "Ensino Fundamental" ? await db.prepare(`${base} WHERE a.class_id = ? AND a.subject_id = ? ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).bind(auth.user.assignment.class_id, auth.user.assignment.subject_id).all()
      : await db.prepare(`${base} WHERE a.class_id = ? ORDER BY a.agenda_date DESC, a.created_at DESC LIMIT 500`).bind(auth.user.assignment?.class_id || 0).all();
    return json({ agendas: result.results.map(row => ({ ...row, materials: JSON.parse(row.materials || "[]") })) });
  }

  if (path === "/api/agendas" && request.method === "POST") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id);
    const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const subjectId = Number(body.subjectId); const noAgenda = !!body.noAgenda; const content = noAgenda ? "Não teve agenda" : String(body.agenda || body.content || "").trim(); const materials = noAgenda ? [] : Array.isArray(body.materials) ? body.materials.map(String).slice(0, 20) : []; const now = Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || !Number.isInteger(subjectId) || (!noAgenda && content.length < 3)) return json({ error: "Preencha data, turma, disciplina e AGENDA, ou marque ‘Não teve agenda’." }, 400);
    const scopeError = teacherScopeViolation(auth.user, classId, subjectId, "agenda"); if (scopeError) return json({ error: scopeError }, 403);
    const context = await agendaContext(db, classId, subjectId); if (!context) return json({ error: "A disciplina escolhida não pertence à etapa desta turma." }, 400);
    const duplicate = await db.prepare(`SELECT id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? AND subject_id = ? LIMIT 1`).bind(date, classId, subjectId).first(); if (duplicate) return json({ error: "Já existe uma agenda para esta turma, disciplina e data. Edite o registro existente." }, 409);
    const result = await db.prepare(`INSERT INTO agenda_entries (agenda_date, class_id, subject, subject_id, subject_component, education_stage, school_year, grade_level, teacher_name, content, activity, homework, materials, status, no_agenda, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'Concluída', ?, ?, ?, ?, ?)`)
      .bind(date, classId, context.subject.name, subjectId, String(body.subjectComponent || "").trim() || null, context.educationStage, context.klass.school_year, context.klass.grade_level, String(body.teacherName || "").trim() || context.klass.teacher_name || auth.user.name, content, JSON.stringify(materials), noAgenda ? 1 : 0, String(body.notes || "").trim() || null, auth.user.id, now, now).run();
    await audit(db, auth.user.id, "agenda_created", result.meta.last_row_id, content); return json({ ok: true, id: result.meta.last_row_id }, 201);
  }

  const agendaMatch = path.match(/^\/api\/agendas\/(\d+)$/);
  if (agendaMatch && request.method === "PUT") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    await ensureAcademicData(db, auth.user.id);
    const id = Number(agendaMatch[1]); const body = await readJson(request); const date = String(body.date || ""); const classId = Number(body.classId); const subjectId = Number(body.subjectId); const noAgenda = !!body.noAgenda; const content = noAgenda ? "Não teve agenda" : String(body.agenda || body.content || "").trim(); const materials = noAgenda ? [] : Array.isArray(body.materials) ? body.materials.map(String).slice(0, 20) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(classId) || !Number.isInteger(subjectId) || (!noAgenda && content.length < 3)) return json({ error: "Preencha data, turma, disciplina e AGENDA, ou marque ‘Não teve agenda’." }, 400);
    const scopeError = teacherScopeViolation(auth.user, classId, subjectId, "agenda"); if (scopeError) return json({ error: scopeError }, 403);
    const context = await agendaContext(db, classId, subjectId); if (!context) return json({ error: "A disciplina escolhida não pertence à etapa desta turma." }, 400);
    const duplicate = await db.prepare(`SELECT id FROM agenda_entries WHERE agenda_date = ? AND class_id = ? AND subject_id = ? AND id != ? LIMIT 1`).bind(date, classId, subjectId, id).first(); if (duplicate) return json({ error: "Já existe outra agenda para esta turma, disciplina e data." }, 409);
    const result = await db.prepare(`UPDATE agenda_entries SET agenda_date = ?, class_id = ?, subject = ?, subject_id = ?, subject_component = ?, education_stage = ?, school_year = ?, grade_level = ?, teacher_name = ?, content = ?, activity = NULL, homework = NULL, materials = ?, status = 'Concluída', no_agenda = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .bind(date, classId, context.subject.name, subjectId, String(body.subjectComponent || "").trim() || null, context.educationStage, context.klass.school_year, context.klass.grade_level, String(body.teacherName || "").trim() || context.klass.teacher_name || auth.user.name, content, JSON.stringify(materials), noAgenda ? 1 : 0, String(body.notes || "").trim() || null, Date.now(), id).run();
    if (!result.meta.changes) return json({ error: "Agenda não encontrada." }, 404);
    await audit(db, auth.user.id, "agenda_updated", id, content); return json({ ok: true });
  }

  if (agendaMatch && request.method === "DELETE") {
    const auth = await requirePedagogical(request, db); if (auth.error) return auth.error;
    const id = Number(agendaMatch[1]); const existing = await db.prepare(`SELECT content, class_id, subject_id FROM agenda_entries WHERE id = ?`).bind(id).first();
    if (!existing) return json({ error: "Agenda não encontrada." }, 404);
    const scopeError = teacherScopeViolation(auth.user, existing.class_id, existing.subject_id, "agenda"); if (scopeError) return json({ error: scopeError }, 403);
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
    const result = await db.prepare(`SELECT u.id, u.username, u.name, u.role, u.initials, u.status, u.must_change_password, u.created_at, u.updated_at, ta.education_stage, ta.class_id, ta.subject_id, ta.school_year, ta.can_attendance, ta.can_agenda, c.name AS class_name, s.name AS subject_name FROM users u LEFT JOIN teacher_assignments ta ON ta.user_id = u.id LEFT JOIN classes c ON c.id = ta.class_id LEFT JOIN subjects s ON s.id = ta.subject_id ORDER BY CASE u.role WHEN 'Administrador' THEN 1 WHEN 'Coordenação' THEN 2 WHEN 'Financeiro' THEN 3 ELSE 4 END, u.name`).all();
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
    let assignment = null; if (role === "Professor") { await ensureAcademicData(db, auth.user.id); assignment = await validatedTeacherAssignment(db, body); if (assignment.error) return json({ error: assignment.error }, 400); }
    const salt = randomHex(16); const passwordHash = await hashPassword(password, salt); const now = Date.now();
    try {
      const result = await db.prepare(`INSERT INTO users (username, username_key, name, role, initials, password_hash, password_salt, status, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(username, normalizeUsername(username), name, role, initialsFor(name), passwordHash, salt, body.status === "inactive" ? "inactive" : "active", now, now).run();
      if (role === "Professor") await db.prepare(`INSERT INTO teacher_assignments (user_id, education_stage, class_id, subject_id, school_year, can_attendance, can_agenda, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(result.meta.last_row_id, assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      await audit(db, auth.user.id, "user_created", result.meta.last_row_id, username);
      return json({ ok: true, id: result.meta.last_row_id, username, mustChangePassword: true }, 201);
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
    let assignment = null; if (role === "Professor") { await ensureAcademicData(db, auth.user.id); assignment = await validatedTeacherAssignment(db, body); if (assignment.error) return json({ error: assignment.error }, 400); }
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
      if (role === "Professor") await db.prepare(`INSERT INTO teacher_assignments (user_id, education_stage, class_id, subject_id, school_year, can_attendance, can_agenda, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET education_stage = excluded.education_stage, class_id = excluded.class_id, subject_id = excluded.subject_id, school_year = excluded.school_year, can_attendance = excluded.can_attendance, can_agenda = excluded.can_agenda, status = excluded.status, updated_at = excluded.updated_at`)
        .bind(targetId, assignment.stage, assignment.classId, assignment.subjectId, assignment.schoolYear, assignment.canAttendance, assignment.canAgenda, status, auth.user.id, existing.created_at || Date.now(), Date.now()).run();
      else await db.prepare(`DELETE FROM teacher_assignments WHERE user_id = ?`).bind(targetId).run();
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
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-max-age": "86400", "vary": "Origin" } });
      }
      if (url.pathname.startsWith("/api/")) return withCors(await handleApi(request, env, url.pathname), request);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/" || url.pathname === "/index.html") return new Response(INDEX_HTML, { headers: securityHeaders("text/html; charset=utf-8") });
      if (url.pathname === "/styles.css") return new Response(STYLES, { headers: securityHeaders("text/css; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/app.js") return new Response(APP_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/enrollments.js") return new Response(ENROLLMENTS_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/library.js") return new Response(LIBRARY_JS, { headers: securityHeaders("text/javascript; charset=utf-8", "public, max-age=3600") });
      if (url.pathname === "/assets/logo-crescer.png") return new Response(decodeBase64(LOGO_BASE64), { headers: securityHeaders("image/png", "public, max-age=86400") });
      return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
    } catch (error) {
      console.error("Request failed", error);
      return url.pathname.startsWith("/api/") ? withCors(json({ error: "Erro interno. Tente novamente." }, 500), request) : new Response("Internal error", { status: 500 });
    }
  },
};
