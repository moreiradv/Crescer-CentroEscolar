const normalizeHelpText=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function helpAudienceAllowed(audience='all'){
  return audience.split(/\s+/).some(item=>({all:true,pedagogical:pedagogical(),manager:manager(),admin:administrator(),enrollment:enrollmentAccess(),teacher:isTeacher(),library:libraryAccess()}[item]));
}

function applyHelpProfile(){
  if(!currentUser)return;
  $('#helpProfileLabel').textContent=`Orientações para ${roleLabel(currentUser.role)}`;
  $$('[data-help-audience]').forEach(element=>element.classList.toggle('hidden',!helpAudienceAllowed(element.dataset.helpAudience)));
  filterHelp();
}

function filterHelp(){
  const input=$('#helpSearch');if(!input)return;
  const query=normalizeHelpText(input.value.trim());
  const searchable=$$('#helpGuides > [data-help-search], #helpFaq > [data-help-search]');
  let visible=0;
  searchable.forEach(element=>{
    if(!helpAudienceAllowed(element.dataset.helpAudience))return element.classList.add('help-search-hidden');
    const haystack=normalizeHelpText(`${element.dataset.helpSearch} ${element.textContent}`);
    const match=!query||query.split(/\s+/).every(term=>haystack.includes(term));
    element.classList.toggle('help-search-hidden',!match);
    if(match){visible++;if(query)element.open=true}
  });
  const guideCount=$$('#helpGuides > [data-help-search]:not(.hidden):not(.help-search-hidden)').length;
  $('#helpEmpty').classList.toggle('hidden',guideCount>0);
  $('#helpResultSummary').textContent=query?`${visible} ${visible===1?'orientação encontrada':'orientações encontradas'} para “${input.value.trim()}”.`:'Conteúdo ajustado automaticamente às permissões do seu perfil.';
}

function openHelp(topic=''){
  showPage('ajuda');
  applyHelpProfile();
  $('#helpSearch').value=topic;
  filterHelp();
  if(topic)$('#helpSearch').focus();
}

$('#openHelpCenter').onclick=()=>openHelp();
$('#openHelpTop').onclick=()=>openHelp();
$$('[data-help-topic]').forEach(button=>button.onclick=()=>openHelp(button.dataset.helpTopic));
$('#helpSearch').addEventListener('input',filterHelp);
