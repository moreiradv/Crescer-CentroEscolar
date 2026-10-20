const INDEX_HTML = __INDEX_HTML__;
const STYLES = __STYLES__;
const APP_JS = __APP_JS__;
const ENROLLMENTS_JS = __ENROLLMENTS_JS__;
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
  return { id: row.id, username: row.username, name: row.name, role: row.role, initials: row.initials, status: row.status };
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
  if (!MANAGER_ROLES.has(user.role)) return { error: json({ error: "Apenas administração, coordenação e financeiro podem realizar esta ação." }, 403) };
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

async function requireEnrollment(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
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
    items.push({ type: "uniform", sourceId: product.id, description: product.name, size: product.size, unit: Number(product.price_cents), quantity: selected.quantity, subtotal: Number(product.price_cents) * selected.quantity, stockEnabled: !!product.stock_enabled });
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
    const body = await readJson(request); const name = String(body.name || "").trim(); const size = String(body.size || "").trim(); const now = Date.now();
    if (name.length < 2 || !size) return json({ error: "Informe a peça e o tamanho." }, 400);
    try {
      const result = await db.prepare(`INSERT INTO uniform_items (name, size, price_cents, stock_enabled, stock_quantity, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(name, size, moneyCents(body.priceCents), body.stockEnabled ? 1 : 0, Math.max(0, Number(body.stockQuantity) || 0), body.status === "inactive" ? "inactive" : "active", auth.user.id, now, now).run();
      await audit(db, auth.user.id, "uniform_created", result.meta.last_row_id, `${name} • ${size}`); return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch (error) { if (String(error).includes("UNIQUE")) return json({ error: "Essa peça e tamanho já estão cadastrados." }, 409); throw error; }
  }
  const uniformMatch = path.match(/^\/api\/uniforms\/(\d+)$/);
  if (uniformMatch && request.method === "PUT") {
    const body = await readJson(request); const id = Number(uniformMatch[1]); const name = String(body.name || "").trim(); const size = String(body.size || "").trim();
    const result = await db.prepare(`UPDATE uniform_items SET name = ?, size = ?, price_cents = ?, stock_enabled = ?, stock_quantity = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, size, moneyCents(body.priceCents), body.stockEnabled ? 1 : 0, Math.max(0, Number(body.stockQuantity) || 0), body.status === "inactive" ? "inactive" : "active", Date.now(), id).run();
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
    const duplicate = await db.prepare(`SELECT id FROM enrollments WHERE registration = ? AND id != ? LIMIT 1`).bind(registration, id || 0).first(); if (duplicate) return json({ error: "Esse número de matrícula já está em uso." }, 409);
    const studentExists = completing || existing?.status === "completed" ? await db.prepare(`SELECT id FROM students WHERE registration = ? LIMIT 1`).bind(registration).first() : null;
    if (studentExists && Number(studentExists.id) !== Number(existing?.student_id || 0)) return json({ error: "Já existe um aluno com essa matrícula no cadastro escolar." }, 409);
    const grade = await db.prepare(`SELECT * FROM grades WHERE id = ?`).bind(gradeId).first(); if (!grade || grade.status !== "active") return json({ error: "Selecione uma série ativa." }, 400);
    const klass = classId ? await db.prepare(`SELECT * FROM classes WHERE id = ? AND status = 'active'`).bind(classId).first() : null; if (classId && !klass) return json({ error: "Selecione uma turma ativa." }, 400);
    if (existing?.status === "completed") {
      await db.prepare(`UPDATE enrollments SET registration = ?, student_name = ?, birth_date = ?, grade_id = ?, class_id = ?, class_name_snapshot = ?, guardian_name = ?, guardian_phone = ?, enrollment_date = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(registration, studentName, birthDate, gradeId, classId, klass?.name || null, guardianName, guardianPhone, enrollmentDate, notes || null, auth.user.id, now, id).run();
      if (existing.student_id) await db.prepare(`UPDATE students SET registration = ?, name = ?, birth_date = ?, guardian_name = ?, guardian_phone = ?, class_id = ?, updated_at = ? WHERE id = ?`).bind(registration, studentName, birthDate, guardianName, guardianPhone, classId, now, existing.student_id).run();
      await db.prepare(`INSERT INTO enrollment_history (enrollment_id, user_id, action, details, created_at) VALUES (?, ?, 'updated', ?, ?)`).bind(id, auth.user.id, "Dados cadastrais atualizados; valores originais preservados", now).run();
      await audit(db, auth.user.id, "enrollment_updated", id, `${registration} • ${studentName}`); return json({ ok: true, id, preservedPrices: true });
    }
    const items = await pricedEnrollmentItems(db, gradeId, body.books, body.uniforms); const booksTotal = items.filter(item => item.type === "book").reduce((sum, item) => sum + item.subtotal, 0); const uniformsTotal = items.filter(item => item.type === "uniform").reduce((sum, item) => sum + item.subtotal, 0); const includeFirst = body.includeFirstMonthly ? 1 : 0; const initialTotal = Number(grade.enrollment_fee_cents) + booksTotal + uniformsTotal + (includeFirst ? Number(grade.monthly_fee_cents) : 0); const status = completing ? "completed" : "draft";
    let enrollmentId = id;
    if (!id) {
      const code = `MAT-${enrollmentDate.replace(/-/g, "")}-${randomHex(3).toUpperCase()}`;
      const result = await db.prepare(`INSERT INTO enrollments (code, registration, student_name, birth_date, grade_id, grade_name_snapshot, class_id, class_name_snapshot, guardian_name, guardian_phone, enrollment_date, notes, status, enrollment_fee_cents, monthly_fee_cents, books_total_cents, uniforms_total_cents, include_first_monthly, initial_total_cents, created_by, updated_by, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(code, registration, studentName, birthDate, gradeId, grade.name, classId, klass?.name || null, guardianName, guardianPhone, enrollmentDate, notes || null, status, grade.enrollment_fee_cents, grade.monthly_fee_cents, booksTotal, uniformsTotal, includeFirst, initialTotal, auth.user.id, auth.user.id, now, now, completing ? now : null).run();
      enrollmentId = Number(result.meta.last_row_id);
    } else {
      await db.prepare(`UPDATE enrollments SET registration = ?, student_name = ?, birth_date = ?, grade_id = ?, grade_name_snapshot = ?, class_id = ?, class_name_snapshot = ?, guardian_name = ?, guardian_phone = ?, enrollment_date = ?, notes = ?, status = ?, enrollment_fee_cents = ?, monthly_fee_cents = ?, books_total_cents = ?, uniforms_total_cents = ?, include_first_monthly = ?, initial_total_cents = ?, updated_by = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
        .bind(registration, studentName, birthDate, gradeId, grade.name, classId, klass?.name || null, guardianName, guardianPhone, enrollmentDate, notes || null, status, grade.enrollment_fee_cents, grade.monthly_fee_cents, booksTotal, uniformsTotal, includeFirst, initialTotal, auth.user.id, now, completing ? now : null, id).run();
    }
    const operations = [db.prepare(`DELETE FROM enrollment_items WHERE enrollment_id = ?`).bind(enrollmentId)];
    items.forEach(item => operations.push(db.prepare(`INSERT INTO enrollment_items (enrollment_id, item_type, source_id, description, size, unit_price_cents, quantity, subtotal_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(enrollmentId, item.type, item.sourceId, item.description, item.size, item.unit, item.quantity, item.subtotal)));
    if (completing) items.filter(item => item.stockEnabled).forEach(item => operations.push(db.prepare(item.type === "book" ? `UPDATE books SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?` : `UPDATE uniform_items SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?`).bind(item.quantity, now, item.sourceId, item.quantity)));
    operations.push(db.prepare(`INSERT INTO enrollment_history (enrollment_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)`).bind(enrollmentId, auth.user.id, completing ? "completed" : (id ? "updated_draft" : "created_draft"), `${registration} • ${studentName}`, now));
    await db.batch(operations);
    if (completing) {
      let studentId = studentExists?.id || null;
      if (!studentId) {
        const studentResult = await db.prepare(`INSERT INTO students (registration, name, birth_date, guardian_name, guardian_phone, class_id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).bind(registration, studentName, birthDate, guardianName, guardianPhone, classId, auth.user.id, now, now).run(); studentId = studentResult.meta.last_row_id;
      }
      await db.prepare(`UPDATE enrollments SET student_id = ? WHERE id = ?`).bind(studentId, enrollmentId).run();
    }
    await audit(db, auth.user.id, completing ? "enrollment_completed" : (id ? "enrollment_updated" : "enrollment_draft"), enrollmentId, `${registration} • ${studentName}`);
    return json({ ok: true, id: enrollmentId, status }, id ? 200 : 201);
  }

  return json({ error: "Rota de matrículas não encontrada." }, 404);
}

async function handleApi(request, env, path) {
  const db = env.DB;
  if (!db) return json({ error: "Banco de dados indisponível." }, 503);

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
    return json({ user: safeUser(user), ...(externalClient ? { token } : {}) }, 200, { "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}` });
  }

  if (path === "/api/session" && request.method === "GET") {
    const user = await getSession(request, db);
    return json({ user: user ? safeUser(user) : null }, user ? 200 : 401);
  }

  if (path === "/api/logout" && request.method === "POST") {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : parseCookies(request)[SESSION_COOKIE];
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
      if (url.pathname === "/assets/logo-crescer.png") return new Response(decodeBase64(LOGO_BASE64), { headers: securityHeaders("image/png", "public, max-age=86400") });
      return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
    } catch (error) {
      console.error("Request failed", error);
      return url.pathname.startsWith("/api/") ? withCors(json({ error: "Erro interno. Tente novamente." }, 500), request) : new Response("Internal error", { status: 500 });
    }
  },
};
