let progressionData={rules:[],candidates:[]};

async function loadProgressions(silent=false){
  if(!administrator())return;
  try{progressionData=await api('/api/progressions');$('#progressionPanel')?.classList.remove('hidden');renderProgressions();renderProgressionRules()}catch(error){if(!silent)toast('Erro nas progressões',error.message)}
}

function renderProgressions(){
  const list=$('#progressionList');if(!list)return;
  list.innerHTML=progressionData.candidates.length?progressionData.candidates.map(candidate=>{
    const options=candidate.destinations.map(klass=>`<option value="${klass.id}" ${Number(klass.id)===Number(candidate.suggestedClassId)?'selected':''}>${esc(klass.name)} • ${esc(klass.shift)} • ${klass.school_year}</option>`).join('');
    return`<article class="progression-card" data-progression-student="${candidate.id}"><span class="avatar">${initials(candidate.name)}</span><div><strong>${esc(candidate.name)}</strong><small>${esc(candidate.registration)} • ${esc(candidate.class_name)} — ${candidate.school_year}</small><p>Progressão sugerida: <b>${esc(candidate.targetGrade)} — ${candidate.targetYear}</b></p></div>${options?`<select aria-label="Turma de destino"><option value="">Selecione a turma</option>${options}</select><button class="primary-btn" data-confirm-progression="${candidate.id}">Confirmar e preparar matrícula</button>`:`<em>Crie uma turma de ${esc(candidate.targetGrade)} para ${candidate.targetYear}.</em>`}</article>`
  }).join(''):'<p class="empty-state">Nenhuma progressão pendente. Alunos já vinculados ao próximo ano não aparecem novamente.</p>';
}

function renderProgressionRules(){
  const list=$('#progressionRuleList');if(!list)return;
  list.innerHTML=progressionData.rules.map(rule=>`<button type="button" data-edit-progression-rule="${rule.id}"><span><strong>${esc(rule.from_grade)} → ${esc(rule.to_grade)}</strong><small>Progressão anual configurada</small></span><em class="${rule.status==='active'?'status-active':'status-inactive'}">${rule.status==='active'?'Ativa':'Inativa'}</em></button>`).join('')||'<p class="empty-state">Nenhuma regra configurada.</p>';
}

async function confirmProgressionCandidate(studentId){
  const card=$(`[data-progression-student="${studentId}"]`),classId=Number($('select',card)?.value);const candidate=progressionData.candidates.find(item=>Number(item.id)===Number(studentId));
  if(!classId)return toast('Escolha a turma','Selecione a turma do próximo ano letivo.');
  if(!confirm(`Confirmar ${candidate.name} na turma selecionada? O histórico de ${candidate.school_year} será preservado e uma matrícula em rascunho será preparada.`))return;
  const button=$('[data-confirm-progression]',card);button.disabled=true;button.textContent='Confirmando...';
  try{const result=await api('/api/progressions/confirm',{method:'POST',body:JSON.stringify({studentId:Number(studentId),classId,resultStatus:'completed'})});await Promise.all([loadProgressions(),loadClasses(),loadStudents($('#studentClassFilter').value),typeof loadEnrollments==='function'?loadEnrollments(true):Promise.resolve()]);toast('Progressão confirmada',result.enrollmentPrepared?'Vínculo anual criado e matrícula do novo ano preparada em rascunho.':'Vínculo anual criado; a matrícula existente foi preservada.')}catch(error){toast('Não foi possível confirmar',error.message)}finally{button.disabled=false;button.textContent='Confirmar e preparar matrícula'}
}

function clearProgressionRuleForm(){$('#progressionRuleForm').reset();$('#progressionRuleId').value='';$('#progressionRuleStatus').value='active';$('#progressionRuleError').classList.add('hidden')}
function editProgressionRule(id){const rule=progressionData.rules.find(item=>Number(item.id)===Number(id));if(!rule)return;$('#progressionRuleId').value=rule.id;$('#progressionFromGrade').value=rule.from_grade;$('#progressionToGrade').value=rule.to_grade;$('#progressionRuleStatus').value=rule.status}

$('#progressionList').onclick=event=>{const button=event.target.closest('[data-confirm-progression]');if(button)confirmProgressionCandidate(button.dataset.confirmProgression)};
$('#openProgressionRules').onclick=async()=>{await loadProgressions();$('#progressionRulesModal').showModal()};
$('#closeProgressionRules').onclick=()=>$('#progressionRulesModal').close();
$('#clearProgressionRule').onclick=clearProgressionRuleForm;
$('#progressionRuleList').onclick=event=>{const button=event.target.closest('[data-edit-progression-rule]');if(button)editProgressionRule(button.dataset.editProgressionRule)};
$('#progressionRuleForm').onsubmit=async event=>{event.preventDefault();const id=$('#progressionRuleId').value,box=$('#progressionRuleError');box.classList.add('hidden');try{await api(id?`/api/progression-rules/${id}`:'/api/progression-rules',{method:id?'PUT':'POST',body:JSON.stringify({fromGrade:$('#progressionFromGrade').value,toGrade:$('#progressionToGrade').value,status:$('#progressionRuleStatus').value})});clearProgressionRuleForm();await loadProgressions();toast('Regra salva','As próximas progressões usarão esta correspondência.')}catch(error){box.textContent=error.message;box.classList.remove('hidden')}};

const showPageBeforeProgressions=showPage;
showPage=name=>{const result=showPageBeforeProgressions(name);if(name==='turmas'&&administrator())loadProgressions(true);return result};
