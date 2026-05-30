// ── core.js — État global, helpers, routing ──

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
const charts={};
let appData=null, curView='dashboard', curPeriod=30, actFilter='all';
const LS_KEY='garmin_v3', LS_GOALS='garmin_goals_v1', LS_DARK='garmin_dark';
let nutriMeals=[];
let lastSleepRegularityScore=5;

// ══════════════════════════════════════════
// SWIPE MOBILE — navigation entre vues
// ══════════════════════════════════════════
const VIEWS_ORDER=['dashboard','sleep','sport','forme','nutrition','habitudes','planning'];
let _txStart=0,_tyStart=0;
document.addEventListener('touchstart',e=>{_txStart=e.touches[0].clientX;_tyStart=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-_txStart;
  const dy=e.changedTouches[0].clientY-_tyStart;
  if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return;
  const idx=VIEWS_ORDER.indexOf(curView);
  if(dx<0&&idx<VIEWS_ORDER.length-1)showView(VIEWS_ORDER[idx+1]);
  if(dx>0&&idx>0)showView(VIEWS_ORDER[idx-1]);
},{passive:true});

// ══════════════════════════════════════════
// CHART HELPERS
// ══════════════════════════════════════════
function dc(id){if(charts[id]){charts[id].destroy();delete charts[id]}}
function mkChart(id,cfg){dc(id);const c=document.getElementById(id);if(!c)return null;charts[id]=new Chart(c,cfg);return charts[id]}

// ══════════════════════════════════════════
// FORMATTERS
// ══════════════════════════════════════════
const fmt=m=>m==null?'—':`${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
// Convertit des heures décimales (ex: 1.75) en "1h45"
const fmtH=h=>{const m=Math.round(h*60);return`${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`};
// FC repos : préfère restingHR (Garmin calculé), sinon minHR (compat données anciennes)
const rhr=d=>d.restingHR||d.minHR;
const fmtDate=d=>{const[,mo,dy]=d.split('-');return`${parseInt(dy)} ${['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][parseInt(mo)-1]}`};
const stressInfo=v=>{
  if(v==null||v<0)return{label:'N/A',color:'#9CA3AF'};
  if(v<26)return{label:'Faible',color:'#22C55E'};
  if(v<51)return{label:'Moyen',color:'#F59E0B'};
  if(v<76)return{label:'Élevé',color:'#F97316'};
  return{label:'Très élevé',color:'#EF4444'};
};
const ACT_KNOWN=['running','cycling','yoga','strength_training','swimming'];
const actIcon=t=>({
  running:{svg:`<svg viewBox="0 0 24 24" fill="white"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>`,bg:'#22C55E'},
  cycling:{svg:`<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h3"/></svg>`,bg:'#3B82F6'},
  yoga:{svg:`<svg viewBox="0 0 24 24" fill="white"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 6c-2.2 0-4 1.8-4 4v3h2v-3c0-1.1.9-2 2-2s2 .9 2 2v3h2v-3c0-2.2-1.8-4-4-4z"/></svg>`,bg:'#8B5CF6'},
  strength_training:{svg:`<svg viewBox="0 0 24 24" fill="white"><path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29l-1.43-1.43z"/></svg>`,bg:'#EF4444'},
  swimming:{svg:`<svg viewBox="0 0 24 24" fill="white"><path d="M22 21c-1.11 0-1.73-.37-2.18-.64-.37-.22-.6-.36-1.15-.36-.56 0-.78.13-1.15.36-.46.27-1.07.64-2.19.64s-1.73-.37-2.18-.64c-.37-.22-.6-.36-1.15-.36-.56 0-.78.13-1.15.36-.46.27-1.08.64-2.19.64s-1.73-.37-2.18-.64c-.37-.22-.61-.36-1.15-.36-.56 0-.79.14-1.15.36C3.73 20.63 3.11 21 2 21v2c1.11 0 1.73-.37 2.18-.64.37-.22.6-.36 1.15-.36.56 0 .78.13 1.15.36.46.27 1.08.64 2.19.64s1.73-.37 2.18-.64c.37-.22.6-.36 1.15-.36.56 0 .78.13 1.15.36.46.27 1.07.64 2.19.64s1.73-.37 2.18-.64c.37-.22.6-.36 1.15-.36.56 0 .78.13 1.15.36.45.27 1.07.64 2.18.64v-2z"/></svg>`,bg:'#0EA5E9'},
}[t]||{svg:`<svg viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="5"/></svg>`,bg:'#6B7280'});
const typeLabel=t=>({running:'Course à pied',cycling:'Cyclisme',yoga:'Yoga',strength_training:'Muscu',swimming:'Natation'}[t]||t||'Activité');

// ══════════════════════════════════════════
// DARK MODE
// ══════════════════════════════════════════
function toggleDark(){
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const next=isDark?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem(LS_DARK,next);
  updateDarkBtn(next);
}
function updateDarkBtn(theme){
  const dark=theme==='dark';
  document.getElementById('darkIcon').innerHTML=dark
    ?'<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    :'<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  document.getElementById('darkLabel').textContent=dark?'Mode clair':'Mode sombre';
}

// ══════════════════════════════════════════
// PERIOD
// ══════════════════════════════════════════
function setPeriod(n){
  curPeriod=n;
  document.querySelectorAll('.period-btn').forEach(b=>b.classList.toggle('active',parseInt(b.textContent)===n));
  if(appData)renderCurrent();
}
const byPeriod=(arr,n)=>arr?arr.slice(-n):[];

// ══════════════════════════════════════════
// KPI TRENDS
// ══════════════════════════════════════════
function calcTrend(arr,key,n,lowerIsBetter=false){
  if(!arr||arr.length<2)return null;
  const curr=arr.slice(-n);
  const prev=arr.slice(-n*2,-n);
  if(!prev.length)return null;
  const avgArr=(a,k)=>a.filter(d=>d[k]!=null&&d[k]>=0).reduce((s,d)=>s+d[k],0)/(a.filter(d=>d[k]!=null&&d[k]>=0).length||1);
  const c=avgArr(curr,key), p=avgArr(prev,key);
  if(!p)return null;
  const pct=Math.round((c-p)/p*100);
  return {pct, up: lowerIsBetter ? pct<0 : pct>0};
}
function renderTrend(elId,trend,unit=''){
  const el=document.getElementById(elId);
  if(!el)return;
  if(!trend){el.innerHTML='';return;}
  const cls=trend.up?'trend-up':'trend-down';
  const arrow=trend.up?'↑':'↓';
  const sign=trend.pct>0?'+':'';
  el.innerHTML=`<span class="${cls}">${arrow} ${sign}${trend.pct}%</span><span class="trend-neutral">vs période préc.</span>`;
}

// ══════════════════════════════════════════
// VIEW ROUTING
// ══════════════════════════════════════════
const VIEW_META={
  dashboard: {title:'Mon tableau de bord',  sub:'Sommeil · Sport · Stress · Activités'},
  sleep:     {title:'Sommeil',              sub:'Analyse détaillée de vos nuits'},
  sport:     {title:'Sport & Activités',    sub:'Toutes vos séances'},
  forme:     {title:'Forme & Bien-être',    sub:'Pas quotidiens · Stress · Fréquence cardiaque'},
  nutrition: {title:'Nutrition',            sub:'Analyse de vos repas par OpenAI Vision'},
  habitudes: {title:'Habitudes',            sub:'Suivi quotidien de vos routines'},
  planning:  {title:'Planning',             sub:'Programme de la semaine'},
};
function showView(v){
  const viewEl=document.getElementById('view-'+v);
  if(!viewEl)return; // vue inexistante (cache navigateur obsolète)
  curView=v;
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  viewEl.classList.add('active');
  // Active state sidebar + ARIA current
  document.querySelectorAll('[data-view]').forEach(el=>{
    el.classList.toggle('active',el.dataset.view===v);
    el.setAttribute('aria-current',el.dataset.view===v?'page':'false');
  });
  const m=VIEW_META[v]||{};
  document.getElementById('viewTitle').textContent=m.title||'';
  document.getElementById('topbarSub').textContent=m.sub||'';
  if(appData)renderCurrent();
  else _showNoData(true);
}

function renderCurrent(){
  // La vue Habitudes n'a pas besoin des données Garmin (localStorage uniquement)
  if(curView==='habitudes'){
    _showNoData(false);
    try{renderHabitudes();}catch(err){console.error('[renderCurrent] habitudes:',err);}
    return;
  }
  if(!appData){_showNoData(true);return;}
  _showNoData(false);
  const fn={dashboard:renderDashboard,sleep:renderSleep,sport:renderSport,
    forme:renderForme,nutrition:renderNutritionView,
    planning:renderWeekPlan}[curView];
  if(!fn)return;
  // ── Error boundary : une vue qui plante n'affecte pas les autres ──
  try{fn();}catch(err){
    console.error('[renderCurrent] Erreur vue «'+curView+'»:',err);
    _showViewError(curView,err);
  }
}

// ── Affiche/masque l'overlay "aucune donnée" ──
function _showNoData(show){
  const el=document.getElementById('noDataOverlay');
  if(el)el.classList.toggle('visible',show);
}

// ── Skeletons sur les KPI pendant le chargement initial ──
function showSkeletons(show){
  document.querySelectorAll('.kpi-value').forEach(el=>el.classList.toggle('skel',show));
}

// ── Affiche une erreur dans la vue concernée ──
function _showViewError(view,err){
  const prev=document.querySelector('#view-'+view+' .view-error');
  if(prev)prev.remove();
  const el=document.getElementById('view-'+view);
  if(!el)return;
  const msg=(err&&err.message||'Erreur inattendue').replace(/</g,'&lt;');
  el.insertAdjacentHTML('afterbegin',`<div class="view-error">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <h3>Erreur d'affichage</h3>
    <p>${msg}</p>
    <button onclick="this.closest('.view-error').remove();renderCurrent()">Réessayer</button>
  </div>`);
}
