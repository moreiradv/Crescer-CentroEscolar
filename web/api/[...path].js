import pg from 'pg';

const { Pool } = pg;
const OLD_API = 'https://crescer-gestao-escolar.davi-gonzaga1.chatgpt.site';
const PUBLIC_ORIGIN = 'https://crescer-escola-web.vercel.app';
const OFFICIAL_SCHOOL_YEARS = [2026, 2027, 2028, 2029];
const OFFICIAL_GRADES = ['Infantil 3', 'Infantil 4', 'Infantil 5', '1º Ano', '2º Ano', '3º Ano', '4º Ano', '5º Ano', '6º Ano', '7º Ano'];
const MANAGER_ROLES = new Set(['Administrador', 'Coordenação', 'Gestão Escolar']);
const PEDAGOGICAL_ROLES = new Set(['Administrador', 'Coordenação', 'Gestão Escolar', 'Professor']);
const MANAGER_ONLY_ROUTES = [
  /^\/api\/indicators(?:\?|$)/,
  /^\/api\/users(?:\/|$)/,
  /^\/api\/teacher-assignments(?:\/|$)/,
  /^\/api\/audit(?:\?|$)/,
  /^\/api\/progressions(?:\/|$)/,
  /^\/api\/progression-rules(?:\/|$)/,
  /^\/api\/students\/\d+\/promote$/,
];

let pool;
let schemaPromise;

function database() {
  const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 20000 });
  return pool;
}

export async function ensureSchema() {
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
      subject_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      subject_component TEXT,
      teacher_name TEXT,
      content TEXT NOT NULL,
      materials JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      no_agenda BOOLEAN NOT NULL DEFAULT FALSE,
      agenda_status TEXT NOT NULL DEFAULT 'Concluída',
      created_by BIGINT NOT NULL,
      created_by_name TEXT NOT NULL,
      updated_by BIGINT,
      updated_by_name TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crescer_agendas_date_class_idx ON crescer_agendas (agenda_date, class_id);
    ALTER TABLE crescer_agendas ADD COLUMN IF NOT EXISTS subject_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE crescer_agendas ADD COLUMN IF NOT EXISTS agenda_status TEXT NOT NULL DEFAULT 'Concluída';
    ALTER TABLE crescer_agendas ADD COLUMN IF NOT EXISTS updated_by BIGINT;
    ALTER TABLE crescer_agendas ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
    CREATE TABLE IF NOT EXISTS crescer_agenda_history (
      id BIGSERIAL PRIMARY KEY,
      agenda_source TEXT NOT NULL,
      agenda_id BIGINT NOT NULL,
      action TEXT NOT NULL,
      actor_id BIGINT NOT NULL,
      actor_name TEXT NOT NULL,
      before_data JSONB,
      after_data JSONB,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crescer_agenda_history_agenda_idx ON crescer_agenda_history (agenda_source, agenda_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS crescer_agenda_tombstones (
      upstream_agenda_id BIGINT PRIMARY KEY,
      deleted_by BIGINT NOT NULL,
      deleted_by_name TEXT NOT NULL,
      deleted_at BIGINT NOT NULL,
      snapshot JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crescer_agenda_upstream_overrides (
      upstream_agenda_id BIGINT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_by BIGINT NOT NULL,
      updated_by_name TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crescer_teacher_assignment_details (
      upstream_assignment_id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      education_stage TEXT NOT NULL,
      class_id BIGINT NOT NULL,
      subject_id BIGINT,
      school_year INTEGER NOT NULL,
      grade_level TEXT NOT NULL,
      class_name TEXT NOT NULL,
      subject_name TEXT,
      can_attendance BOOLEAN NOT NULL DEFAULT TRUE,
      can_agenda BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crescer_teacher_assignment_user_idx ON crescer_teacher_assignment_details (user_id, status, school_year);
    CREATE TABLE IF NOT EXISTS crescer_students (
      id BIGINT PRIMARY KEY,
      registration TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      birth_date TEXT,
      guardian_name TEXT,
      guardian_phone TEXT,
      mother_name TEXT,
      father_name TEXT,
      guardian_email TEXT,
      address TEXT,
      enrollment_notes TEXT,
      current_class_id BIGINT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by BIGINT,
      updated_by BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crescer_student_memberships (
      id BIGINT PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES crescer_students(id) ON DELETE CASCADE,
      class_id BIGINT NOT NULL,
      school_year INTEGER NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(student_id, school_year)
    );
    CREATE INDEX IF NOT EXISTS crescer_student_memberships_year_idx ON crescer_student_memberships (school_year,class_id);
    CREATE TABLE IF NOT EXISTS crescer_student_change_history (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES crescer_students(id) ON DELETE CASCADE,
      membership_id BIGINT,
      action TEXT NOT NULL,
      actor_user_id BIGINT,
      actor_name TEXT,
      before_data JSONB,
      after_data JSONB,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crescer_student_annual_enrollments (
      id BIGINT PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES crescer_students(id) ON DELETE CASCADE,
      membership_id BIGINT NOT NULL REFERENCES crescer_student_memberships(id) ON DELETE CASCADE,
      class_id BIGINT NOT NULL,
      school_year INTEGER NOT NULL,
      enrollment_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(student_id, school_year)
    );
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

function gradeKey(value) {
  return key(value).replace(/infantil iii\b/g, 'infantil 3').replace(/infantil iv\b/g, 'infantil 4').replace(/infantil v\b/g, 'infantil 5').replace(/[ºª°]/g, '').replace(/\s+/g, ' ').trim();
}

function officialGrade(value) {
  return OFFICIAL_GRADES.find(grade => gradeKey(grade) === gradeKey(value)) || null;
}

function requestPath(req) {
  const queryPath = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  const path = queryPath || new URL(req.url || '/', PUBLIC_ORIGIN).pathname;
  const normalized = path.replace(/^\/+/, '').replace(/^api\//, '');
  return `/api/${normalized}`;
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
    for (const [name, value] of incoming.searchParams) if (name !== 'path' && name !== 'target') url.searchParams.append(name, value);
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
  res.setHeader('x-educlass-proxy-path', path);
  return res.end(JSON.stringify(result.data));
}

function normalizedUsers(data) {
  return (data.users || []).map(user => {
    const assignments = Array.isArray(user.assignments) ? user.assignments : [];
    const actualUserId = assignments[0]?.user_id || user.id;
    return { ...user, id: Number(actualUserId), assignments };
  });
}

async function teacherAssignmentDetails(userId = null) {
  const db = await ensureSchema();
  const result = userId
    ? await db.query('SELECT * FROM crescer_teacher_assignment_details WHERE user_id=$1 ORDER BY school_year, grade_level, subject_name', [Number(userId)])
    : await db.query('SELECT * FROM crescer_teacher_assignment_details ORDER BY user_id, school_year, grade_level, subject_name');
  return result.rows;
}

function mergeTeacherDetails(users, details) {
  return users.map(user => ({ ...user, assignments: (user.assignments || []).map(assignment => {
    const detail = details.find(item => Number(item.upstream_assignment_id) === Number(assignment.id));
    return detail ? { ...assignment, ...detail, id: Number(assignment.id), user_id: Number(user.id), class_id: Number(detail.class_id), subject_id: detail.subject_id === null ? null : Number(detail.subject_id), school_year: Number(detail.school_year), can_attendance: detail.can_attendance ? 1 : 0, can_agenda: detail.can_agenda ? 1 : 0 } : assignment;
  }) }));
}

async function persistTeacherDetail(req, assignmentId, userId, input, status = 'active') {
  const context = await academicContext(req);
  const klass = context.classes.find(item => Number(item.id) === Number(input.classId));
  const subject = context.subjects.find(item => Number(item.id) === Number(input.subjectId));
  if (!klass) throw Object.assign(new Error('A série confirmada não foi recuperada do banco de dados.'), { status: 409 });
  const db = await ensureSchema(), now = Date.now();
  await db.query(`INSERT INTO crescer_teacher_assignment_details (upstream_assignment_id,user_id,education_stage,class_id,subject_id,school_year,grade_level,class_name,subject_name,can_attendance,can_agenda,status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
    ON CONFLICT (upstream_assignment_id) DO UPDATE SET user_id=EXCLUDED.user_id,education_stage=EXCLUDED.education_stage,class_id=EXCLUDED.class_id,subject_id=EXCLUDED.subject_id,school_year=EXCLUDED.school_year,grade_level=EXCLUDED.grade_level,class_name=EXCLUDED.class_name,subject_name=EXCLUDED.subject_name,can_attendance=EXCLUDED.can_attendance,can_agenda=EXCLUDED.can_agenda,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [Number(assignmentId), Number(userId), String(input.educationStage || ''), Number(klass.id), Number(input.subjectId) || null, Number(klass.school_year), officialGrade(klass.grade_level || klass.name) || klass.grade_level || klass.name, officialGrade(klass.name) || klass.name, subject?.name || null, input.canAttendance !== false, input.canAgenda !== false, status, now]);
}

async function setTeacherDetailStatus(assignmentId, status) {
  const db = await ensureSchema();
  await db.query('UPDATE crescer_teacher_assignment_details SET status=$1,updated_at=$2 WHERE upstream_assignment_id=$3', [status, Date.now(), Number(assignmentId)]);
}

async function ensureUpstreamTeacherClass(req, input) {
  if (Number(input.classId) > 0) return input;
  const schoolYear = Number(input.schoolYear), gradeLevel = officialGrade(input.gradeLevel);
  if (!OFFICIAL_SCHOOL_YEARS.includes(schoolYear) || !gradeLevel) throw Object.assign(new Error('Selecione um ano letivo e uma série oficiais.'), { status: 400 });
  const classesResponse = await upstream(req, '/api/classes', { method: 'GET', copyQuery: false });
  if (classesResponse.status !== 200) throw Object.assign(new Error(classesResponse.data.error || 'Não foi possível consultar as séries.'), { status: classesResponse.status });
  const rows = classesResponse.data.classes || [];
  let klass = rows.find(item => Number(item.school_year) === schoolYear && gradeKey(item.name) === gradeKey(gradeLevel));
  if (!klass) {
    const created = await upstream(req, '/api/classes', { method: 'POST', copyQuery: false, body: { name: gradeLevel, gradeLevel, shift: 'Matutino', schoolYear, teacherName: '' } });
    if (created.status >= 300 && created.status !== 409) throw Object.assign(new Error(created.data.error || 'Não foi possível preparar a série.'), { status: created.status });
    if (created.status < 300) klass = { id: created.data.id, name: gradeLevel, grade_level: gradeLevel, school_year: schoolYear };
    else {
      const refreshed = await upstream(req, '/api/classes', { method: 'GET', copyQuery: false });
      klass = (refreshed.data.classes || []).find(item => Number(item.school_year) === schoolYear && gradeKey(item.name) === gradeKey(gradeLevel));
    }
  }
  if (!klass?.id) throw Object.assign(new Error('A série não pôde ser vinculada ao banco de dados.'), { status: 409 });
  return { ...input, classId: Number(klass.id), schoolYear, gradeLevel };
}

async function handleTeacherAssignments(req, res, path) {
  if (path === '/api/users' && req.method === 'GET') {
    await requireUser(req, MANAGER_ROLES);
    const result = await upstream(req, path, { method: 'GET', copyQuery: false });
    if (result.status !== 200) return json(res, result.status, result.data);
    const users = normalizedUsers(result.data), details = await teacherAssignmentDetails();
    return json(res, 200, { ...result.data, users: mergeTeacherDetails(users, details) });
  }
  if (path === '/api/users' && req.method === 'POST') {
    await requireUser(req, MANAGER_ROLES);
    let input = await body(req);
    if (String(input.role || '') === 'Professor') input = await ensureUpstreamTeacherClass(req, input);
    const result = await upstream(req, path, { method: 'POST', copyQuery: false, body: input });
    if (result.status < 300 && String(input.role || '') === 'Professor') {
      const usersResponse = await upstream(req, '/api/users', { method: 'GET', copyQuery: false });
      const created = normalizedUsers(usersResponse.data).find(user => Number(user.id) === Number(result.data.id));
      const assignment = created?.assignments.find(item => Number(item.class_id) === Number(input.classId)) || created?.assignments[0];
      if (assignment) await persistTeacherDetail(req, assignment.id, created.id, input, assignment.status || 'active');
    }
    return json(res, result.status, result.data);
  }
  const collectionMatch = path.match(/^\/api\/users\/(\d+)\/assignments$/);
  if (collectionMatch && req.method === 'POST') {
    await requireUser(req, MANAGER_ROLES);
    const input = await ensureUpstreamTeacherClass(req, await body(req));
    const result = await upstream(req, path, { method: 'POST', copyQuery: false, body: input });
    if (result.status < 300 && result.data.id) await persistTeacherDetail(req, result.data.id, Number(collectionMatch[1]), input, 'active');
    return json(res, result.status, result.data);
  }
  const match = path.match(/^\/api\/teacher-assignments\/(\d+)$/);
  if (!match || req.method !== 'PUT') return null;
  await requireUser(req, MANAGER_ROLES);
  const rawInput = await body(req);
  if (rawInput.classId === undefined && rawInput.educationStage === undefined && rawInput.subjectId === undefined) {
    const result = await upstream(req, path, { method: 'PUT', copyQuery: false, body: rawInput });
    if (result.status < 300) await setTeacherDetailStatus(Number(match[1]), rawInput.status === 'inactive' ? 'inactive' : 'active');
    return json(res, result.status, result.data);
  }
  const input = await ensureUpstreamTeacherClass(req, rawInput);
  const usersResponse = await upstream(req, '/api/users', { method: 'GET', copyQuery: false });
  if (usersResponse.status !== 200) return json(res, usersResponse.status, usersResponse.data);
  const assignmentId = Number(match[1]);
  const users = mergeTeacherDetails(normalizedUsers(usersResponse.data), await teacherAssignmentDetails());
  const teacher = users.find(user => user.assignments.some(item => Number(item.id) === assignmentId));
  const current = teacher?.assignments.find(item => Number(item.id) === assignmentId);
  if (!teacher || !current) return json(res, 404, { error: 'Atribuição não encontrada.' });
  const subjectId = Number(input.subjectId) || null, classId = Number(input.classId);
  const sameScope = Number(current.class_id) === classId && (Number(current.subject_id) || null) === subjectId;
  if (sameScope) {
    const updated = await upstream(req, path, { method: 'PUT', copyQuery: false, body: { status: input.status === 'inactive' ? 'inactive' : 'active' } });
    if (updated.status < 300) await persistTeacherDetail(req, assignmentId, teacher.id, input, input.status === 'inactive' ? 'inactive' : 'active');
    return json(res, updated.status, updated.status < 300 ? { ok: true, id: assignmentId } : updated.data);
  }
  let replacementId;
  const equivalent = teacher.assignments.find(item => Number(item.id) !== assignmentId && Number(item.class_id) === classId && (Number(item.subject_id) || null) === subjectId);
  if (equivalent) {
    const activated = await upstream(req, `/api/teacher-assignments/${equivalent.id}`, { method: 'PUT', copyQuery: false, body: { status: 'active' } });
    if (activated.status >= 300) return json(res, activated.status, activated.data);
    replacementId = Number(equivalent.id);
  } else {
    const created = await upstream(req, `/api/users/${teacher.id}/assignments`, { method: 'POST', copyQuery: false, body: input });
    if (created.status >= 300) return json(res, created.status, created.data);
    replacementId = Number(created.data.id);
  }
  await persistTeacherDetail(req, replacementId, teacher.id, input, 'active');
  const deactivated = await upstream(req, path, { method: 'PUT', copyQuery: false, body: { status: 'inactive' } });
  if (deactivated.status >= 300) return json(res, deactivated.status, deactivated.data);
  await setTeacherDetailStatus(assignmentId, 'inactive');
  return json(res, 200, { ok: true, replaced: true });
}

async function handleTeacherSession(req, res, path) {
  if (path !== '/api/session' || req.method !== 'GET') return null;
  const result = await upstream(req, path, { method: 'GET', copyQuery: false });
  if (result.status !== 200 || !result.data.user || result.data.user.role !== 'Professor') return json(res, result.status, result.data);
  const details = await teacherAssignmentDetails(result.data.user.id);
  const [user] = mergeTeacherDetails([result.data.user], details);
  const selectedId = Number(req.headers['x-teacher-assignment-id'] || user.assignment?.id || user.assignments?.[0]?.id || 0);
  user.assignment = user.assignments.find(item => Number(item.id) === selectedId && item.status === 'active') || user.assignments.find(item => item.status === 'active') || null;
  return json(res, 200, { ...result.data, user });
}

async function requireUser(req, roles) {
  const session = await upstream(req, '/api/session', { method: 'GET', copyQuery: false });
  if (session.status !== 200 || !session.data.user) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401 });
  let user = session.data.user;
  if (user.role === 'Professor') {
    const details = await teacherAssignmentDetails(user.id);
    [user] = mergeTeacherDetails([user], details);
    const selectedId = Number(req.headers['x-teacher-assignment-id'] || user.assignment?.id || user.assignments?.[0]?.id || 0);
    user.assignment = user.assignments.find(item => Number(item.id) === selectedId && item.status === 'active') || user.assignments.find(item => item.status === 'active') || null;
  }
  if (roles && !roles.has(user.role)) throw Object.assign(new Error('Seu perfil não possui acesso a esta função.'), { status: 403 });
  return user;
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
  const subjectIds = [...new Set((Array.isArray(row.subject_ids) && row.subject_ids.length ? row.subject_ids : row.subject_id ? [row.subject_id] : []).map(Number).filter(Boolean))];
  const subjects = subjectIds.map(id => context.subjects.find(item => Number(item.id) === id)).filter(Boolean);
  return {
    ...row,
    id: -Number(row.id),
    class_name: klass?.name || 'Turma removida',
    school_year: klass?.school_year || null,
    grade_level: klass?.grade_level || null,
    shift: klass?.shift || null,
    subject_ids: subjectIds,
    subject_names: subjects.map(subject => subject.name),
    subjects: subjects.map(subject => ({ id: Number(subject.id), name: subject.name })),
    subject: subjects.map(subject => subject.name).join(', ') || 'Sem disciplina',
    materials: Array.isArray(row.materials) ? row.materials : [],
    no_agenda: row.no_agenda ? 1 : 0,
    status: row.agenda_status || row.status || 'Concluída',
    agenda_source: 'local',
  };
}

function agendaSnapshot(row) {
  if (!row) return null;
  const fields = ['id','agenda_date','class_id','class_name','school_year','grade_level','subject_id','subject_ids','subject_names','subject_component','teacher_name','content','materials','notes','no_agenda','status','created_by','created_by_name','updated_by','updated_by_name','created_at','updated_at'];
  return Object.fromEntries(fields.map(field => [field, row[field] ?? null]));
}

async function recordAgendaHistory(db, source, agendaId, action, user, beforeData = null, afterData = null) {
  await db.query('INSERT INTO crescer_agenda_history (agenda_source,agenda_id,action,actor_id,actor_name,before_data,after_data,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)', [source, Number(agendaId), action, Number(user.id), user.name, beforeData ? JSON.stringify(agendaSnapshot(beforeData)) : null, afterData ? JSON.stringify(agendaSnapshot(afterData)) : null, Date.now()]);
}

function canChangeAgenda(user, agenda) {
  if (MANAGER_ROLES.has(user.role)) return true;
  if (user.role !== 'Professor') return false;
  const assignments = (user.assignments || (user.assignment ? [user.assignment] : [])).filter(item => item.status !== 'inactive' && Number(item.class_id) === Number(agenda.class_id) && Number(item.can_agenda));
  const subjectIds = Array.isArray(agenda.subject_ids) && agenda.subject_ids.length ? agenda.subject_ids.map(Number) : agenda.subject_id ? [Number(agenda.subject_id)] : [];
  return assignments.some(item => !item.subject_id || !subjectIds.length || subjectIds.includes(Number(item.subject_id)));
}

async function allAgendas(req, context, user) {
  const [oldResponse, localResult, tombstoneResult, overrideResult] = await Promise.all([
    upstream(req, '/api/agendas', { method: 'GET', copyQuery: false }),
    ensureSchema().then(db => db.query('SELECT * FROM crescer_agendas ORDER BY agenda_date DESC, id DESC')),
    ensureSchema().then(db => db.query('SELECT upstream_agenda_id FROM crescer_agenda_tombstones')),
    ensureSchema().then(db => db.query('SELECT upstream_agenda_id,payload FROM crescer_agenda_upstream_overrides')),
  ]);
  if (oldResponse.status === 401 || oldResponse.status === 403) throw Object.assign(new Error(oldResponse.data.error || 'Acesso negado.'), { status: oldResponse.status });
  const tombstones = new Set(tombstoneResult.rows.map(item => Number(item.upstream_agenda_id)));
  const overrides = new Map(overrideResult.rows.map(item => [Number(item.upstream_agenda_id), item.payload]));
  const oldRows = oldResponse.status === 200 ? (oldResponse.data.agendas || []).filter(item => !tombstones.has(Number(item.id))).map(item => ({ ...item, ...(overrides.get(Number(item.id)) || {}), id: Number(item.id), status: overrides.get(Number(item.id))?.status || item.status || 'Concluída', agenda_source: 'upstream' })) : [];
  let localRows = localResult.rows.map(row => decorateAgenda(row, context));
  if (user.role === 'Professor') {
    const assignment = user.assignment;
    if (!assignment) localRows = [];
    else localRows = localRows.filter(row => Number(row.class_id) === Number(assignment.class_id) && (!assignment.subject_id || row.subject_ids.includes(Number(assignment.subject_id))));
  }
  return [...localRows, ...oldRows].sort((a, b) => String(b.agenda_date).localeCompare(String(a.agenda_date)) || Number(b.updated_at || 0) - Number(a.updated_at || 0));
}

async function handleAgendas(req, res, path) {
  const user = await requireUser(req, PEDAGOGICAL_ROLES);
  const context = await academicContext(req);
  if (path === '/api/agendas' && req.method === 'GET') return json(res, 200, { agendas: await allAgendas(req, context, user) });

  if (path === '/api/agenda-history' && req.method === 'GET') {
    if (!MANAGER_ROLES.has(user.role)) return json(res, 403, { error: 'O histórico completo é exclusivo da Gestão Escolar.' });
    const db = await ensureSchema();
    const result = await db.query('SELECT id,agenda_source,agenda_id,action,actor_id,actor_name,before_data,after_data,created_at FROM crescer_agenda_history ORDER BY created_at DESC,id DESC LIMIT 1000');
    return json(res, 200, { history: result.rows });
  }

  if (path === '/api/agenda-status' && req.method === 'GET') {
    const date = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Informe uma data válida.' });
    const agendas = (await allAgendas(req, context, user)).filter(item => item.agenda_date === date);
    const visibleClasses = context.classes.filter(item => item.status !== 'inactive' && (user.role !== 'Professor' || Number(item.id) === Number(user.assignment?.class_id || 0)));
    const statuses = visibleClasses.map(klass => {
      const rows = agendas.filter(item => Number(item.class_id) === Number(klass.id));
      const withAgenda = rows.some(item => !Number(item.no_agenda));
      const noAgenda = rows.some(item => Number(item.no_agenda));
      const users = [...new Set(rows.map(item => item.created_by_name).filter(Boolean))];
      return { ...klass, status: withAgenda ? 'with_agenda' : noAgenda ? 'no_agenda' : 'no_record', record_count: rows.length, recorded_by_names: users.join(', '), last_updated_at: rows.reduce((last, item) => Math.max(last, Number(item.updated_at || item.created_at || 0)), 0) || null };
    });
    return json(res, 200, { date, statuses });
  }

  const historyMatch = path.match(/^\/api\/agendas\/(-?\d+)\/history$/);
  if (historyMatch && req.method === 'GET') {
    if (!MANAGER_ROLES.has(user.role)) return json(res, 403, { error: 'O histórico completo é exclusivo da Gestão Escolar.' });
    const rawId = Number(historyMatch[1]), source = rawId < 0 ? 'local' : 'upstream', agendaId = Math.abs(rawId), db = await ensureSchema();
    const result = await db.query('SELECT id,action,actor_id,actor_name,before_data,after_data,created_at FROM crescer_agenda_history WHERE agenda_source=$1 AND agenda_id=$2 ORDER BY created_at DESC,id DESC', [source, agendaId]);
    return json(res, 200, { history: result.rows });
  }

  const match = path.match(/^\/api\/agendas\/(-?\d+)$/);
  if (match && Number(match[1]) > 0 && (req.method === 'PUT' || req.method === 'DELETE')) {
    const agendaId = Number(match[1]), db = await ensureSchema(), before = (await allAgendas(req, context, user)).find(item => Number(item.id) === agendaId);
    if (!before) return json(res, 404, { error: 'Agenda não encontrada ou já excluída.' });
    if (!canChangeAgenda(user, before)) return json(res, 403, { error: 'Sua conta não possui autorização para modificar esta agenda.' });
    if (req.method === 'DELETE') {
      const deleted = await upstream(req, path, { method: 'DELETE', copyQuery: false, body: {} });
      if (deleted.status >= 300 && deleted.status !== 404) return json(res, deleted.status, deleted.data);
      await db.query(`INSERT INTO crescer_agenda_tombstones (upstream_agenda_id,deleted_by,deleted_by_name,deleted_at,snapshot) VALUES ($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT (upstream_agenda_id) DO UPDATE SET deleted_by=EXCLUDED.deleted_by,deleted_by_name=EXCLUDED.deleted_by_name,deleted_at=EXCLUDED.deleted_at,snapshot=EXCLUDED.snapshot`, [agendaId, Number(user.id), user.name, Date.now(), JSON.stringify(agendaSnapshot(before))]);
      await db.query('DELETE FROM crescer_agenda_upstream_overrides WHERE upstream_agenda_id=$1', [agendaId]);
      await recordAgendaHistory(db, 'upstream', agendaId, 'delete', user, before, null);
      return json(res, 200, { ok: true, permanentlyDeleted: true });
    }
    const input = await body(req), updated = await upstream(req, path, { method: 'PUT', copyQuery: false, body: input });
    if (updated.status >= 300) return json(res, updated.status, updated.data);
    const after = { ...before, agenda_date: String(input.date || before.agenda_date), class_id: Number(input.classId || before.class_id), subject_id: Number(input.subjectId) || null, subject_ids: Array.isArray(input.subjectIds) ? input.subjectIds.map(Number).filter(Boolean) : before.subject_ids, subject_component: text(input.subjectComponent, 240), teacher_name: text(input.teacherName, 240) || before.teacher_name, content: input.noAgenda ? 'Não tem agenda' : text(input.agenda) || 'Agenda registrada', materials: input.noAgenda ? [] : Array.isArray(input.materials) ? input.materials : before.materials, notes: text(input.notes), no_agenda: input.noAgenda ? 1 : 0, status: text(input.status, 40) || before.status || 'Concluída', updated_by: Number(user.id), updated_by_name: user.name, updated_at: Date.now() };
    await db.query(`INSERT INTO crescer_agenda_upstream_overrides (upstream_agenda_id,payload,updated_by,updated_by_name,updated_at) VALUES ($1,$2::jsonb,$3,$4,$5)
      ON CONFLICT (upstream_agenda_id) DO UPDATE SET payload=EXCLUDED.payload,updated_by=EXCLUDED.updated_by,updated_by_name=EXCLUDED.updated_by_name,updated_at=EXCLUDED.updated_at`, [agendaId, JSON.stringify(agendaSnapshot(after)), Number(user.id), user.name, after.updated_at]);
    await recordAgendaHistory(db, 'upstream', agendaId, 'update', user, before, after);
    return json(res, 200, { ok: true, id: agendaId, agenda: after });
  }
  if (match && Number(match[1]) > 0) return proxy(req, res, path);
  if (!((path === '/api/agendas' && req.method === 'POST') || (match && req.method === 'PUT') || (match && req.method === 'DELETE'))) return null;
  const db = await ensureSchema();
  const localId = match ? Math.abs(Number(match[1])) : 0;
  if (req.method === 'DELETE') {
    const existing = await db.query('SELECT * FROM crescer_agendas WHERE id=$1', [localId]);
    if (!existing.rowCount) return json(res, 404, { error: 'Agenda não encontrada.' });
    const before = decorateAgenda(existing.rows[0], context);
    if (!canChangeAgenda(user, before)) return json(res, 403, { error: 'Sua conta não possui autorização para excluir esta agenda.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO crescer_agenda_history (agenda_source,agenda_id,action,actor_id,actor_name,before_data,after_data,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NULL,$7)', ['local', localId, 'delete', Number(user.id), user.name, JSON.stringify(agendaSnapshot(before)), Date.now()]);
      const deleted = await client.query('DELETE FROM crescer_agendas WHERE id=$1 RETURNING id', [localId]);
      if (!deleted.rowCount) throw Object.assign(new Error('Agenda não encontrada.'), { status: 404 });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return json(res, 200, { ok: true, permanentlyDeleted: true });
  }

  const input = await body(req);
  const agendaDate = String(input.date || '').slice(0, 10);
  const classId = Number(input.classId);
  const subjectIds = [...new Set((Array.isArray(input.subjectIds) ? input.subjectIds : [input.subjectId]).map(Number).filter(value => Number.isInteger(value) && value > 0))];
  const subjectId = subjectIds[0] || null;
  const noAgenda = Boolean(input.noAgenda);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(agendaDate) || !classId) return json(res, 400, { error: 'Informe a data e a turma.' });
  const klass = context.classes.find(item => Number(item.id) === classId);
  if (!klass) return json(res, 400, { error: 'Turma não encontrada.' });
  if (user.role === 'Professor') {
    const assignments = (user.assignments || (user.assignment ? [user.assignment] : [])).filter(item => Number(item.class_id) === classId && Number(item.can_agenda));
    if (!assignments.length) return json(res, 403, { error: 'Sua conta não possui acesso a esta turma ou à Agenda Escolar.' });
    const permitted = new Set(assignments.map(item => Number(item.subject_id)).filter(Boolean));
    if (subjectIds.some(id => !permitted.has(id))) return json(res, 403, { error: 'Sua conta não possui acesso a uma das disciplinas selecionadas.' });
  }

  const existing = (await allAgendas(req, context, user)).filter(item => item.agenda_date === agendaDate && Number(item.class_id) === classId && Number(item.id) !== -localId);
  if (noAgenda && existing.length) return json(res, 409, { error: 'Já existe uma agenda registrada para esta turma e data.' });
  if (!noAgenda && existing.some(item => Number(item.no_agenda))) return json(res, 409, { error: 'Esta turma e data estão marcadas como “Não tem agenda”. Edite o registro existente.' });
  if (!noAgenda && existing.some(item => {
    const ids = Array.isArray(item.subject_ids) ? item.subject_ids.map(Number) : item.subject_id ? [Number(item.subject_id)] : [];
    return subjectIds.length ? ids.some(id => subjectIds.includes(id)) : ids.length === 0;
  })) return json(res, 409, { error: subjectId ? 'Já existe uma agenda de uma das disciplinas selecionadas para a turma e data.' : 'Já existe uma agenda geral para a turma e data.' });

  const content = noAgenda ? 'Não tem agenda' : text(input.agenda) || 'Agenda registrada';
  const materials = noAgenda ? [] : (Array.isArray(input.materials) ? input.materials.map(item => String(item).slice(0, 240)).slice(0, 30) : []);
  const agendaStatus = ['Rascunho', 'Concluída', 'Arquivada'].includes(String(input.status || '')) ? String(input.status) : 'Concluída';
  const now = Date.now();
  const values = [agendaDate, classId, subjectId, JSON.stringify(subjectIds), subjectIds.length === 1 ? text(input.subjectComponent, 240) : null, text(input.teacherName, 240) || klass.teacher_name || user.name, content, JSON.stringify(materials), text(input.notes), noAgenda, agendaStatus];
  if (localId) {
    const beforeResult = await db.query('SELECT * FROM crescer_agendas WHERE id=$1', [localId]);
    if (!beforeResult.rowCount) return json(res, 404, { error: 'Agenda não encontrada.' });
    const before = decorateAgenda(beforeResult.rows[0], context);
    if (!canChangeAgenda(user, before)) return json(res, 403, { error: 'Sua conta não possui autorização para editar esta agenda.' });
    const updated = await db.query(`UPDATE crescer_agendas SET agenda_date=$1,class_id=$2,subject_id=$3,subject_ids=$4::jsonb,subject_component=$5,teacher_name=$6,content=$7,materials=$8::jsonb,notes=$9,no_agenda=$10,agenda_status=$11,updated_by=$12,updated_by_name=$13,updated_at=$14 WHERE id=$15 RETURNING *`, [...values, Number(user.id), user.name, now, localId]);
    if (!updated.rowCount) return json(res, 404, { error: 'Agenda não encontrada.' });
    const after = decorateAgenda(updated.rows[0], context);
    await recordAgendaHistory(db, 'local', localId, 'update', user, before, after);
    return json(res, 200, { ok: true, id: -localId, agenda: after });
  }
  const inserted = await db.query(`INSERT INTO crescer_agendas (agenda_date,class_id,subject_id,subject_ids,subject_component,teacher_name,content,materials,notes,no_agenda,agenda_status,created_by,created_by_name,updated_by,updated_by_name,created_at,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$12,$13,$14,$14) RETURNING *`, [...values, Number(user.id), user.name, now]);
  const saved = decorateAgenda(inserted.rows[0], context);
  await recordAgendaHistory(db, 'local', Number(inserted.rows[0].id), 'create', user, null, saved);
  return json(res, 201, { ok: true, id: -Number(inserted.rows[0].id), agenda: saved });
}

async function nextLocalId(db, table) {
  const result = await db.query(`SELECT GREATEST(COALESCE(MAX(id),0)+1,1000000000) AS id FROM ${table}`);
  return Number(result.rows[0].id);
}

async function syncUpstreamStudents(req, db) {
  const result = await upstream(req, '/api/students', { method: 'GET', copyQuery: false });
  if (result.status === 401 || result.status === 403) throw Object.assign(new Error(result.data.error || 'Acesso negado.'), { status: result.status });
  if (result.status !== 200) return;
  const now = Date.now();
  for (const row of result.data.students || []) {
    const studentId = Number(row.id);
    if (!studentId) continue;
    await db.query(`INSERT INTO crescer_students (id,registration,name,birth_date,guardian_name,guardian_phone,mother_name,father_name,guardian_email,address,enrollment_notes,current_class_id,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) ON CONFLICT DO NOTHING`,
      [studentId, row.registration || `ALUNO-${studentId}`, row.name || 'Aluno', row.birth_date || null, row.guardian_name || null, row.guardian_phone || null, row.mother_name || null, row.father_name || null, row.guardian_email || null, row.address || null, row.enrollment_notes || null, Number(row.current_class_id || row.class_id) || null, row.status || 'active', Number(row.created_at) || now]);
    const year = Number(row.school_year), classId = Number(row.membership_class_id || row.class_id), membershipId = Number(row.membership_id);
    if (OFFICIAL_SCHOOL_YEARS.includes(year) && classId) {
      const id = membershipId || await nextLocalId(db, 'crescer_student_memberships');
      await db.query(`INSERT INTO crescer_student_memberships (id,student_id,class_id,school_year,is_current,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (student_id,school_year) DO NOTHING`, [id, studentId, classId, year, Boolean(Number(row.is_current)), Number(row.membership_created_at || row.created_at) || now]);
    }
  }
}

function studentOutput(row, context) {
  const klass = context.classes.find(item => Number(item.id) === Number(row.class_id));
  return {
    id: Number(row.id), membership_id: Number(row.membership_id), registration: row.registration, name: row.name,
    birth_date: row.birth_date, guardian_name: row.guardian_name, guardian_phone: row.guardian_phone,
    mother_name: row.mother_name, father_name: row.father_name, guardian_email: row.guardian_email,
    address: row.address, enrollment_notes: row.enrollment_notes, current_class_id: Number(row.current_class_id) || null,
    membership_class_id: Number(row.class_id), class_id: Number(row.class_id), class_name: klass?.name || 'Turma removida',
    grade_level: klass?.grade_level || klass?.name || null, shift: klass?.shift || null, school_year: Number(row.school_year),
    is_current: row.is_current ? 1 : 0, status: row.status, created_at: Number(row.created_at), updated_at: Number(row.updated_at),
  };
}

async function studentRows(db, context, filters = {}) {
  const values = [], where = [`s.status <> 'inactive'`];
  if (filters.year) { values.push(Number(filters.year)); where.push(`m.school_year=$${values.length}`); }
  if (filters.classId) { values.push(Number(filters.classId)); where.push(`m.class_id=$${values.length}`); }
  const result = await db.query(`SELECT s.*,m.id AS membership_id,m.class_id,m.school_year,m.is_current,m.created_at AS membership_created_at
    FROM crescer_students s JOIN crescer_student_memberships m ON m.student_id=s.id WHERE ${where.join(' AND ')} ORDER BY m.school_year DESC,s.name`, values);
  return result.rows.map(row => studentOutput(row, context));
}

async function recordStudentHistory(db, studentId, membershipId, action, user, beforeData, afterData) {
  await db.query('INSERT INTO crescer_student_change_history (student_id,membership_id,action,actor_user_id,actor_name,before_data,after_data,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)', [studentId, membershipId || null, action, Number(user.id), user.name, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null, Date.now()]);
}

async function createAnnualEnrollment(db, studentId, membershipId, classId, schoolYear, now) {
  const id = await nextLocalId(db, 'crescer_student_annual_enrollments');
  await db.query(`INSERT INTO crescer_student_annual_enrollments (id,student_id,membership_id,class_id,school_year,enrollment_date,status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$7) ON CONFLICT (student_id,school_year) DO NOTHING`, [id, studentId, membershipId, classId, schoolYear, `${schoolYear}-01-01`, now]);
}

async function handleStudents(req, res, path) {
  const user = await requireUser(req, PEDAGOGICAL_ROLES), db = await ensureSchema(), context = await academicContext(req);
  await syncUpstreamStudents(req, db);
  if (path === '/api/school-years' && req.method === 'GET') {
    const counts = await db.query(`SELECT m.school_year,COUNT(DISTINCT m.class_id)::int AS classes_count,COUNT(DISTINCT m.student_id)::int AS students_count,COUNT(e.id)::int AS enrollments_count FROM crescer_student_memberships m LEFT JOIN crescer_student_annual_enrollments e ON e.membership_id=m.id GROUP BY m.school_year`);
    const byYear = new Map(counts.rows.map(row => [Number(row.school_year), row]));
    return json(res, 200, { years: OFFICIAL_SCHOOL_YEARS.map(year => ({ year, label: String(year), status: 'active', classes_count: context.classes.filter(item => Number(item.school_year) === year && item.status !== 'inactive').length, students_count: byYear.get(year)?.students_count || 0, enrollments_count: byYear.get(year)?.enrollments_count || 0 })) });
  }
  if (path === '/api/students' && req.method === 'GET') {
    let rows = await studentRows(db, context, { year: req.query.school_year, classId: req.query.class_id });
    if (user.role === 'Professor') {
      const allowed = new Set((user.assignments || []).filter(item => item.status !== 'inactive').map(item => Number(item.class_id)));
      rows = rows.filter(item => allowed.has(Number(item.class_id)));
    }
    return json(res, 200, { students: rows });
  }
  const historyMatch = path.match(/^\/api\/students\/(\d+)\/history$/);
  if (historyMatch && req.method === 'GET') {
    const studentId = Number(historyMatch[1]);
    let academic = await studentRows(db, context, {}); academic = academic.filter(item => item.id === studentId);
    const changes = await db.query('SELECT id,action,actor_user_id,actor_name,before_data,after_data,created_at FROM crescer_student_change_history WHERE student_id=$1 ORDER BY created_at DESC,id DESC', [studentId]);
    return json(res, 200, { history: academic, changes: changes.rows });
  }
  if (!MANAGER_ROLES.has(user.role)) return json(res, 403, { error: 'Somente a Gestão Escolar pode alterar cadastros de alunos.' });
  if (path === '/api/students' && req.method === 'POST') {
    const input = await body(req), classId = Number(input.classId), schoolYear = Number(input.schoolYear), klass = context.classes.find(item => Number(item.id) === classId && Number(item.school_year) === schoolYear);
    if (!klass || !OFFICIAL_SCHOOL_YEARS.includes(schoolYear)) return json(res, 400, { error: 'Selecione uma turma e um ano letivo válidos.' });
    const now = Date.now(), existingId = Number(input.existingStudentId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (existingId) {
        const found = await client.query('SELECT * FROM crescer_students WHERE id=$1', [existingId]);
        if (!found.rowCount) throw Object.assign(new Error('Aluno existente não encontrado.'), { status: 404 });
        const duplicate = await client.query('SELECT id FROM crescer_student_memberships WHERE student_id=$1 AND school_year=$2', [existingId, schoolYear]);
        if (duplicate.rowCount) throw Object.assign(new Error('Este aluno já possui vínculo neste ano letivo.'), { status: 409 });
        const membershipId = await nextLocalId(client, 'crescer_student_memberships');
        await client.query('UPDATE crescer_student_memberships SET is_current=FALSE,updated_at=$2 WHERE student_id=$1', [existingId, now]);
        await client.query('INSERT INTO crescer_student_memberships (id,student_id,class_id,school_year,is_current,created_at,updated_at) VALUES ($1,$2,$3,$4,TRUE,$5,$5)', [membershipId, existingId, classId, schoolYear, now]);
        await client.query('UPDATE crescer_students SET current_class_id=$1,updated_by=$2,updated_at=$3 WHERE id=$4', [classId, Number(user.id), now, existingId]);
        await createAnnualEnrollment(client, existingId, membershipId, classId, schoolYear, now);
        await recordStudentHistory(client, existingId, membershipId, 'year_linked', user, null, { class_id: classId, school_year: schoolYear });
        await client.query('COMMIT');
        return json(res, 201, { ok: true, id: existingId, membershipId });
      }
      const registration = text(input.registration, 120), name = text(input.name, 500);
      if (!registration || !name) throw Object.assign(new Error('Informe a matrícula e o nome do aluno.'), { status: 400 });
      const studentId = await nextLocalId(client, 'crescer_students'), membershipId = await nextLocalId(client, 'crescer_student_memberships');
      await client.query(`INSERT INTO crescer_students (id,registration,name,birth_date,guardian_name,guardian_phone,mother_name,father_name,guardian_email,address,enrollment_notes,current_class_id,status,created_by,updated_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13,$13,$14,$14)`, [studentId, registration, name, input.birthDate || null, text(input.guardianName,500), text(input.guardianPhone,120), text(input.motherName,500), text(input.fatherName,500), text(input.guardianEmail,500), text(input.address), text(input.enrollmentNotes), classId, Number(user.id), now]);
      await client.query('INSERT INTO crescer_student_memberships (id,student_id,class_id,school_year,is_current,created_at,updated_at) VALUES ($1,$2,$3,$4,TRUE,$5,$5)', [membershipId, studentId, classId, schoolYear, now]);
      await createAnnualEnrollment(client, studentId, membershipId, classId, schoolYear, now);
      await recordStudentHistory(client, studentId, membershipId, 'created', user, null, { registration, name, class_id: classId, school_year: schoolYear });
      await client.query('COMMIT');
      return json(res, 201, { ok: true, id: studentId, membershipId });
    } catch (error) { await client.query('ROLLBACK'); if (error?.code === '23505') error = Object.assign(new Error('Já existe um aluno com esta matrícula.'), { status: 409 }); throw error; } finally { client.release(); }
  }
  const match = path.match(/^\/api\/students\/(\d+)$/);
  if (!match) return null;
  const studentId = Number(match[1]);
  if (req.method === 'DELETE') {
    await db.query("UPDATE crescer_students SET status='inactive',updated_by=$1,updated_at=$2 WHERE id=$3", [Number(user.id), Date.now(), studentId]);
    await recordStudentHistory(db, studentId, null, 'inactivated', user, null, { status: 'inactive' });
    return json(res, 200, { ok: true });
  }
  if (req.method !== 'PUT') return null;
  const input = await body(req), membershipId = Number(input.membershipId), classId = Number(input.classId), schoolYear = Number(input.schoolYear);
  const klass = context.classes.find(item => Number(item.id) === classId && Number(item.school_year) === schoolYear);
  if (!klass) return json(res, 400, { error: 'Selecione uma turma compatível com o ano letivo.' });
  const before = await db.query('SELECT s.*,m.class_id,m.school_year,m.id AS membership_id FROM crescer_students s JOIN crescer_student_memberships m ON m.student_id=s.id WHERE s.id=$1 AND m.id=$2', [studentId, membershipId]);
  if (!before.rowCount) return json(res, 404, { error: 'Aluno ou vínculo anual não encontrado.' });
  const now = Date.now();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE crescer_students SET registration=$1,name=$2,birth_date=$3,guardian_name=$4,guardian_phone=$5,mother_name=$6,father_name=$7,guardian_email=$8,address=$9,enrollment_notes=$10,updated_by=$11,updated_at=$12 WHERE id=$13`, [text(input.registration,120), text(input.name,500), input.birthDate || null, text(input.guardianName,500), text(input.guardianPhone,120), text(input.motherName,500), text(input.fatherName,500), text(input.guardianEmail,500), text(input.address), text(input.enrollmentNotes), Number(user.id), now, studentId]);
    await client.query('UPDATE crescer_student_memberships SET class_id=$1,school_year=$2,updated_at=$3 WHERE id=$4 AND student_id=$5', [classId, schoolYear, now, membershipId, studentId]);
    const latest = await client.query('SELECT class_id FROM crescer_student_memberships WHERE student_id=$1 ORDER BY school_year DESC LIMIT 1', [studentId]);
    await client.query('UPDATE crescer_students SET current_class_id=$1 WHERE id=$2', [latest.rows[0]?.class_id || classId, studentId]);
    await client.query('UPDATE crescer_student_annual_enrollments SET class_id=$1,school_year=$2,updated_at=$3 WHERE student_id=$4 AND membership_id=$5', [classId, schoolYear, now, studentId, membershipId]);
    const after = { ...input, id: studentId, membership_id: membershipId, class_id: classId, school_year: schoolYear };
    await recordStudentHistory(client, studentId, membershipId, 'updated', user, before.rows[0], after);
    await client.query('COMMIT');
    return json(res, 200, { ok: true, id: studentId, membershipId });
  } catch (error) { await client.query('ROLLBACK'); if (error?.code === '23505') error = Object.assign(new Error('Já existe um aluno ou vínculo com estes dados.'), { status: 409 }); throw error; } finally { client.release(); }
}

async function handleAnnualEnrollments(req, res, path) {
  if (req.method !== 'GET') return null;
  const user = await requireUser(req, MANAGER_ROLES), db = await ensureSchema(), context = await academicContext(req);
  await syncUpstreamStudents(req, db);
  const match = path.match(/^\/api\/enrollments\/(\d+)$/);
  const baseSql = `SELECT e.*,s.registration,s.name AS student_name,s.birth_date,s.guardian_name,s.guardian_phone,s.enrollment_notes AS notes,m.class_id
    FROM crescer_student_annual_enrollments e JOIN crescer_students s ON s.id=e.student_id JOIN crescer_student_memberships m ON m.id=e.membership_id`;
  if (match && Number(match[1]) >= 1000000000) {
    const result = await db.query(`${baseSql} WHERE e.id=$1`, [Number(match[1])]);
    if (!result.rowCount) return json(res, 404, { error: 'Matrícula anual não encontrada.' });
    const row = result.rows[0], klass = context.classes.find(item => Number(item.id) === Number(row.class_id));
    const enrollment = { ...row, id: Number(row.id), student_id: Number(row.student_id), membership_id: Number(row.membership_id), class_id: Number(row.class_id), code: `MAT-${row.school_year}-${row.student_id}`, grade_id: null, grade_name_snapshot: klass?.grade_level || klass?.name || 'Série vinculada', class_name_snapshot: klass?.name || 'Turma vinculada', enrollment_fee_cents: 0, books_total_cents: 0, uniforms_total_cents: 0, uniform_regular_total_cents: 0, uniform_physical_total_cents: 0, initial_total_cents: 0, monthly_fee_cents: 0, include_first_monthly: 0, created_by_name: 'Gestão Escolar' };
    return json(res, 200, { enrollment, items: [], history: [] });
  }
  if (path !== '/api/enrollments') return null;
  const old = await upstream(req, path, { method: 'GET' });
  if (old.status >= 400 && old.status !== 404) return json(res, old.status, old.data);
  const values = [], where = ["s.status <> 'inactive'"];
  const year = Number(req.query.school_year), classId = Number(req.query.class_id), search = String(req.query.search || '').trim();
  if (year) { values.push(year); where.push(`e.school_year=$${values.length}`); }
  if (classId) { values.push(classId); where.push(`e.class_id=$${values.length}`); }
  if (search) { values.push(`%${search}%`); where.push(`(s.name ILIKE $${values.length} OR s.registration ILIKE $${values.length} OR COALESCE(s.guardian_name,'') ILIKE $${values.length})`); }
  const result = await db.query(`${baseSql} WHERE ${where.join(' AND ')} ORDER BY e.school_year DESC,s.name`, values);
  const local = result.rows.map(row => { const klass = context.classes.find(item => Number(item.id) === Number(row.class_id)); return { ...row, id: Number(row.id), student_id: Number(row.student_id), class_id: Number(row.class_id), code: `MAT-${row.school_year}-${row.student_id}`, grade_name_snapshot: klass?.grade_level || klass?.name || 'Série vinculada', class_name_snapshot: klass?.name || 'Turma vinculada', enrollment_fee_cents: 0, books_total_cents: 0, uniforms_total_cents: 0, uniform_regular_total_cents: 0, uniform_physical_total_cents: 0, initial_total_cents: 0, monthly_fee_cents: 0, include_first_monthly: 0, created_by_name: user.name }; });
  const upstreamRows = old.status === 200 ? old.data.enrollments || [] : [];
  const localKeys = new Set(local.map(item => `${item.registration}:${item.school_year}`));
  return json(res, 200, { enrollments: [...local, ...upstreamRows.filter(item => !localKeys.has(`${item.registration}:${item.school_year}`))] });
}

async function handleSummary(req, res, path) {
  if (path !== '/api/summary' || req.method !== 'GET') return null;
  const user = await requireUser(req, PEDAGOGICAL_ROLES), context = await academicContext(req);
  const result = await upstream(req, path, { method: 'GET', copyQuery: false });
  if (result.status !== 200) return json(res, result.status, result.data);
  const agendas = await allAgendas(req, context, user);
  return json(res, 200, { ...result.data, agendas: agendas.length });
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
  if (!MANAGER_ROLES.has(user.role)) return json(res, 403, { error: 'Somente Administração e Gestão Escolar podem alterar a Biblioteca.' });
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
    if (path === '/api/session') {
      const response = await handleTeacherSession(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/summary') {
      const response = await handleSummary(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/library-books' || /^\/api\/library-books\/\d+$/.test(path)) {
      const response = await handleLibrary(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/agendas' || path === '/api/agenda-status' || path === '/api/agenda-history' || /^\/api\/agendas\/-?\d+(?:\/history)?$/.test(path)) {
      const response = await handleAgendas(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/users' || /^\/api\/users\/\d+\/assignments$/.test(path) || /^\/api\/teacher-assignments\/\d+$/.test(path)) {
      const response = await handleTeacherAssignments(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/school-years' || path === '/api/students' || /^\/api\/students\/\d+(?:\/history)?$/.test(path)) {
      const response = await handleStudents(req, res, path);
      if (response !== null) return response;
    }
    if (path === '/api/enrollments' || /^\/api\/enrollments\/\d+$/.test(path)) {
      const response = await handleAnnualEnrollments(req, res, path);
      if (response !== null) return response;
    }
    if (MANAGER_ONLY_ROUTES.some(pattern => pattern.test(path))) await requireUser(req, MANAGER_ROLES);
    return proxy(req, res, path);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.status ? error.message : 'Erro interno ao acessar o banco de dados.' });
  }
}
