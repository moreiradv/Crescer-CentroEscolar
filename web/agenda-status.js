let agendaDailyStatuses=[];

function agendaStatusLabel(status){return status==='with_agenda'?'Com agenda':status==='no_agenda'?'Não tem agenda':'Sem registro'}
function renderAgendaDailyStatus(){
  const grid=$('#agendaStatusGrid');if(!grid)return;
  grid.innerHTML=agendaDailyStatuses.map(item=>{const updated=item.last_updated_at?new Date(item.last_updated_at).toLocaleString('pt-BR'):'Nenhum lançamento realizado';const detail=item.status==='no_record'?'Aguardando informação':`${item.record_count} ${item.record_count===1?'registro':'registros'} • ${esc(item.recorded_by_names||'Usuário')} • ${updated}`;return`<article class="agenda-status-card ${item.status}"><span>${item.status==='with_agenda'?'✓':item.status==='no_agenda'?'—':'○'}</span><div><strong>${esc(item.name)}</strong><small>${item.school_year} • ${esc(item.shift)}</small><p>${esc(detail)}</p></div><b>${agendaStatusLabel(item.status)}</b></article>`}).join('')||'<p class="empty-state">Nenhuma turma ativa encontrada.</p>';
}
async function loadAgendaDailyStatus(silent=false){
  if(!pedagogical())return;const date=$('#agendaStatusDate').value||todayIso();$('#agendaStatusDate').value=date;
  try{const data=await api(`/api/agenda-status?date=${encodeURIComponent(date)}`);agendaDailyStatuses=data.statuses;$('#agendaDayStatus').classList.remove('hidden');renderAgendaDailyStatus()}catch(error){if(!silent)toast('Erro ao consultar situação diária',error.message)}
}

$('#agendaStatusDate').value=todayIso();
$('#agendaStatusDate').onchange=()=>loadAgendaDailyStatus();
const loadAgendasBeforeDailyStatus=loadAgendas;
loadAgendas=async(...args)=>{const result=await loadAgendasBeforeDailyStatus(...args);if($('#page-agendas').classList.contains('active'))await loadAgendaDailyStatus(true);return result};
const showPageBeforeAgendaStatus=showPage;
showPage=name=>{const result=showPageBeforeAgendaStatus(name);if(name==='agendas')loadAgendaDailyStatus(true);return result};
