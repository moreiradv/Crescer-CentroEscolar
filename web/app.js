let currentUser = null;
let managedUsers = [];
let classes = [];
let students = [];
let agendas = [];
let attendance = [];
let attendanceDirty = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Araguaina' }).format(new Date());
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const initialsFor = name => String(name || '').split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
const formatDate = value => value ? value.split('-').reverse().join('/') : '—';

localStorage.removeItem('crescerAgendas');
$('#agendaDate').value = todayIso();
$('#attendanceDate').value = todayIso();
$('#classYear').value = Number(todayIso().slice(0, 4));

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

function toast(title = 'Registro salvo', message = 'As informações foram atualizadas.') {
  $('#toast strong').textContent = title;
  $('#toast p').textContent = message;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 2800);
}

function applyCurrentUser(user) {
  currentUser = user;
  $$('[data-user-name]').forEach(el => el.textContent = user.name);
  $$('[data-user-role]').forEach(el => el.textContent = user.role);
  $$('[data-user-initials]').forEach(el => el.textContent = user.initials);
  $('#welcomeName').textContent = user.name.split(' ')[0];
  $('#traceUser').textContent = user.name;
  $$('[data-admin-only]').forEach(el => el.classList.toggle('hidden', user.role !== 'Administrador'));
}

async function openApp(user) {
  applyCurrentUser(user);
  $('#loginError').classList.add('hidden');
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  showPage('dashboard');
  await refreshSharedData();
}

function showPage(name) {
  $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === name));
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'usuarios') loadUsers();
  if (name === 'agendas') loadAgendas();
  if (name === 'turmas') loadStudents($('#studentClassFilter').value);
  if (name === 'frequencia') loadAttendance();
}

async function loadSummary() {
  const data = await api('/api/summary');
  $('#metricClasses').textContent = data.classes;
  $('#metricStudents').textContent = data.students;
  $('#agendaNavCount').textContent = data.agendas;
}

function classOption(klass) {
  return `<option value="${klass.id}">${escapeHtml(klass.name)} • ${escapeHtml(klass.shift)}</option>`;
}

function replaceClassOptions(select, firstLabel) {
  const previous = select.value;
  select.innerHTML = `<option value="">${firstLabel}</option>${classes.filter(item => item.status === 'active').map(classOption).join('')}`;
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function populateClassSelects() {
  replaceClassOptions($('#agendaClass'), 'Todas as turmas');
  replaceClassOptions($('#agendaFormClass'), 'Selecione uma turma');
  replaceClassOptions($('#attendanceClass'), 'Selecione uma turma');
  replaceClassOptions($('#studentClass'), 'Selecione uma turma');
  replaceClassOptions($('#studentClassFilter'), 'Todas as turmas');
}

function renderClasses() {
  const container = $('#classCards');
  if (!classes.length) {
    container.innerHTML = '<article class="panel empty-state">Nenhuma turma cadastrada. Clique em “Nova turma” para começar.</article>';
    return;
  }
  container.innerHTML = classes.map(klass => `<article class="panel class-card"><div class="class-card-top"><span class="metric-icon blue">▦</span><span class="status-active">${klass.status === 'active' ? 'Ativa' : 'Inativa'}</span></div><h2>${escapeHtml(klass.name)}</h2><p>${escapeHtml(klass.grade_level)} • ${escapeHtml(klass.shift)} • ${klass.school_year}</p><div class="class-card-meta"><span><strong>${klass.student_count}</strong> alunos</span><span><strong>${escapeHtml(klass.teacher_name || '—')}</strong> professor</span></div><button class="secondary-btn" type="button" data-add-student-class="${klass.id}">＋ Adicionar aluno</button></article>`).join('');
}

async function loadClasses(silent = false) {
  try {
    const data = await api('/api/classes');
    classes = data.classes;
    populateClassSelects();
    renderClasses();
  } catch (error) {
    if (!silent) toast('Não foi possível carregar turmas', error.message);
  }
}

function renderStudentsTable() {
  $('#studentCount').textContent = students.length;
  $('#studentTable').innerHTML = students.length ? students.map(student => `<tr><td><strong>${escapeHtml(student.registration)}</strong></td><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.class_name || 'Sem turma')}</td><td>${formatDate(student.birth_date)}</td><td>${escapeHtml(student.guardian_name || '—')}</td><td>${escapeHtml(student.guardian_phone || '—')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">Nenhum aluno cadastrado neste filtro.</td></tr>';
}

async function loadStudents(classId = '', silent = false) {
  try {
    const query = classId ? `?class_id=${encodeURIComponent(classId)}` : '';
    const data = await api(`/api/students${query}`);
    students = data.students;
    renderStudentsTable();
  } catch (error) {
    if (!silent) toast('Não foi possível carregar alunos', error.message);
  }
}

function agendaMatchesPeriod(agenda, period) {
  if (!period) return true;
  const today = new Date(`${todayIso()}T12:00:00`);
  const date = new Date(`${agenda.agenda_date}T12:00:00`);
  if (period === 'today') return agenda.agenda_date === todayIso();
  if (period === 'week') return Math.abs(today - date) <= 6 * 86400000;
  return agenda.agenda_date.slice(0, 7) === todayIso().slice(0, 7);
}

function statusClass(status) { return status === 'Concluída' ? 'done' : 'pending'; }

function renderAgendas() {
  const query = $('#agendaSearch').value.toLowerCase();
  const classId = $('#agendaClass').value;
  const status = $('#agendaStatus').value;
  const period = $('#agendaPeriod').value;
  const list = agendas.filter(item => (!query || Object.values(item).flat().join(' ').toLowerCase().includes(query)) && (!classId || String(item.class_id) === classId) && (!status || item.status === status) && agendaMatchesPeriod(item, period));
  $('#agendaCount').textContent = list.length;
  $('#agendaTable').innerHTML = list.length ? list.map(item => `<tr><td>${formatDate(item.agenda_date)}<br><small>${new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></td><td><strong>${escapeHtml(item.class_name || 'Turma removida')}</strong></td><td>${escapeHtml(item.subject)}</td><td><strong>${escapeHtml(item.content)}</strong><br><small>${item.materials.map(escapeHtml).join(' • ') || 'Sem material informado'}</small></td><td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.created_by_name || 'Usuário removido')}</td><td><button class="row-action" title="Registro salvo no banco">•••</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">A agenda está limpa. Novos registros aparecerão aqui para todos os usuários.</td></tr>';
}

function renderRecent() {
  const recent = agendas.slice(0, 4);
  $('#recentAgendaList').innerHTML = recent.length ? recent.map(item => `<div class="timeline-item"><span class="timeline-dot"></span><p><strong>${escapeHtml(item.content)}</strong><small>${escapeHtml(item.class_name || 'Turma removida')} • ${escapeHtml(item.subject)} • ${escapeHtml(item.created_by_name || 'Usuário')}</small><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></p><span>${new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') : '<p class="empty-state">Nenhuma agenda registrada ainda.</p>';
}

async function loadAgendas(silent = false) {
  try {
    const data = await api('/api/agendas');
    agendas = data.agendas;
    renderAgendas();
    renderRecent();
  } catch (error) {
    if (!silent) toast('Não foi possível carregar a agenda', error.message);
  }
}

function updateAttendanceSummary() {
  const counts = { present: 0, late: 0, justified: 0, absent: 0 };
  attendance.forEach(item => counts[item.status]++);
  $('#sumPresent').textContent = counts.present; $('#sumLate').textContent = counts.late; $('#sumJustified').textContent = counts.justified; $('#sumAbsent').textContent = counts.absent;
  const percent = attendance.length ? ((counts.present + counts.late * 0.5) / attendance.length * 100).toFixed(1).replace('.', ',') : '0';
  $('#sumPercent').textContent = `${percent}%`; $('#sumBar').style.width = `${percent.replace(',', '.')}%`;
}

function renderAttendance() {
  const classId = Number($('#attendanceClass').value);
  const klass = classes.find(item => item.id === classId);
  $('#attendanceClassTitle').textContent = klass?.name || 'Selecione uma turma';
  $('#attendanceClassMeta').textContent = klass ? `Professor regente: ${klass.teacher_name || 'não informado'} • Turno ${klass.shift.toLowerCase()}` : 'Os alunos cadastrados aparecerão aqui automaticamente.';
  $('#studentList').innerHTML = attendance.length ? attendance.map(item => `<div class="student-row"><span class="avatar">${initialsFor(item.name)}</span><div><strong>${escapeHtml(item.name)}</strong><small>Matrícula ${escapeHtml(item.registration)}</small></div><div class="status-options" data-student="${item.student_id}"><button data-status="present" class="${item.status === 'present' ? 'selected' : ''}">● Presente</button><button data-status="late" class="${item.status === 'late' ? 'selected' : ''}">● Atrasado</button><button data-status="justified" class="${item.status === 'justified' ? 'selected' : ''}">● Justificado</button><button data-status="absent" class="${item.status === 'absent' ? 'selected' : ''}">● Não presente</button></div></div>`).join('') : `<p class="empty-state">${klass ? 'Nenhum aluno ativo nesta turma.' : 'Selecione uma turma para lançar a frequência.'}</p>`;
  updateAttendanceSummary();
}

async function loadAttendance(silent = false) {
  const classId = $('#attendanceClass').value; const date = $('#attendanceDate').value;
  if (!classId || !date) { attendance = []; renderAttendance(); return; }
  try { const data = await api(`/api/attendance?date=${encodeURIComponent(date)}&class_id=${encodeURIComponent(classId)}`); attendance = data.records; attendanceDirty = false; renderAttendance(); }
  catch (error) { if (!silent) toast('Não foi possível carregar a frequência', error.message); }
}

async function loadUsers() {
  if (currentUser?.role !== 'Administrador') return;
  const container = $('#userCards'); container.innerHTML = '<p class="loading-state">Carregando usuários...</p>';
  try {
    const data = await api('/api/users'); managedUsers = data.users;
    container.innerHTML = managedUsers.map((user, index) => `<article><span class="avatar ${['peach', 'mint', 'lilac', ''][index % 4]}">${escapeHtml(user.initials || initialsFor(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><p>${escapeHtml(user.role)}</p><small>Usuário: ${escapeHtml(user.username)}</small></div><span class="${user.status === 'active' ? 'status-active' : 'status-inactive'}">${user.status === 'active' ? 'Ativo' : 'Inativo'}</span><button type="button" data-edit-user="${user.id}" aria-label="Editar ${escapeHtml(user.name)}">•••</button></article>`).join('') || '<p class="loading-state">Nenhum usuário cadastrado.</p>';
  } catch (error) { container.innerHTML = `<p class="loading-state">${escapeHtml(error.message)}</p>`; }
}

function openUserModal(user = null) {
  $('#userForm').reset(); $('#userFormError').classList.add('hidden'); $('#userFormError').textContent = '';
  $('#userId').value = user?.id || ''; $('#userFullName').value = user?.name || ''; $('#userLogin').value = user?.username || ''; $('#userRole').value = user?.role || 'Coordenação'; $('#userStatus').value = user?.status || 'active';
  $('#userModalLabel').textContent = user ? 'Editar acesso' : 'Novo acesso'; $('#userModalTitle').textContent = user ? 'Editar usuário' : 'Adicionar usuário';
  $('#passwordHint').textContent = user ? 'Deixe em branco para manter a senha atual.' : 'Obrigatória para novos usuários.'; $('#userPassword').required = !user;
  $('#deleteUserBtn').classList.toggle('hidden', !user); $('#userModal').showModal();
}

async function refreshSharedData() {
  await Promise.all([loadSummary(), loadClasses()]);
  await Promise.all([loadAgendas(), loadStudents()]);
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter || $('#loginForm button[type="submit"]'); button.disabled = true; button.textContent = 'Entrando...';
  try { const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) }); await openApp(data.user); $('#loginForm').reset(); }
  catch (error) { $('#loginError').textContent = error.message; $('#loginError').classList.remove('hidden'); $('#password').select(); }
  finally { button.disabled = false; button.innerHTML = 'Entrar no painel <span>→</span>'; }
});

$('#togglePassword').addEventListener('click', () => { const input = $('#password'); input.type = input.type === 'password' ? 'text' : 'password'; $('#togglePassword').textContent = input.type === 'password' ? 'ver' : 'ocultar'; });
$('#logoutBtn').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {} currentUser = null; $('#appShell').classList.add('hidden'); $('#loginScreen').classList.remove('hidden'); $('#loginForm').reset(); });
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$$('.nav-item').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
$$('[data-page-link]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.pageLink)));
$$('[data-open-modal]').forEach(button => button.addEventListener('click', () => { if (button.dataset.openModal === 'agendaModal') $('#agendaDate').value = todayIso(); $(`#${button.dataset.openModal}`).showModal(); }));

['agendaSearch', 'agendaClass', 'agendaStatus', 'agendaPeriod'].forEach(id => $(`#${id}`).addEventListener(id === 'agendaSearch' ? 'input' : 'change', renderAgendas));
$('#otherMaterialCheck').addEventListener('change', event => $('#otherMaterial').classList.toggle('hidden', !event.target.checked));
$('#submitAgenda').addEventListener('click', async event => {
  event.preventDefault(); const form = $('#agendaForm'); if (!form.reportValidity()) return; const formData = new FormData(form); const materials = formData.getAll('material').map(item => item === 'Outro' && $('#otherMaterial').value ? `Outro: ${$('#otherMaterial').value}` : item);
  try {
    await api('/api/agendas', { method: 'POST', body: JSON.stringify({ date: formData.get('date'), classId: Number(formData.get('classId')), subject: formData.get('subject'), status: formData.get('status'), content: formData.get('content'), activity: formData.get('activity'), materials, notes: formData.get('notes') }) });
    form.reset(); $('#agendaDate').value = todayIso(); $('#agendaModal').close(); await Promise.all([loadAgendas(), loadSummary()]); toast('Agenda registrada', 'O registro já está disponível para todos os usuários.'); showPage('agendas');
  } catch (error) { toast('Não foi possível salvar', error.message); }
});

$('#newClassBtn').addEventListener('click', () => { $('#classForm').reset(); $('#classYear').value = Number(todayIso().slice(0, 4)); $('#classFormError').classList.add('hidden'); $('#classModal').showModal(); });
$('#classForm').addEventListener('submit', async event => {
  event.preventDefault(); const errorBox = $('#classFormError'); errorBox.classList.add('hidden');
  try { await api('/api/classes', { method: 'POST', body: JSON.stringify({ name: $('#className').value, gradeLevel: $('#classGrade').value, shift: $('#classShift').value, schoolYear: Number($('#classYear').value), teacherName: $('#classTeacher').value }) }); $('#classModal').close(); await Promise.all([loadClasses(), loadSummary()]); toast('Turma criada', 'A turma já está disponível para toda a equipe.'); }
  catch (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
});

function openStudentModal(classId = '') {
  if (!classes.some(item => item.status === 'active')) { toast('Crie uma turma primeiro', 'O aluno precisa ser vinculado a uma turma ativa.'); return; }
  $('#studentForm').reset(); populateClassSelects(); $('#studentClass').value = String(classId || ''); $('#studentFormError').classList.add('hidden'); $('#studentModal').showModal();
}

$('#newStudentBtn').addEventListener('click', () => openStudentModal($('#studentClassFilter').value));
$('#classCards').addEventListener('click', event => { const button = event.target.closest('[data-add-student-class]'); if (button) openStudentModal(button.dataset.addStudentClass); });
$('#studentForm').addEventListener('submit', async event => {
  event.preventDefault(); const errorBox = $('#studentFormError'); errorBox.classList.add('hidden');
  try { await api('/api/students', { method: 'POST', body: JSON.stringify({ registration: $('#studentRegistration').value, name: $('#studentName').value, birthDate: $('#studentBirthDate').value, classId: Number($('#studentClass').value), guardianName: $('#studentGuardian').value, guardianPhone: $('#studentPhone').value }) }); $('#studentModal').close(); await Promise.all([loadClasses(), loadStudents($('#studentClassFilter').value), loadSummary()]); toast('Aluno matriculado', 'O aluno já aparece na frequência da turma.'); }
  catch (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
});

$('#studentClassFilter').addEventListener('change', event => loadStudents(event.target.value));
$('#attendanceClass').addEventListener('change', () => loadAttendance());
$('#attendanceDate').addEventListener('change', () => loadAttendance());
$('#studentList').addEventListener('click', event => { const button = event.target.closest('[data-status]'); if (!button) return; const studentId = Number(button.parentElement.dataset.student); const record = attendance.find(item => Number(item.student_id) === studentId); if (!record) return; record.status = button.dataset.status; attendanceDirty = true; renderAttendance(); });
$$('[data-bulk]').forEach(button => button.addEventListener('click', () => { attendance.forEach(item => item.status = button.dataset.bulk); attendanceDirty = true; renderAttendance(); }));
$('#saveAttendance').addEventListener('click', async () => {
  const classId = Number($('#attendanceClass').value); const date = $('#attendanceDate').value;
  if (!classId || !date) { toast('Selecione a turma', 'Informe a data e a turma antes de salvar.'); return; }
  try { await api('/api/attendance', { method: 'POST', body: JSON.stringify({ date, classId, records: attendance.map(item => ({ studentId: item.student_id, status: item.status, notes: item.notes || '' })) }) }); attendanceDirty = false; toast('Frequência salva', `${attendance.length} registros foram sincronizados para toda a equipe.`); }
  catch (error) { toast('Não foi possível salvar', error.message); }
});

$('#exportBtn').addEventListener('click', () => toast('Relatório preparado', 'A demonstração simulou a exportação do relatório.'));
$('#globalSearch').addEventListener('keydown', event => { if (event.key === 'Enter') { showPage('agendas'); $('#agendaSearch').value = event.target.value; renderAgendas(); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); } });

$('#newUserBtn').addEventListener('click', () => openUserModal());
$('#userCards').addEventListener('click', event => { const button = event.target.closest('[data-edit-user]'); if (!button) return; const user = managedUsers.find(item => item.id === Number(button.dataset.editUser)); if (user) openUserModal(user); });
$('#userForm').addEventListener('submit', async event => {
  event.preventDefault(); const id = $('#userId').value; const payload = { name: $('#userFullName').value, username: $('#userLogin').value, role: $('#userRole').value, status: $('#userStatus').value, password: $('#userPassword').value }; const errorBox = $('#userFormError'); errorBox.classList.add('hidden');
  try { await api(id ? `/api/users/${id}` : '/api/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); $('#userModal').close(); await loadUsers(); toast(id ? 'Usuário atualizado' : 'Usuário criado', 'As alterações foram salvas no banco de dados.'); }
  catch (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
});
$('#deleteUserBtn').addEventListener('click', async () => {
  const id = $('#userId').value; const user = managedUsers.find(item => item.id === Number(id)); if (!id || !user || !confirm(`Remover o acesso de ${user.name}?`)) return;
  try { await api(`/api/users/${id}`, { method: 'DELETE' }); $('#userModal').close(); await loadUsers(); toast('Usuário removido', 'O acesso foi excluído do banco de dados.'); }
  catch (error) { $('#userFormError').textContent = error.message; $('#userFormError').classList.remove('hidden'); }
});

setInterval(async () => {
  if (!currentUser) return;
  await Promise.all([loadSummary(), loadClasses(true)]);
  if ($('#page-agendas').classList.contains('active') || $('#page-dashboard').classList.contains('active')) await loadAgendas(true);
  if ($('#page-turmas').classList.contains('active')) await loadStudents($('#studentClassFilter').value, true);
  if ($('#page-frequencia').classList.contains('active') && !attendanceDirty) await loadAttendance(true);
}, 5000);

(async () => { try { const data = await api('/api/session'); if (data.user) await openApp(data.user); } catch {} })();
