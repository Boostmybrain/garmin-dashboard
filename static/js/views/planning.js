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
      if(curView==='nutrition' && typeof renderDayTotals==='function') renderDayTotals(nutriMeals);
    }
  }catch(e){}
}

function getTodaySession(){
  const now = new Date();
  return trainingPlan.find(s => s.day_num===now.getDate() && s.month===now.getMonth()+1) || null;
}

// Découpe le texte d'une séance en blocs logiques.
// Le texte arrive coupé à ~90 caractères par ligne : une ligne indentée, ou qui
// suit une ligne longue sans finir une phrase, prolonge la ligne précédente au
// lieu de devenir une nouvelle puce.
const _EMOJI_START = /^\p{Extended_Pictographic}/u;
const _BULLET      = /^[•·\-–—*]\s+/;
const _LABEL       = /^(Repos|Retour|Bloc|Objectif|Intensité|Priorité)/i;

function parseSessionBlocks(content){
  const blocks = [];
  let prevRaw = '';
  for(const raw of content.split('\n')){
    const line = raw.trim();
    if(!line){ blocks.push({kind:'gap'}); prevRaw=''; continue; }
    const last = blocks[blocks.length-1];
    const prev = prevRaw.trim();
    const isNewStart = _EMOJI_START.test(line) || _BULLET.test(line);
    const endsSentence = /[.!?:»)]$/.test(prev) && /^[A-ZÀ-ÖØ-Þ0-9«]/.test(line);
    const continues = last && last.kind!=='gap' && !isNewStart && (
      /^\s{2,}/.test(raw) || (prev.length>=70 && !endsSentence) ||
      (prev.length>=50 && /^[a-zà-öø-ÿ]/.test(line) && !/[.!?:]$/.test(prev))
    );
    prevRaw = raw;
    if(continues){
      // ligne courte suivie d'une majuscule : vrai retour à la ligne voulu
      const sep = (/^[a-zà-öø-ÿ(]/.test(line) || prev.length>=75) ? ' ' : '<br>';
      last.text += sep + line;
      continue;
    }
    if(_EMOJI_START.test(line))  blocks.push({kind:'head',  text:line});
    else if(_LABEL.test(line))   blocks.push({kind:'label', text:line});
    else                         blocks.push({kind:'item',  text:line.replace(_BULLET,'')});
  }
  return blocks;
}

// Convertit le texte brut en HTML stylisé
function formatSessionHtml(content){
  let html = '';
  let inBlock = false;
  const closeList = ()=>{ if(inBlock){ html+='</ul>'; inBlock=false; } };
  for(const b of parseSessionBlocks(content)){
    if(b.kind==='gap'){ closeList(); html+='<div style="height:8px"></div>'; continue; }
    if(b.kind==='head'){
      closeList();
      html+=`<div style="font-size:15px;font-weight:700;margin:14px 0 6px;line-height:1.5">${b.text}</div>`;
      continue;
    }
    if(b.kind==='label'){
      closeList();
      html+=`<div style="font-size:13px;font-weight:600;color:#9CA3AF;margin-top:10px">${b.text}</div>`;
      continue;
    }
    if(!inBlock){ html+='<ul style="margin:4px 0 4px 18px;list-style:disc">'; inBlock=true; }
    html+=`<li style="font-size:14px;line-height:1.7">${b.text}</li>`;
  }
  closeList();
  return html;
}

function renderTodayWidget(){
  const wrap = document.getElementById('todayTrainingWidget');
  if(!wrap) return;
  _todaySession = getTodaySession();
  if(!_todaySession){ wrap.innerHTML=''; return; }
  const s = _todaySession;

  // Aperçu : 4 premiers blocs
  const previewHtml = parseSessionBlocks(s.content).filter(b=>b.kind!=='gap').slice(0,4).map(b=>
    b.kind==='head'
      ? `<div style="font-weight:700;margin-top:6px">${b.text}</div>`
      : `<div style="font-size:13px;color:var(--text2);padding-left:8px">${b.text}</div>`
  ).join('');

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

// Date réelle d'une séance (le plan ne stocke que jour + mois)
function sessionDate(s, today){
  const yr = today.getFullYear();
  // Plan qui chevauche déc/jan
  const yr2 = (s.month < today.getMonth()+1-6) ? yr+1 : yr;
  return new Date(yr2, s.month-1, s.day_num);
}

// ── Génère les jours à afficher : d'aujourd'hui à J+13 au minimum,
// étendu jusqu'à la dernière séance du plan. Les jours passés sont masqués.
function get7Days(){
  const DAY_FR=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const today = new Date();
  today.setHours(0,0,0,0);

  const startDate = new Date(today);
  let endDate   = new Date(today);
  endDate.setDate(today.getDate() + 13); // 2 semaines minimum

  trainingPlan.forEach(s=>{
    const d = sessionDate(s, today);
    if(d > endDate) endDate = new Date(d);
  });

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

  const lbl = document.getElementById('planWeekLabel');
  if(lbl){
    const f = d=>d.date.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});
    lbl.textContent = `Du ${f(days7[0])} au ${f(days7[days7.length-1])}`;
  }

  // Sélectionner aujourd'hui si une session existe, sinon la prochaine
  const today=new Date(); today.setHours(0,0,0,0);
  const upcoming=trainingPlan.map((s,i)=>({i,d:sessionDate(s,today)})).filter(x=>x.d>=today).sort((a,b)=>a.d-b.d);
  const defaultIdx=upcoming.length?upcoming[0].i:0;
  if(_selectedPlanIdx>=0 && trainingPlan[_selectedPlanIdx] && sessionDate(trainingPlan[_selectedPlanIdx],today)>=today) {
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
      const {wellness=0, activities=0} = s.result.synced || {};
      const errors = s.result.errors || [];
      if(wellness === 0 && errors.length > 0){
        const firstErr = errors[0] || '';
        if(firstErr.includes('429') || firstErr.toLowerCase().includes('rate')){
          label.textContent = '⚠️ Rate-limited';
          alert('Garmin bloque les requêtes (rate limiting).\nRéessayez dans 5-10 minutes.');
        } else {
          label.textContent = '⚠️ 0j récupérés';
          alert('Sync terminé mais aucune donnée récupérée.\nErreur : ' + firstErr);
        }
      } else {
        label.textContent = `✓ ${wellness}j · ${activities} activités`;
      }
      setTimeout(()=>_syncReset(btn, label, origLabel), 5000);
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

// ── Anti-tap-pendant-défilement sur la bande des jours (mobile) ──────────────
// En mobile, .plan-list-panel passe en overflow-x:auto : un swipe pour faire
// défiler les jours déclenchait le onclick de la séance survolée. On neutralise
// le clic dès que le doigt a bougé, ou juste après un défilement.
(function(){
  const MOVE_TOLERANCE  = 10;   // px — au-delà, c'est un swipe, pas un tap
  const SCROLL_COOLDOWN = 150;  // ms — clics ignorés après le dernier défilement

  let tracking = false, startX = 0, startY = 0, moved = false, lastScrollAt = 0;
  const inStrip = t => t && t.closest && t.closest('.plan-list-panel');

  document.addEventListener('pointerdown', e => {
    if(!inStrip(e.target)) return;
    tracking = true; moved = false;
    startX = e.clientX; startY = e.clientY;
  }, true);

  document.addEventListener('pointermove', e => {
    if(!tracking || moved) return;
    if(Math.abs(e.clientX-startX) > MOVE_TOLERANCE ||
       Math.abs(e.clientY-startY) > MOVE_TOLERANCE) moved = true;
  }, true);

  // capture obligatoire : les événements scroll ne remontent pas
  document.addEventListener('scroll', e => {
    if(inStrip(e.target)) lastScrollAt = Date.now();
  }, true);

  // capture : on intercepte avant que le onclick inline de la séance ne parte
  document.addEventListener('click', e => {
    if(!inStrip(e.target)) return;
    const scrolling = Date.now() - lastScrollAt < SCROLL_COOLDOWN;
    if(moved || scrolling){
      e.stopPropagation();
      e.preventDefault();
    }
    tracking = false; moved = false;
  }, true);
})();
