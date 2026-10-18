const initialAgendas = [
  {date:'10/10/2026',iso:'2026-10-10',class:'2º Ano A',subject:'Língua Portuguesa',content:'Leitura e interpretação de texto',activity:'Leitura coletiva e resolução de questões.',materials:['Livro','Impressão'],status:'Concluída',user:'Ana Silva',time:'07:56'},
  {date:'10/10/2026',iso:'2026-10-10',class:'4º Ano B',subject:'Matemática',content:'Frações equivalentes',activity:'Exercícios práticos em duplas.',materials:['Livro','Atividade lúdica'],status:'Iniciada',user:'Paulo Mendes',time:'07:42'},
  {date:'09/10/2026',iso:'2026-10-09',class:'3º Ano A',subject:'Ciências',content:'O ciclo da água',activity:'Experimento e registro no caderno.',materials:['Impressão','Outro: materiais recicláveis'],status:'Concluída',user:'Carlos Lima',time:'14:18'},
  {date:'09/10/2026',iso:'2026-10-09',class:'5º Ano A',subject:'História',content:'Povos originários do Brasil',activity:'Roda de conversa e mapa mental.',materials:['Livro','Impressão'],status:'Concluída',user:'Beatriz Alves',time:'13:05'},
  {date:'08/10/2026',iso:'2026-10-08',class:'2º Ano A',subject:'Matemática',content:'Adição com reagrupamento',activity:'Resolução coletiva.',materials:['Livro'],status:'Continuar posteriormente',user:'Ana Silva',time:'10:22'},
  {date:'08/10/2026',iso:'2026-10-08',class:'4º Ano B',subject:'Geografia',content:'Regiões brasileiras',activity:'Construção de mapa ilustrado.',materials:['Impressão'],status:'Pendente',user:'Juliana Prado',time:'09:40'},
  {date:'07/10/2026',iso:'2026-10-07',class:'3º Ano A',subject:'Artes',content:'Cores primárias e secundárias',activity:'Pintura guiada.',materials:['Atividade lúdica'],status:'Concluída',user:'Carlos Lima',time:'15:10'},
  {date:'07/10/2026',iso:'2026-10-07',class:'5º Ano A',subject:'Língua Portuguesa',content:'Produção textual',activity:'Escrita de crônica curta.',materials:['Livro','Impressão'],status:'Concluída',user:'Beatriz Alves',time:'11:35'}
];

let agendas = JSON.parse(localStorage.getItem('crescerAgendas') || 'null') || initialAgendas;
const students = ['Ana Clara Mendes','Arthur Oliveira','Beatriz Costa','Bernardo Lima','Caio Henrique','Cecília Alves','Davi Moreira','Elisa Rocha','Enzo Martins','Gabriela Sousa','Guilherme Silva','Helena Prado','João Santos','Laura Fernandes','Lucas Ribeiro','Manuela Gomes','Maria Eduarda','Miguel Araújo','Pedro Augusto','Rafaela Nunes','Samuel Reis','Sofia Carvalho'];
let attendance = ['absent','present','present','present','present','present','present','present','present','present','late','present','absent','present','present','present','present','present','justified','present','present','present'];

let currentUser = null;
let managedUsers = [];

const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];

async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',headers:{'content-type':'application/json',...(options.headers||{})},...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível concluir a operação.');
  return data;
}

function applyCurrentUser(user){
  currentUser=user;
  $$('[data-user-name]').forEach(el=>el.textContent=user.name);
  $$('[data-user-role]').forEach(el=>el.textContent=user.role);
  $$('[data-user-initials]').forEach(el=>el.textContent=user.initials);
  $('#welcomeName').textContent=user.name.split(' ')[0];
  $('#traceUser').textContent=user.name;
  $$('[data-admin-only]').forEach(el=>el.classList.toggle('hidden',user.role!=='Administrador'));
}

function openApp(user){
  applyCurrentUser(user);
  $('#loginError').classList.add('hidden');
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  showPage('dashboard');
  renderRecent();renderAgendas();renderStudents();
}

function initialsFor(name){return name.split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase()}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}

async function loadUsers(){
  if(currentUser?.role!=='Administrador')return;
  const container=$('#userCards');
  container.innerHTML='<p class="loading-state">Carregando usuários...</p>';
  try{
    const data=await api('/api/users');managedUsers=data.users;
    container.innerHTML=managedUsers.map((user,index)=>`<article><span class="avatar ${['peach','mint','lilac',''][index%4]}">${escapeHtml(user.initials||initialsFor(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><p>${escapeHtml(user.role)}</p><small>Usuário: ${escapeHtml(user.username)}</small></div><span class="${user.status==='active'?'status-active':'status-inactive'}">${user.status==='active'?'Ativo':'Inativo'}</span><button type="button" data-edit-user="${user.id}" aria-label="Editar ${escapeHtml(user.name)}">•••</button></article>`).join('')||'<p class="loading-state">Nenhum usuário cadastrado.</p>';
  }catch(error){container.innerHTML=`<p class="loading-state">${error.message}</p>`}
}

function openUserModal(user=null){
  $('#userForm').reset();$('#userFormError').classList.add('hidden');$('#userFormError').textContent='';
  $('#userId').value=user?.id||'';$('#userFullName').value=user?.name||'';$('#userLogin').value=user?.username||'';$('#userRole').value=user?.role||'Coordenação';$('#userStatus').value=user?.status||'active';
  $('#userModalLabel').textContent=user?'Editar acesso':'Novo acesso';$('#userModalTitle').textContent=user?'Editar usuário':'Adicionar usuário';
  $('#passwordHint').textContent=user?'Deixe em branco para manter a senha atual.':'Obrigatória para novos usuários.';$('#userPassword').required=!user;
  $('#deleteUserBtn').classList.toggle('hidden',!user);$('#userModal').showModal();
}

function showPage(name){
  $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${name}`));
  $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===name));
  $('#sidebar').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='usuarios')loadUsers();
}

function statusClass(status){return status==='Concluída'?'done':'pending'}
function renderRecent(){
  $('#recentAgendaList').innerHTML=agendas.slice(0,4).map(a=>`<div class="timeline-item"><span class="timeline-dot"></span><p><strong>${a.content}</strong><small>${a.class} • ${a.subject} • ${a.user}</small><span class="status-pill ${statusClass(a.status)}">${a.status}</span></p><span>${a.time}</span></div>`).join('');
}
function renderAgendas(){
  const q=$('#agendaSearch').value.toLowerCase(); const cls=$('#agendaClass').value; const st=$('#agendaStatus').value;
  const list=agendas.filter(a=>(!q||Object.values(a).flat().join(' ').toLowerCase().includes(q))&&(!cls||a.class===cls)&&(!st||a.status===st));
  $('#agendaCount').textContent=list.length;
  $('#agendaTable').innerHTML=list.map(a=>`<tr><td>${a.date}<br><small>${a.time}</small></td><td><strong>${a.class}</strong></td><td>${a.subject}</td><td><strong>${a.content}</strong><br><small>${a.materials.join(' • ')}</small></td><td><span class="status-pill ${statusClass(a.status)}">${a.status}</span></td><td>${a.user}</td><td><button class="row-action" title="Ver detalhes">•••</button></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:40px">Nenhuma agenda encontrada com esses filtros.</td></tr>';
}
function renderStudents(){
  $('#studentList').innerHTML=students.map((name,i)=>`<div class="student-row"><span class="avatar ${['','peach','mint','lilac'][i%4]}">${name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><div><strong>${name}</strong><small>Matrícula #${2026100+i}</small></div><div class="status-options" data-student="${i}"><button data-status="present">● Presente</button><button data-status="late">● Atrasado</button><button data-status="justified">● Justificado</button><button data-status="absent">● Não presente</button></div></div>`).join('');
  attendance.forEach((status,i)=>$(`.status-options[data-student="${i}"] [data-status="${status}"]`)?.classList.add('selected'));
  updateSummary();
}
function updateSummary(){
  const counts={present:0,late:0,justified:0,absent:0};attendance.forEach(s=>counts[s]++);
  $('#sumPresent').textContent=counts.present;$('#sumLate').textContent=counts.late;$('#sumJustified').textContent=counts.justified;$('#sumAbsent').textContent=counts.absent;
  const pct=((counts.present+counts.late*.5)/attendance.length*100).toFixed(1).replace('.',',')+'%';$('#sumPercent').textContent=pct;$('#sumBar').style.width=pct.replace(',','.');
}
function toast(title='Registro salvo',message='As informações foram atualizadas.'){$('#toast strong').textContent=title;$('#toast p').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2800)}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.submitter;button.disabled=true;button.textContent='Entrando...';
  try{
    const data=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});
    openApp(data.user);$('#loginForm').reset();
  }catch(error){$('#loginError').textContent=error.message;$('#loginError').classList.remove('hidden');$('#password').select()}
  finally{button.disabled=false;button.innerHTML='Entrar no painel <span>→</span>'}
});
$('#togglePassword').addEventListener('click',()=>{const p=$('#password');p.type=p.type==='password'?'text':'password';$('#togglePassword').textContent=p.type==='password'?'ver':'ocultar'});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'})}catch{}currentUser=null;$('#appShell').classList.add('hidden');$('#loginScreen').classList.remove('hidden');$('#loginForm').reset();$('#loginError').classList.add('hidden')});
$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));
$$('[data-page-link]').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.pageLink)));
$$('[data-open-modal]').forEach(btn=>btn.addEventListener('click',()=>$('#'+btn.dataset.openModal).showModal()));
['agendaSearch','agendaClass','agendaStatus'].forEach(id=>$('#'+id).addEventListener(id==='agendaSearch'?'input':'change',renderAgendas));
$('#otherMaterialCheck').addEventListener('change',e=>$('#otherMaterial').classList.toggle('hidden',!e.target.checked));
$('#submitAgenda').addEventListener('click',e=>{
  e.preventDefault();const form=$('#agendaForm');if(!form.reportValidity())return;const fd=new FormData(form);const iso=fd.get('date');const materials=fd.getAll('material').map(m=>m==='Outro'&&$('#otherMaterial').value?`Outro: ${$('#otherMaterial').value}`:m);
  agendas.unshift({date:iso.split('-').reverse().join('/'),iso,class:fd.get('class'),subject:fd.get('subject'),content:fd.get('content'),activity:fd.get('activity'),materials,status:fd.get('status'),user:currentUser?.name||'Usuário autorizado',time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});
  localStorage.setItem('crescerAgendas',JSON.stringify(agendas));renderAgendas();renderRecent();$('#agendaModal').close();form.reset();toast('Agenda registrada','O novo registro já aparece no histórico.');showPage('agendas');
});
$('#studentList').addEventListener('click',e=>{const b=e.target.closest('[data-status]');if(!b)return;const group=b.parentElement;attendance[+group.dataset.student]=b.dataset.status;$$('button',group).forEach(x=>x.classList.toggle('selected',x===b));updateSummary()});
$$('[data-bulk]').forEach(b=>b.addEventListener('click',()=>{attendance=attendance.map(()=>b.dataset.bulk);renderStudents()}));
$('#saveAttendance').addEventListener('click',()=>toast('Frequência salva',`22 registros vinculados a ${currentUser?.name||'usuário autorizado'}.`));
$('#exportBtn').addEventListener('click',()=>toast('Relatório preparado','A demonstração simulou a exportação do relatório.'));
$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){showPage('agendas');$('#agendaSearch').value=e.target.value;renderAgendas()}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#globalSearch').focus()}});

$('#newUserBtn').addEventListener('click',()=>openUserModal());
$('#userCards').addEventListener('click',e=>{const button=e.target.closest('[data-edit-user]');if(!button)return;const user=managedUsers.find(item=>item.id===Number(button.dataset.editUser));if(user)openUserModal(user)});
$('#userForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=$('#userId').value;
  const payload={name:$('#userFullName').value,username:$('#userLogin').value,role:$('#userRole').value,status:$('#userStatus').value,password:$('#userPassword').value};
  const errorBox=$('#userFormError');errorBox.classList.add('hidden');
  try{
    await api(id?`/api/users/${id}`:'/api/users',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
    $('#userModal').close();await loadUsers();toast(id?'Usuário atualizado':'Usuário criado','As alterações foram salvas no banco de dados.');
  }catch(error){errorBox.textContent=error.message;errorBox.classList.remove('hidden')}
});
$('#deleteUserBtn').addEventListener('click',async()=>{
  const id=$('#userId').value;const user=managedUsers.find(item=>item.id===Number(id));if(!id||!user)return;
  if(!confirm(`Remover o acesso de ${user.name}?`))return;
  try{await api(`/api/users/${id}`,{method:'DELETE'});$('#userModal').close();await loadUsers();toast('Usuário removido','O acesso foi excluído do banco de dados.')}catch(error){$('#userFormError').textContent=error.message;$('#userFormError').classList.remove('hidden')}
});

renderRecent();renderAgendas();renderStudents();
(async()=>{try{const data=await api('/api/session',{headers:{}});if(data.user)openApp(data.user)}catch{}})();
