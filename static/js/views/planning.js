// ── planning.js — Module Planning : semaine d'entraînement, drag & drop, sync Garmin ──

// ══════════════════════════════════════════
// PLANNING — TRAINING WEEK
// ══════════════════════════════════════════
let trainingPlan = [];
let _openedSession = null;
let _todaySession  = null;

async function loadTrainingPlan(){
  try{
    const r = await fetch('/api/training');
    const j = await r.json();
    if(j.ok && j.sessions?.length){
      trainingPlan = j.sessions;
      renderTodayWidget();
      if(curView==='planning') renderWeekPlan();
      const lbl = document.getElementById('planWeekLabel');
      if(lbl) lbl.textContent = j.week_label || '';
    }
  }catch(e){}
}

function getTodaySession(){
  const now = new Date();
  return trainingPlan.find(s => s.day_num===now.getDate() && s.month===now.getMonth()+1) || null;
}

// Convertit le texte brut en HTML stylisé (comme les photos)
function formatSessionHtml(content){
  const lines = content.split('\n');
  let html = '';
  let inBlock = false;
  for(const raw of lines){
    const line = raw.trim();
    if(!line){
      if(inBlock){ html+='</ul>'; inBlock=false; }
      html+='<div style="height:8px"></div>';
      continue;
    }
    // Section headers = lignes avec emoji en début
    if(/^[🏋️🔥⚡🧘🏃🎯⚠️👉🥤🟣🟢🔴🟡⚪🟠]/.test(line)){
      if(inBlock){ html+='</ul>'; inBlock=false; }
      html+=`<div style="font-size:15px;font-weight:700;margin:14px 0 6px;display:flex;align-items:center;gap:6px">${line}</div>`;
      continue;
    }
    // Séparateurs texte (Repos :, Retour au calme, etc.)
    if(/^(Repos|Retour|Bloc|Objectif|Intensité|Priorité)/i.test(line)){
      if(inBlock){ html+='</ul>'; inBlock=false; }
      html+=`<div style="font-size:13px;font-weight:600;color:#9CA3AF;margin-top:10px">${line}</div>`;
      continue;
    }
    // Items de liste
    if(!inBlock){ html+='<ul style="margin:4px 0 4px 18px;list-style:disc">'; inBlock=true; }
    html+=`<li style="font-size:14px;line-height:1.7">${line}</li>`;
  }
  if(inBlock) html+='</ul>';
  return html;
}

function renderTodayWidget(){
  const wrap = document.getElementById('todayTrainingWidget');
  if(!wrap) return;
  _todaySession = getTodaySession();
  if(!_todaySession){ wrap.innerHTML=''; return; }
  const s = _todaySession;

  // Aperçu : 5 premières lignes non vides
  const previewLines = s.content.split('\n').filter(l=>l.trim()).slice(0,5);
  const previewHtml = previewLines.map(l=>{
    const t = l.trim();
    if(/^[🏋️🔥⚡🧘🏃🎯⚠️👉🥤]/.test(t))
      return `<div style="font-weight:700;margin-top:6px">${t}</div>`;
    return `<div style="font-size:13px;color:var(--text2);padding-left:8px">${t}</div>`;
  }).join('');

  wrap.innerHTML=`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:8px">
      🏋️ Entraînement du jour
    </div>
    <div class="today-training-card" style="border-left-color:${s.color}">
      <div class="tcard-header">
        <div>
          <div class="tcard-title">${s.title}</div>
          <div class="tcard-sub">${s.day_name} ${s.day_num}</div>
        </div>
        <div class="tcard-badge" style="background:${s.color}20;color:${s.color}">Aujourd'hui</div>
      </div>
      <div id="todayPreview" class="tcard-body" style="margin-top:8px">${previewHtml}</div>
      <div id="todayFull" style="display:none;margin-top:8px">${formatSessionHtml(s.content)}</div>
      <button class="tcard-expand" id="todayExpandBtn" onclick="toggleTodayExpand()">
        Voir la séance complète ↓
      </button>
    </div>`;
}

function toggleTodayExpand(){
  const preview = document.getElementById('todayPreview');
  const full    = document.getElementById('todayFull');
  const btn     = document.getElementById('todayExpandBtn');
  const expanded = full.style.display !== 'none';
  preview.style.display = expanded ? '' : 'none';
  full.style.display    = expanded ? 'none' : '';
  btn.textContent       = expanded ? 'Voir la séance complète ↓' : 'Réduire ↑';
}

let _selectedPlanIdx = -1;
let _draggedSessionIdx = -1;   // index dans trainingPlan de la session en cours de drag

// ── Génère les jours à afficher : couvre TOUTES les sessions du plan
// Si aucun plan : 7 jours à partir d'aujourd'hui
function get7Days(){
  const DAY_FR=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const today = new Date();
  today.setHours(0,0,0,0);

  let startDate = new Date(today);
  let endDate   = new Date(today);
  endDate.setDate(today.getDate() + 6); // minimum 7 jours

  // Si un plan est chargé, étendre la fenêtre pour couvrir toutes les sessions
  if(trainingPlan.length){
    const yr = today.getFullYear();
    trainingPlan.forEach(s=>{
      // Gestion simple : même année courante (ajustement si plan chevauche déc/jan)
      const yr2 = (s.month < today.getMonth()+1-6) ? yr+1 : yr;
      const d = new Date(yr2, s.month-1, s.day_num);
      if(d < startDate) startDate = new Date(d);
      if(d > endDate)   endDate   = new Date(d);
    });
  }

  const days=[];
  const cur = new Date(startDate);
  while(cur <= endDate){
    const isToday = cur.getDate()===today.getDate() && cur.getMonth()===today.getMonth() && cur.getFullYear()===today.getFullYear();
    days.push({
      dayName: DAY_FR[cur.getDay()],
      dayNum:  cur.getDate(),
      month:   cur.getMonth()+1,
      isToday,
      date:    new Date(cur),
    });
    cur.setDate(cur.getDate()+1);
  }
  return days;
}

// ── Trouve la session du plan assignée à un jour donné
function getSessionIdxForDay(dayNum, month){
  return trainingPlan.findIndex(s=>s.day_num===dayNum && s.month===month);
}

// ── Drag & Drop handlers
function onSessionDragStart(e, idx){
  _draggedSessionIdx=idx;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain', String(idx));
  setTimeout(()=>{ const el=document.querySelector('.plan-session-btn[data-idx="'+idx+'"]'); if(el)el.classList.add('dragging'); },0);
}
function onSessionDragEnd(e){
  document.querySelectorAll('.plan-session-btn.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.plan-day-slot.drag-over').forEach(el=>el.classList.remove('drag-over'));
}
function onDayDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  const slot=e.currentTarget;
  if(!slot.classList.contains('drag-over')) slot.classList.add('drag-over');
}
function onDayDragLeave(e){
  e.currentTarget.classList.remove('drag-over');
}
function onDayDrop(e, dayNum, month, dayName){
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if(_draggedSessionIdx<0) return;

  const draggedSession = trainingPlan[_draggedSessionIdx];
  if(!draggedSession) return;

  // Y a-t-il déjà une session sur le jour cible ?
  const targetIdx = getSessionIdxForDay(dayNum, month);
  if(targetIdx>=0 && targetIdx!==_draggedSessionIdx){
    // Échange : la session cible prend le jour source
    const targetSession = trainingPlan[targetIdx];
    targetSession.day_num  = draggedSession.day_num;
    targetSession.month    = draggedSession.month;
    targetSession.day_name = draggedSession.day_name;
  }

  // Assigner le jour cible à la session déplacée
  draggedSession.day_num  = dayNum;
  draggedSession.month    = month;
  draggedSession.day_name = dayName;

  _draggedSessionIdx = -1;

  renderWeekPlan();
  // Sélectionner la session déplacée dans le détail
  const newIdx = trainingPlan.indexOf(draggedSession);
  if(newIdx>=0) selectPlanDay(newIdx);

  // Persister sur le serveur
  fetch('/api/update-training-order',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({sessions: trainingPlan})
  }).catch(()=>{});
}

function renderWeekPlan(){
  const listPanel   = document.getElementById('planListPanel');
  const detailPanel = document.getElementById('planDetailPanel');
  if(!listPanel) return;

  if(!trainingPlan.length){
    listPanel.innerHTML=`<div class="no-plan"><p style="font-size:13px">Chargez un plan pour commencer</p></div>`;
    if(detailPanel) detailPanel.innerHTML=`<div class="no-plan">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <p style="font-size:14px;font-weight:600;margin-bottom:6px">Sélectionnez une séance</p>
    </div>`;
    return;
  }

  const days7 = get7Days();

  listPanel.innerHTML = days7.map((day)=>{
    const sessionIdx = getSessionIdxForDay(day.dayNum, day.month);
    const session    = sessionIdx>=0 ? trainingPlan[sessionIdx] : null;
    return`<div class="plan-day-slot${day.isToday?' today-slot':''}"
        ondragover="onDayDragOver(event)"
        ondragleave="onDayDragLeave(event)"
        ondrop="onDayDrop(event,${day.dayNum},${day.month},'${day.dayName}')">
      <div class="plan-slot-date">
        <span class="plan-slot-dayname">${day.dayName} ${day.dayNum}</span>
        ${day.isToday?'<span class="plan-slot-today-pill">Aujourd\'hui</span>':''}
      </div>
      ${session
        ?`<div class="plan-session-btn${day.isToday?' is-today':''}${sessionIdx===_selectedPlanIdx?' selected':''}"
            data-idx="${sessionIdx}"
            style="border-left-color:${session.color};background:${session.color}18"
            draggable="true"
            ondragstart="onSessionDragStart(event,${sessionIdx})"
            ondragend="onSessionDragEnd(event)"
            onclick="selectPlanDay(${sessionIdx})">${session.title}</div>`
        :`<div class="plan-empty-slot"
            ondragover="onDayDragOver(event)"
            ondragleave="onDayDragLeave(event)"
            ondrop="onDayDrop(event,${day.dayNum},${day.month},'${day.dayName}')">Repos · glisser ici</div>`
      }
    </div>`;
  }).join('');

  // Sélectionner aujourd'hui si une session existe, sinon la première
  const today=new Date();
  let defaultIdx=trainingPlan.findIndex(s=>s.day_num===today.getDate()&&s.month===today.getMonth()+1);
  if(defaultIdx<0) defaultIdx=0;
  if(_selectedPlanIdx>=0 && trainingPlan[_selectedPlanIdx]) {
    selectPlanDay(_selectedPlanIdx);
  } else {
    selectPlanDay(defaultIdx);
  }
}

function selectPlanDay(idx){
  const session=trainingPlan[idx];
  if(!session) return;
  _selectedPlanIdx=idx;

  // Mise à jour visuelle boutons
  document.querySelectorAll('.plan-session-btn').forEach(el=>{
    el.classList.toggle('selected', parseInt(el.dataset.idx)===idx);
  });

  // Afficher le détail
  const detailPanel=document.getElementById('planDetailPanel');
  if(!detailPanel) return;
  detailPanel.innerHTML=`
    <div class="pdp-title">${session.title}</div>
    <div class="pdp-sub">${session.day_name} ${session.day_num}</div>
    <div class="pdp-body">${formatSessionHtml(session.content)}</div>`;

  if(window.innerWidth<=768){
    detailPanel.scrollIntoView({behavior:'smooth',block:'start'});
  }
}

function openDayDetail(session){
  if(!session) return;
  _openedSession=session;
  document.getElementById('ddsTitle').textContent=session.title;
  document.getElementById('ddsSub').textContent=`${session.day_name} ${session.day_num}`;
  document.getElementById('ddsContent').innerHTML=formatSessionHtml(session.content);
  document.getElementById('dayDetailModal').style.display='flex';
  document.body.style.overflow='hidden';
}
function closeDayDetail(){
  document.getElementById('dayDetailModal').style.display='none';
  document.body.style.overflow='';
}
function openPlanModal(){
  document.getElementById('planOverlay').style.display='flex';
  document.getElementById('planTextarea').value='';
  document.getElementById('planUploadErr').style.display='none';
  setTimeout(()=>document.getElementById('planTextarea').focus(), 100);
}
function closePlanModal(){
  document.getElementById('planOverlay').style.display='none';
  document.getElementById('planUploadErr').style.display='none';
}
async function uploadTrainingPlan(){
  const text  = document.getElementById('planTextarea').value.trim();
  const errEl = document.getElementById('planUploadErr');
  if(!text){ errEl.textContent='Collez votre programme ci-dessus.'; errEl.style.display='block'; return; }
  try{
    const res = await fetch('/api/upload-training',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text})
    });
    const j = await res.json();
    if(!res.ok||j.error){ errEl.textContent='❌ '+j.error; errEl.style.display='block'; return; }
    trainingPlan = j.sessions;
    closePlanModal();
    renderWeekPlan();
    renderTodayWidget();
    const lbl = document.getElementById('planWeekLabel');
    if(lbl) lbl.textContent = j.week_label||'';
  }catch(e){
    errEl.textContent='❌ Erreur serveur'; errEl.style.display='block';
  }
}

// ══════════════════════════════════════════
// GARMIN CONNECT — SYNC AUTO
// ══════════════════════════════════════════
async function initGarminSync(){
  try{
    const r = await fetch('/api/garmin-status');
    const j = await r.json();
    if(j.configured && j.available){
      const btn = document.getElementById('syncGarminBtn');
      if(btn) btn.style.display='';
    }
  }catch(e){}
}

async function syncGarmin(days=30){
  const btn   = document.getElementById('syncGarminBtn');
  const label = document.getElementById('syncLabel');
  if(!btn) return;

  btn.disabled = true;
  const origLabel = label.textContent;
  label.textContent = 'Démarrage…';
  btn.style.opacity = '0.7';

  try{
    // Lancer le sync en arrière-plan
    const res = await fetch('/api/sync-garmin',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({days})
    });
    const j = await res.json();
    if(!res.ok || j.error){ alert('❌ ' + (j.error||'Erreur')); _syncReset(btn,label,origLabel); return; }

    // Poller le statut toutes les 3s
    _pollSync(btn, label, origLabel);
  }catch(e){
    alert('❌ Serveur inaccessible. Vérifiez Railway → Deployments.');
    _syncReset(btn, label, origLabel);
  }
}

function _syncReset(btn, label, origLabel){
  label.textContent = origLabel;
  btn.disabled = false;
  btn.style.opacity = '';
}

async function _pollSync(btn, label, origLabel, attempts=0){
  if(attempts > 40){ // timeout 2 min
    alert('❌ Sync trop long. Vérifiez vos identifiants Garmin.');
    _syncReset(btn, label, origLabel);
    return;
  }
  try{
    const r = await fetch('/api/sync-garmin/status');
    const s = await r.json();

    label.textContent = s.progress || 'Sync…';

    if(s.status === 'running' || s.status === 'started'){
      setTimeout(()=>_pollSync(btn, label, origLabel, attempts+1), 3000);
    } else if(s.status === 'done' && s.result){
      appData = s.result.data;
      localStorage.setItem(LS_KEY, JSON.stringify({ts: Date.now(), data: appData}));
      renderCurrent();
      const {wellness=0} = s.result.synced || {};
      label.textContent = `✓ ${wellness}j synchro`;
      setTimeout(()=>_syncReset(btn, label, origLabel), 4000);
    } else if(s.status === 'error'){
      alert('❌ ' + (s.progress || 'Erreur sync'));
      _syncReset(btn, label, origLabel);
    } else {
      setTimeout(()=>_pollSync(btn, label, origLabel, attempts+1), 3000);
    }
  }catch(e){
    setTimeout(()=>_pollSync(btn, label, origLabel, attempts+1), 3000);
  }
}
