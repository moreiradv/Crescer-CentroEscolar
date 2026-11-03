import pg from 'pg';

const { Pool } = pg;
const OLD_API = 'https://crescer-gestao-escolar.davi-gonzaga1.chatgpt.site';
const PUBLIC_ORIGIN = 'https://crescer-escola-web.vercel.app';
const MANAGER_ROLES = new Set(['Administrador', 'Coordenação']);
const PEDAGOGICAL_ROLES = new Set(['Administrador', 'Coordenação', 'Professor']);

let pool;
let schemaPromise;

function database() {
  const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 20000 });
  return pool;
}

async function ensureSchema() {
  const db = database();
  if (!db) throw Object.assign(new Error('Banco persistente da Vercel ainda não está conectado.'), { status: 503 });
  if (!schemaPromise) schemaPromise = db.query(`
    CREATE TABLE IF NOT EXISTS crescer_library_books (
      id BIGSERIAL PRIMARY KEY,
      accession_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      title_key TEXT NOT NULL,
      author TEXT,
      author_key TEXT NOT NULL DEFAULT '',
      synopsis TEXT,
      publisher TEXT,
      age_range TEXT,
      quantity INTEGER,
      created_by BIGINT,
      created_by_name TEXT,
      updated_by BIGINT,
      updated_by_name TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (title_key, author_key)
    );
    CREATE TABLE IF NOT EXISTS crescer_agendas (
      id BIGSERIAL PRIMARY KEY,
      agenda_date TEXT NOT NULL,
      class_id BIGINT NOT NULL,
      subject_id BIGINT,
      subject_component TEXT,
      teacher_name TEXT,
      content TEXT NOT NULL,
      materials JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      no_agenda BOOLEAN NOT NULL DEFAULT FALSE,
      created_by BIGINT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crescer_agendas_date_class_idx ON crescer_agendas (agenda_date, class_id);
  `).catch(error => { schemaPromise = null; throw error; });
  await schemaPromise;
  return db;
}

function json(res, status, data) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  return res.end(JSON.stringify(data));
}

function text(value, limit = 12000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, limit) : null;
}

function key(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function requestPath(req) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  return `/api/${path}`;
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function upstreamHeaders(req) {
  const headers = { accept: 'application/json', origin: PUBLIC_ORIGIN };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers['x-teacher-assignment-id']) headers['x-teacher-assignment-id'] = req.headers['x-teacher-assignment-id'];
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  return headers;
}

async function upstream(req, path, options = {}) {
  const url = new URL(path, OLD_API);
  if (options.copyQuery !== false) {
    const incoming = new URL(req.url, PUBLIC_ORIGIN);
    for (const [name, value] of incoming.searchParams) if (name !== 'path') url.searchParams.append(name, value);
  }
  const response = await fetch(url, {
    method: options.method || req.method,
    headers: upstreamHeaders(req),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw || 'Resposta inválida do servidor anterior.' }; }
  return { status: response.status, data, contentType: response.headers.get('content-type') || 'application/json; charset=utf-8' };
}

async function proxy(req, res, path) {
  let outgoingBody;
  if (!['GET', 'HEAD'].includes(req.method)) outgoingBody = await body(req);
  const result = await upstream(req, path, { body: outgoingBody });
  res.status(result.status).setHeader('content-type', result.contentType);
  res.setHeader('cache-control', 'no-store');
  return res.end(JSON.stringify(result.data));
}

async function requireUser(req, roles) {
  const session = await upstream(req, '/api/session', { method: 'GET', copyQuery: false });
  if (session.status !== 200 || !session.data.user) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401 });
  if (roles && !roles.has(session.data.user.role)) throw Object.assign(new Error('Seu perfil não possui acesso a esta função.'), { status: 403 });
  return session.data.user;
}

async function academicContext(req) {
  const [classResponse, configResponse] = await Promise.all([
    upstream(req, '/api/classes', { method: 'GET', copyQuery: false }),
    upstream(req, '/api/academic-config', { method: 'GET', copyQuery: false }),
  ]);
  return {
    classes: classResponse.status === 200 ? classResponse.data.classes || [] : [],
    subjects: configResponse.status === 200 ? configResponse.data.subjects || [] : [],
  };
}

function decorateAgenda(row, context) {
  const klass = context.classes.find(item => Number(item.id) === Number(row.class_id));
  const subject = context.subjects.find(item => Number(item.id) === Number(row.subject_id));
  return {
    ...row,
    id: -Number(row.id),
    class_name: klass?.name || 'Turma removida',
    school_year: klass?.school_year || null,
    grade_level: klass?.grade_level || null,
    shift: klass?.shift || null,
    subject: subject?.name || 'Sem disciplina',
    materials: Array.isArray(row.materials) ? row.materials : [],
    no_agenda: row.no_agenda ? 1 : 0,
  };
}

async function allAgendas(req, context) {
  const [oldResponse, localResult] = await Promise.all([
    upstream(req, '/api/agendas', { method: 'GET' }),
    ensureSchema().then(db => db.query('SELECT * FROM crescer_agendas ORDER BY agenda_date DESC, id DESC')),
  ]);
  if (oldResponse.status === 401 || oldResponse.status === 403) throw Object.assign(new Error(oldResponse.data.error || 'Acesso negado.'), { status: oldResponse.status });
  const oldRows = oldResponse.status === 200 ? oldResponse.data.agendas || [] : [];
  const localRows = localResult.rows.map(row => decorateAgenda(row, context));
  return [...localRows, ...oldRows].sort((a, b) => String(b.agenda_date).localeCompare(String(a.agenda_date)) || Number(b.updated_at || 0) - Number(a.updated_at || 0));
}

async function handleAgendas(req, res, path) {
  const user = await requireUser(req, PEDAGOGICAL_ROLES);
  const context = await academicContext(req);
  if (path === '/api/agendas' && req.method === 'GET') return json(res, 200, { agendas: await allAgendas(req, context) });

  if (path === '/api/agenda-status' && req.method === 'GET') {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Informe uma data válida.' });
    const agendas = (await allAgendas(req, context)).filter(item => item.agenda_date === date);
    const statuses = context.classes.filter(item => item.status !== 'inactive').map(klass => {
      const rows = agendas.filter(item => Number(item.class_id) === Number(klass.id));
      const withAgenda = rows.some(item => !Number(item.no_agenda));
      const noAgenda = rows.some(item => Number(item.no_agenda));
      const users = [...new Set(rows.map(item => item.created_by_name).filter(Boolean))];
      return { ...klass, status: withAgenda ? 'with_agenda' : noAgenda ? 'no_agenda' : 'no_record', record_count: rows.length, recorded_by_names: users.join(', '), last_updated_at: rows.reduce((last, item) => Math.max(last, Number(item.updated_at || item.created_at || 0)), 0) || null };
    });
    return json(res, 200, { date, statuses });
  }

  const match = path.match(/^\/api\/agendas\/(-?\d+)$/);
  if (match && Number(match[1]) > 0) return proxy(req, res, path);
  if (!((path === '/api/agendas' && req.method === 'POST') || (match && req.method === 'PUT') || (match && req.method === 'DELETE'))) return null;
  const db = await ensureSchema();
  const localId = match ? Math.abs(Number(match[1])) : 0;
  if (req.method === 'DELETE') {
    await db.query('DELETE FROM crescer_agendas WHERE id = $1', [localId]);
    return json(res, 200, { ok: true });
  }

  const input = await body(req);
  const agendaDate = String(input.date || '').slice(0, 10);
  const classId = Number(input.classId);
  const subjectId = Number(input.subjectId) || null;
  const noAgenda = Boolean(input.noAgenda);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(agendaDate) || !classId) return json(res, 400, { error: 'Informe a data e a turma.' });
  const klass = context.classes.find(item => Number(item.id) === classId);
  if (!klass) return json(res, 400, { error: 'Turma não encontrada.' });

  const existing = (await allAgendas(req, context)).filter(item => item.agenda_date === agendaDate && Number(item.class_id) === classId && Number(item.id) !== -localId);
  if (noAgenda && existing.length) return json(res, 409, { error: 'Já existe uma agenda registrada para esta turma e data.' });
  if (!noAgenda && existing.some(item => Number(item.no_agenda))) return json(res, 409, { error: 'Esta turma e data estão marcadas como “Não tem agenda”. Edite o registro existente.' });
  if (!noAgenda && existing.some(item => (Number(item.subject_id) || 0) === (subjectId || 0))) return json(res, 409, { error: subjectId ? 'Já existe uma agenda desta disciplina para a turma e data.' : 'Já existe uma agenda geral para a turma e data.' });

  const content = noAgenda ? 'Não tem agenda' : text(input.agenda) || 'Agenda registrada';
  const materials = noAgenda ? [] : (Array.isArray(input.materials) ? input.materials.map(item => String(item).slice(0, 240)).slice(0, 30) : []);
  const now = Date.now();
  const values = [agendaDate, classId, subjectId, text(input.subjectComponent, 240), text(input.teacherName, 240) || klass.teacher_name || user.name, content, JSON.stringify(materials), text(input.notes), noAgenda, Number(user.id), user.name, now];
  if (localId) {
    const updated = await db.query(`UPDATE crescer_agendas SET agenda_date=$1,class_id=$2,subject_id=$3,subject_component=$4,teacher_name=$5,content=$6,materials=$7::jsonb,notes=$8,no_agenda=$9,created_by=$10,created_by_name=$11,updated_at=$12 WHERE id=$13 RETURNING id`, [...values, localId]);
    if (!updated.rowCount) return json(res, 404, { error: 'Agenda não encontrada.' });
    return json(res, 200, { ok: true, id: -localId });
  }
  const inserted = await db.query(`INSERT INTO crescer_agendas (agenda_date,class_id,subject_id,subject_component,teacher_name,content,materials,notes,no_agenda,created_by,created_by_name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$12) RETURNING id`, values);
  return json(res, 201, { ok: true, id: -Number(inserted.rows[0].id) });
}

function bookResponse(row) {
  return { ...row, id: Number(row.id), quantity: row.quantity === null ? null : Number(row.quantity) };
}

async function handleLibrary(req, res, path) {
  const user = await requireUser(req);
  const db = await ensureSchema();
  const match = path.match(/^\/api\/library-books\/(\d+)$/);
  if (path === '/api/library-books' && req.method === 'GET') {
    const search = String(req.query.search || '').trim();
    const result = search ? await db.query('SELECT * FROM crescer_library_books WHERE title ILIKE $1 OR COALESCE(author,\'\') ILIKE $1 ORDER BY title LIMIT 500', [`%${search}%`]) : await db.query('SELECT * FROM crescer_library_books ORDER BY title LIMIT 500');
    return json(res, 200, { books: result.rows.map(bookResponse) });
  }
  if (match && req.method === 'GET') {
    const result = await db.query('SELECT * FROM crescer_library_books WHERE id=$1', [Number(match[1])]);
    return result.rowCount ? json(res, 200, { book: bookResponse(result.rows[0]) }) : json(res, 404, { error: 'Livro não encontrado.' });
  }
  if (!MANAGER_ROLES.has(user.role)) return json(res, 403, { error: 'Somente Administração e Coordenação podem alterar a Biblioteca.' });
  if (match && req.method === 'DELETE') {
    await db.query('DELETE FROM crescer_library_books WHERE id=$1', [Number(match[1])]);
    return json(res, 200, { ok: true });
  }
  if (!((path === '/api/library-books' && req.method === 'POST') || (match && req.method === 'PUT'))) return null;
  const input = await body(req);
  const title = text(input.title, 500);
  const author = text(input.author, 500);
  if (!title) return json(res, 400, { error: 'Informe o nome do livro.' });
  const quantity = input.quantity === '' || input.quantity === null || input.quantity === undefined ? null : Math.max(0, Number.parseInt(input.quantity, 10));
  if (quantity !== null && !Number.isFinite(quantity)) return json(res, 400, { error: 'Informe uma quantidade válida.' });
  const now = Date.now();
  try {
    if (match) {
      const id = Number(match[1]);
      const result = await db.query(`UPDATE crescer_library_books SET title=$1,title_key=$2,author=$3,author_key=$4,synopsis=$5,publisher=$6,age_range=$7,quantity=$8,updated_by=$9,updated_by_name=$10,updated_at=$11 WHERE id=$12 RETURNING *`, [title, key(title), author, key(author), text(input.synopsis), text(input.publisher, 240), text(input.ageRange, 120), quantity, Number(user.id), user.name, now, id]);
      return result.rowCount ? json(res, 200, { ok: true, id, book: bookResponse(result.rows[0]) }) : json(res, 404, { error: 'Livro não encontrado.' });
    }
    const code = `BIB-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}`;
    const result = await db.query(`INSERT INTO crescer_library_books (accession_code,title,title_key,author,author_key,synopsis,publisher,age_range,quantity,created_by,created_by_name,updated_by,updated_by_name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11,$12,$12) RETURNING *`, [code, title, key(title), author, key(author), text(input.synopsis), text(input.publisher, 240), text(input.ageRange, 120), quantity, Number(user.id), user.name, now]);
    return json(res, 201, { ok: true, id: Number(result.rows[0].id), accessionCode: code, book: bookResponse(result.rows[0]) });
  } catch (error) {
    if (error?.code === '23505') return json(res, 409, { error: 'Este livro e autor já estão cadastrados.' });
    throw error;
  }
}

export default async function handler(req, res) {
  const path = requestPath(req);
  try {
    if (path === '/api/library-books' || /^\/api\/library-books\/\d+$/.test(path)) {
      const response = await handleLibrary(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/agendas' || path === '/api/agenda-status' || /^\/api\/agendas\/-?\d+$/.test(path)) {
      const response = await handleAgendas(req, res, path);
      if (response !== null) return response;
    }
    return proxy(req, res, path);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.status ? error.message : 'Erro interno ao acessar o banco de dados.' });
  }
}
