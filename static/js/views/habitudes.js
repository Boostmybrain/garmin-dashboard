// ── habitudes.js — Tracker d'habitudes quotidiennes ──

const HABITS_LIST = ['Sport','Yoga','Lecture','Italien','Complément alimentaire','Piano'];
const LS_HABITS   = 'garmin_habits_v1';
let _habitPeriod  = 7;

function _getHabits(){
  try{ return JSON.parse(localStorage.getItem(LS_HABITS)||'{}'); }catch{ return {}; }
}
function _saveHabits(d){ localStorage.setItem(LS_HABITS, JSON.stringify(d)); }

function toggleHabit(dateStr, habit){
  const data = _getHabits();
  if(!data[dateStr]) data[dateStr] = {};
  data[dateStr][habit] = !data[dateStr][habit];
  if(!data[dateStr][habit])      delete data[dateStr][habit];
  if(!Object.keys(data[dateStr]).length) delete data[dateStr];
  _saveHabits(data);
  renderHabitudes();
}

function setHabitPeriod(n){
  _habitPeriod = n;
  document.querySelectorAll('.habit-period-btn').forEach(b=>b.classList.toggle('active', +b.dataset.period===n));
  renderHabitudes();
}

function renderHabitudes(){
  const wrap = document.getElementById('habitGridWrap');
  if(!wrap) return;

  const data    = _getHabits();
  const today   = new Date(); today.setHours(0,0,0,0);
  const todayStr= today.toISOString().slice(0,10);

  // Générer tableau de dates (du plus ancien au plus récent)
  const dates = [];
  for(let i=_habitPeriod-1; i>=0; i--){
    const d = new Date(today); d.setDate(today.getDate()-i);
    dates.push(d.toISOString().slice(0,10));
  }

  // ── Stats globales ──
  let totalDone = 0;
  dates.forEach(d => HABITS_LIST.forEach(h => { if(data[d]?.[h]) totalDone++; }));
  const totalPossible = HABITS_LIST.length * _habitPeriod;
  const pct      = totalPossible ? Math.round(totalDone / totalPossible * 100) : 0;
  const todayDone= HABITS_LIST.filter(h => data[todayStr]?.[h]).length;

  // Streak : nb de jours consécutifs avec ≥1 habitude
  let streak = 0;
  for(let i=dates.length-1; i>=0; i--){
    const d = dates[i];
    if(HABITS_LIST.some(h => data[d]?.[h])){ streak++; } else break;
  }

  // Mettre à jour les stat-cards
  const el = id => document.getElementById(id);
  if(el('hbTotal'))  el('hbTotal').textContent  = totalDone;
  if(el('hbPct'))    el('hbPct').textContent     = pct+'%';
  if(el('hbToday'))  el('hbToday').textContent   = todayDone+'/'+HABITS_LIST.length;
  if(el('hbStreak')) el('hbStreak').textContent  = streak + (streak>1?' j':'j');

  // ── Construire la grille ──
  const DAY_INIT = ['D','L','M','M','J','V','S'];

  const gridHtml = `
    <div class="habit-grid" style="--hcols:${dates.length}">

      <!-- En-tête : coin vide puis dates -->
      <div class="hg-corner"></div>
      ${dates.map(d=>{
        const dt = new Date(d+'T00:00:00');
        const isToday = d===todayStr;
        return `<div class="hg-date-head${isToday?' hg-today-head':''}">
          <div class="hg-day-init">${DAY_INIT[dt.getDay()]}</div>
          <div class="hg-day-num">${dt.getDate()}</div>
        </div>`;
      }).join('')}

      <!-- Lignes habitudes -->
      ${HABITS_LIST.map(habit=>{
        const rowDone  = dates.filter(d => data[d]?.[habit]).length;
        const rowPct   = Math.round(rowDone / dates.length * 100);
        const emoji    = {
          'Sport':'🏃','Yoga':'🧘','Lecture':'📚',
          'Italien':'🇮🇹','Complément alimentaire':'💊','Piano':'🎹'
        }[habit]||'✦';
        return `
          <div class="hg-label">
            <span class="hg-habit-name">${emoji} ${habit}</span>
            <span class="hg-habit-score" style="color:${rowPct>=70?'#22C55E':rowPct>=40?'#F59E0B':'#9CA3AF'}">${rowDone}<span class="hg-habit-total">/${dates.length}</span></span>
          </div>
          ${dates.map(d=>{
            const done    = !!(data[d]?.[habit]);
            const isToday = d===todayStr;
            return `<button
              class="hg-cell${done?' done':''}${isToday?' is-today':''}"
              onclick="toggleHabit('${d}','${habit}')"
              aria-pressed="${done}"
              aria-label="${habit} ${d}${done?' effectué':' non effectué'}"
              title="${habit} — ${d}"
            ></button>`;
          }).join('')}
        `;
      }).join('')}

    </div>
  `;

  wrap.innerHTML = gridHtml;

  // Scroll auto vers aujourd'hui (colonne d'aujourd'hui visible)
  requestAnimationFrame(()=>{
    const todayBtn = wrap.querySelector('.hg-cell.is-today');
    if(todayBtn) todayBtn.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
  });
}
