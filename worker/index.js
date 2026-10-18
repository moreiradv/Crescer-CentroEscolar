const INDEX_HTML = __INDEX_HTML__;
const STYLES = __STYLES__;
const APP_JS = __APP_JS__;
const LOGO_BASE64 = __LOGO_BASE64__;

const SESSION_COOKIE = "crescer_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 210000;
const ALLOWED_ROLES = new Set(["Coordenação", "Financeiro", "Administrador"]);
const SEED_USERS = [
  { username: "Thays Barros", name: "Thays Barros", role: "Coordenação", initials: "TB", salt: "b01679f5517d4cb32c4574cb48d96510", passwordHash: "0ac0ecd42796c22b3cd22f19670776913adc99b5d161ca1d9565011e7c2e2cac" },
  { username: "Thayane Barros", name: "Thayane Barros", role: "Financeiro", initials: "TB", salt: "5f2b87a20a2fc37f745ba7338bbd847c", passwordHash: "e7485f084e03929bba8e87974f960ebfeae3720128a5a2d2c5556e84ed291764" },
  { username: "Estagiárias 2026", name: "Estagiárias 2026", role: "Administrador", initials: "E26", salt: "1be9bcc4ffd55fb2e48734a588c549bf", passwordHash: "bf067d61de3095873784573220019b1088f4ff4fb8ffd132f95237cb022ad362" },
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

async function requireAdmin(request, db) {
  const user = await getSession(request, db);
  if (!user) return { error: json({ error: "Sua sessão expirou. Entre novamente." }, 401) };
  if (user.role !== "Administrador") return { error: json({ error: "Apenas administradores podem gerenciar usuários." }, 403) };
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

  if (path === "/api/users" && request.method === "GET") {
    const auth = await requireAdmin(request, db); if (auth.error) return auth.error;
    const result = await db.prepare(`SELECT id, username, name, role, initials, status, created_at, updated_at FROM users ORDER BY CASE role WHEN 'Administrador' THEN 1 WHEN 'Coordenação' THEN 2 ELSE 3 END, name`).all();
    return json({ users: result.results });
  }

  if (path === "/api/users" && request.method === "POST") {
    const auth = await requireAdmin(request, db); if (auth.error) return auth.error;
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
    const auth = await requireAdmin(request, db); if (auth.error) return auth.error;
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
    const auth = await requireAdmin(request, db); if (auth.error) return auth.error;
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
