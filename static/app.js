// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
const charts={};
let appData=null, curView='dashboard', curPeriod=30, actFilter='all';
const LS_KEY='garmin_v3', LS_GOALS='garmin_goals_v1', LS_DARK='garmin_dark';
let nutriMeals=[];

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
const fmtH=h=>{const m=Math.round(h*60);return`${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;};
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
  dashboard:{title:'Mon tableau de bord',sub:'Sommeil · Sport · Stress · Activités'},
  sleep:{title:'Sommeil',sub:'Analyse détaillée de vos nuits'},
  sport:{title:'Sport & Activités',sub:'Toutes vos séances'},
  stress:{title:'Stress & Fréquence Cardiaque',sub:'Tendances stress et FC de repos'},
  goals:{title:'Objectifs',sub:'Suivez vos objectifs quotidiens'},
  nutrition:{title:'Nutrition',sub:'Analyse de vos repas par OpenAI Vision'},
  planning:{title:'Planning',sub:'Programme de la semaine'},
};
function showView(v){
  curView=v;
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  document.getElementById('view-'+v).classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===v));
  const m=VIEW_META[v]||{};
  document.getElementById('viewTitle').textContent=m.title||'';
  document.getElementById('topbarSub').textContent=m.sub||'';
  if(appData)renderCurrent();
}
function renderCurrent(){
  ({dashboard:renderDashboard,sleep:renderSleep,sport:renderSport,
    stress:renderStressView,goals:renderGoals,nutrition:renderNutritionView,
    planning:renderWeekPlan}[curView]||(() => {}))();
}

// ══════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════
function spark(id,data,color){
  mkChart(id,{type:'line',data:{labels:data.map((_,i)=>i),datasets:[{data,borderColor:color,borderWidth:2,pointRadius:0,fill:{target:'origin',above:color+'25'},tension:.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{display:false}}}});
}
function renderSleepDonut(canvasId,phasesId,s){
  const pc=['#4A6CF7','#818CF8','#C4B5FD','#FCA5A5'],pn=['Profond','Léger','REM','Éveil'],pk=['deep_min','light_min','rem_min','awake_min'];
  const tot=pk.reduce((t,k)=>t+(s[k]||0),0);
  mkChart(canvasId,{type:'doughnut',data:{labels:pn,datasets:[{data:pk.map(k=>s[k]||0),backgroundColor:pc,borderWidth:0,cutout:'72%'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${fmt(c.raw)}`}}}}});
  const ph=document.getElementById(phasesId);ph.innerHTML='';
  pk.forEach((k,i)=>{const m=s[k]||0,pct=tot>0?Math.round(m/tot*100):0;ph.innerHTML+=`<div class="phase-row"><div class="phase-dot" style="background:${pc[i]}"></div><span class="phase-lbl">${pn[i]}</span><div class="phase-bar-wrap"><div class="phase-bar" style="background:${pc[i]};width:${pct}%"></div></div><span class="phase-pct">${fmt(m)}</span></div>`;});
}
function renderRunChart(id,A){
  // Palette couleurs par sortie (jusqu'à 7 courses/semaine)
  const COLS=['#4A6CF7','#22C55E','#FF6B35','#F59E0B','#8B5CF6','#0EA5E9','#EF4444'];

  // Grouper les courses par semaine (lundi = début)
  const weekRuns={};
  A.filter(a=>a.type==='running'&&a.distance_km>0).forEach(a=>{
    const d=new Date(a.date);
    const dow=d.getDay();
    const mon=new Date(d);
    mon.setDate(d.getDate()-(dow===0?6:dow-1));
    const wk=mon.toISOString().slice(0,10);
    if(!weekRuns[wk])weekRuns[wk]=[];
    weekRuns[wk].push(+(a.distance_km.toFixed(1)));
  });

  const wks=Object.keys(weekRuns).sort().slice(-10);
  const maxRuns=Math.max(1,...wks.map(w=>weekRuns[w].length));

  // Un dataset par position de course (1ère, 2ème, 3ème…)
  const datasets=[];
  for(let i=0;i<maxRuns;i++){
    const col=COLS[i%COLS.length];
    datasets.push({
      label:`Course ${i+1}`,
      data:wks.map(w=>weekRuns[w][i]||0),
      backgroundColor:col+'CC',
      borderColor:col,
      borderWidth:1.5,
      borderRadius:i===maxRuns-1?4:0,
      borderSkipped:'bottom',
      stack:'runs',
    });
  }

  mkChart(id,{
    type:'bar',
    data:{labels:wks.map(fmtDate),datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:c=>c.raw>0?`Course ${c.datasetIndex+1} : ${c.raw} km`:null,
            footer:items=>{
              const nz=items.filter(c=>c.raw>0);
              if(!nz.length)return'';
              const tot=nz.reduce((s,c)=>s+c.raw,0);
              return`Total : ${tot.toFixed(1)} km  ·  ${nz.length} sortie${nz.length>1?'s':''}`;
            }
          }
        }
      },
      scales:{
        x:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}},
      }
    }
  });
}
function actHTML(a){
  const ic=actIcon(a.type);
  return `<div class="act-item"><div class="act-ic" style="background:${ic.bg}">${ic.svg}</div><div class="act-info"><div class="act-name">${typeLabel(a.type)}</div><div class="act-date">${fmtDate(a.date)}${a.name&&a.name!==a.type?' · '+a.name:''}</div></div><div class="act-stats">${a.distance_km>0?`<div class="act-stat"><span class="v">${a.distance_km} km</span><span class="l">Distance</span></div>`:''}<div class="act-stat"><span class="v">${a.duration_min} min</span><span class="l">Durée</span></div>${a.maxHR?`<div class="act-stat"><span class="v">${a.maxHR} bpm</span><span class="l">FC max</span></div>`:''}</div></div>`;
}
const EMPTY=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Aucune donnée</h3><p>Importez un fichier Garmin</p></div>`;

// ══════════════════════════════════════════
// SCORE
// ══════════════════════════════════════════
function calcScore(W,S){
  const l=W.length?W[W.length-1]:{},ls=S.length?S[S.length-1]:{};
  const slSc=Math.min(30,(ls.sleepTotal_min||0)/480*30);
  const stSc=(l.stress!=null&&l.stress>=0)?(100-l.stress)/100*30:15;
  const hrSc=l.minHR?Math.max(0,Math.min(20,(80-l.minHR)/30*20)):10;
  const spSc=Math.min(20,(l.steps||0)/10000*20);
  return{total:Math.round(slSc+stSc+hrSc+spSc),sleep:Math.round(slSc),stress:Math.round(stSc),hr:Math.round(hrSc),steps:Math.round(spSc)};
}
function renderScore(W,S){
  const sc=calcScore(W,S);
  document.getElementById('scoreCard').style.display='flex';
  document.getElementById('scoreVal').textContent=sc.total;
  ['sleep','stress','hr','steps'].forEach(k=>{document.getElementById('sc_'+k).textContent=sc[k]+'/'+(k==='sleep'||k==='stress'?30:20);});
  const col=sc.total>=80?'#4A6CF7':sc.total>=60?'#22C55E':sc.total>=40?'#F59E0B':'#EF4444';
  const lbl=sc.total>=80?'Excellent':sc.total>=60?'Bon':sc.total>=40?'Moyen':'Fatigué';
  document.getElementById('scoreLabel').textContent=`Forme du jour : ${lbl}`;
  document.getElementById('scoreDesc').textContent=sc.total>=80?'Excellente récupération — prêt pour une grosse séance !':sc.total>=60?'Bonne forme, entraînement normal recommandé.':sc.total>=40?'Forme moyenne — séance légère conseillée.':'Récupération insuffisante, reposez-vous.';
  mkChart('scoreRing',{type:'doughnut',data:{labels:['Score','Reste'],datasets:[{data:[sc.total,100-sc.total],backgroundColor:[col,'var(--surface2)'],borderWidth:0,cutout:'78%'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:600}}});
}

// ══════════════════════════════════════════
// RECORDS PERSONNELS
// ══════════════════════════════════════════
function renderRecords(W,A,S){
  const grid=document.getElementById('recordsGrid');
  if(!W.length&&!A.length&&!S.length){grid.style.display='none';return;}
  const maxStepDay=W.reduce((best,d)=>d.steps>best.steps?d:best,{steps:0});
  const bestRun=A.filter(a=>a.type==='running'&&a.distance_km>0).reduce((b,a)=>a.distance_km>b.distance_km?a:b,{distance_km:0});
  const lowestHR=W.filter(d=>d.minHR).reduce((b,d)=>d.minHR<b.minHR?d:b,{minHR:999});
  const bestSleep=S.reduce((b,s)=>s.sleepTotal_min>b.sleepTotal_min?s:b,{sleepTotal_min:0});
  const maxCal=W.reduce((b,d)=>d.calories>b.calories?d:b,{calories:0});
  const longestAct=A.reduce((b,a)=>a.duration_min>b.duration_min?a:b,{duration_min:0});

  const recs=[
    {icon:'👟',val:maxStepDay.steps?(maxStepDay.steps/1000).toFixed(1)+'k':'—',lbl:'Record pas'},
    {icon:'🏃',val:bestRun.distance_km?bestRun.distance_km+' km':'—',lbl:'Meilleure course'},
    {icon:'❤️',val:lowestHR.minHR<999?lowestHR.minHR+' bpm':'—',lbl:'FC repos min'},
    {icon:'😴',val:bestSleep.sleepTotal_min?fmt(bestSleep.sleepTotal_min):'—',lbl:'Meilleure nuit'},
    {icon:'🔥',val:maxCal.calories?(maxCal.calories.toLocaleString('fr-FR')+' kcal'):'—',lbl:'Max calories/jour'},
    {icon:'⏱️',val:longestAct.duration_min?longestAct.duration_min+' min':'—',lbl:'Séance la plus longue'},
  ];
  grid.style.display='grid';
  grid.innerHTML=recs.map(r=>`<div class="record-card"><div class="record-icon">${r.icon}</div><div class="record-val">${r.val}</div><div class="record-lbl">${r.lbl}</div></div>`).join('');
}

// ══════════════════════════════════════════
// HEATMAP
// ══════════════════════════════════════════
function renderHeatmap(W){
  const panel=document.getElementById('heatmapPanel');
  if(!W.length){panel.style.display='none';return;}
  panel.style.display='block';
  const stepsMap={};W.forEach(d=>stepsMap[d.date]=d.steps);
  const today=new Date();
  const start=new Date(today);
  start.setFullYear(today.getFullYear()-1);
  // Align to Monday
  const dow=start.getDay();
  start.setDate(start.getDate()-(dow===0?6:dow-1));

  const cs=12,gap=3,step=cs+gap;
  const totalWeeks=53;
  const w=totalWeeks*step, h=7*step;

  const hmColor=n=>{
    if(!n||n<=0)return'var(--surface2)';
    if(n>=10000)return'#16A34A';
    if(n>=7500) return'#4ADE80';
    if(n>=5000) return'#86EFAC';
    if(n>=2500) return'#BBF7D0';
    return'#DCFCE7';
  };

  const months=[],seenMonth=new Set();
  let svg=`<svg width="${w}" height="${h+20}" viewBox="0 0 ${w} ${h+20}" style="display:block">`;
  // Month labels
  for(let wk=0;wk<totalWeeks;wk++){
    const d=new Date(start);d.setDate(start.getDate()+wk*7);
    const mo=d.getMonth();
    if(!seenMonth.has(mo)){seenMonth.add(mo);const mn=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];svg+=`<text x="${wk*step}" y="${h+16}" font-size="9" fill="var(--text2)" font-family="DM Sans,sans-serif">${mn[mo]}</text>`;}
  }
  // Cells
  for(let wk=0;wk<totalWeeks;wk++){
    for(let dy=0;dy<7;dy++){
      const d=new Date(start);d.setDate(start.getDate()+wk*7+dy);
      if(d>today)continue;
      const key=d.toISOString().slice(0,10);
      const steps=stepsMap[key]||0;
      const x=wk*step, y=dy*step;
      svg+=`<rect x="${x}" y="${y}" width="${cs}" height="${cs}" rx="2" fill="${hmColor(steps)}"><title>${key} — ${steps.toLocaleString('fr-FR')} pas</title></rect>`;
    }
  }
  svg+='</svg>';
  document.getElementById('heatmapContainer').innerHTML=svg;
}

// ══════════════════════════════════════════
// COMPARISON
// ══════════════════════════════════════════
function renderComparison(W,S){
  const panel=document.getElementById('compPanel');
  if(!W.length){panel.style.display='none';return;}
  panel.style.display='block';
  document.getElementById('compBadge').textContent=`${curPeriod}j vs ${curPeriod}j précédents`;

  const curr=byPeriod(W,curPeriod), prev=W.slice(-curPeriod*2,-curPeriod);
  const currS=byPeriod(S,curPeriod), prevS=S.slice(-curPeriod*2,-curPeriod);
  const avg=(arr,k)=>{const f=arr.filter(d=>d[k]!=null&&d[k]>0);return f.length?f.reduce((s,d)=>s+d[k],0)/f.length:0};

  const metrics=[
    {id:'steps',  label:'Pas moy.',    unitShort:'k',  curr:avg(curr,'steps')/1000,      prev:avg(prev,'steps')/1000,      col:'#4A6CF7',lowerBetter:false},
    {id:'sleep',  label:'Sommeil moy.',unitShort:'h',  curr:avg(currS,'sleepTotal_min')/60,prev:avg(prevS,'sleepTotal_min')/60,col:'#8B5CF6',lowerBetter:false},
    {id:'cal',    label:'Calories moy.',unitShort:'kcal',curr:avg(curr,'calories'),       prev:avg(prev,'calories'),         col:'#FF6B35',lowerBetter:false},
    {id:'stress', label:'Stress moy.', unitShort:'',   curr:avg(curr.filter(d=>d.stress>=0),'stress'),prev:avg(prev.filter(d=>d.stress>=0),'stress'),col:'#F59E0B',lowerBetter:true},
  ];

  const grid=document.getElementById('compGrid');
  grid.innerHTML=metrics.map(m=>{
    const delta=m.prev?((m.curr-m.prev)/m.prev*100):0;
    const better=m.lowerBetter?delta<0:delta>0;
    const col=better?'#22C55E':delta===0?'#94A3B8':'#EF4444';
    const arrow=delta>0?'↑':delta<0?'↓':'→';
    const pct=Math.abs(Math.round(delta));
    const barPct=m.prev?Math.min(100,m.curr/m.prev*100):100;
    return`<div class="cmp-card">
      <div class="cmp-label">${m.label}</div>
      <div class="cmp-row"><span class="cmp-val">${m.curr.toFixed(1)} ${m.unitShort}</span><span style="color:${col};font-weight:700;font-size:13px">${arrow} ${pct}%</span></div>
      <div class="cmp-prev">Préc. : ${m.prev.toFixed(1)} ${m.unitShort}</div>
      <div class="cmp-bar-bg"><div class="cmp-bar-curr" style="width:${barPct}%;background:${m.col}"></div></div>
    </div>`;
  }).join('');

  // Grouped bar chart
  mkChart('compChart',{type:'bar',data:{
    labels:metrics.map(m=>m.label),
    datasets:[
      {label:'Période actuelle',data:metrics.map(m=>+m.curr.toFixed(1)),backgroundColor:metrics.map(m=>m.col+'CC'),borderRadius:6},
      {label:'Période précédente',data:metrics.map(m=>+m.prev.toFixed(1)),backgroundColor:metrics.map(m=>m.col+'44'),borderRadius:6},
    ]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},scales:{x:{display:true,ticks:{font:{size:10},color:'#9CA3AF'},grid:{display:false}},y:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}});
}

// ══════════════════════════════════════════
// RENDER DASHBOARD
// ══════════════════════════════════════════
function renderDashboard(){
  const W=appData.wellness||[],A=appData.activities||[],S=appData.sleep||[],C=appData.customer||{};
  const Wp=byPeriod(W,curPeriod),Sp=byPeriod(S,curPeriod);

  if(C.firstName){document.getElementById('userName').textContent=C.firstName;document.getElementById('avatarInitial').textContent=C.firstName[0].toUpperCase();}

  renderScore(W,S);
  renderRecords(W,A,S);
  renderHeatmap(W);
  renderComparison(W,S);

  const last=W.length?W[W.length-1]:{},ls=S.length?S[S.length-1]:{};
  document.getElementById('kSleep').textContent=fmt(ls.sleepTotal_min);
  document.getElementById('kCal').textContent=(last.calories||0).toLocaleString('fr-FR');
  document.getElementById('kSteps').textContent=(last.steps||0).toLocaleString('fr-FR');
  document.getElementById('kHR').innerHTML=`${last.minHR||'—'}<span style="font-size:14px;font-weight:400;color:var(--text2)"> bpm</span>`;
  document.getElementById('kHRsub').textContent=`FC min · max : ${last.maxHR||'—'} bpm`;
  const si=stressInfo(last.stress);
  document.getElementById('kStress').textContent=last.stress>=0?last.stress:'—';
  document.getElementById('kStressLabel').textContent=si.label;

  // Trends
  renderTrend('tSleep', calcTrend(S,'sleepTotal_min',curPeriod,false));
  renderTrend('tCal',   calcTrend(W,'calories',curPeriod,false));
  renderTrend('tSteps', calcTrend(W,'steps',curPeriod,false));
  renderTrend('tHR',    calcTrend(W,'minHR',curPeriod,true));
  renderTrend('tStress',calcTrend(W.filter(d=>d.stress>=0),'stress',curPeriod,true));

  spark('spSleep',S.slice(-14).map(s=>s.sleepTotal_min),'#8B5CF6');
  spark('spCal',W.slice(-14).map(d=>d.calories),'#FF6B35');
  spark('spSteps',W.slice(-14).map(d=>d.steps),'#22C55E');
  spark('spHR',W.slice(-14).map(d=>d.minHR||0),'#0EA5E9');
  spark('spStress',W.slice(-14).map(d=>Math.max(0,d.stress||0)),'#F59E0B');

  document.getElementById('sleepBadge').textContent=ls.date?fmtDate(ls.date):'—';
  document.getElementById('slInBed').textContent=fmt(ls.inBed_min);
  document.getElementById('slTotal').textContent=fmt(ls.sleepTotal_min);
  renderSleepDonut('sleepDonut','sleepPhases',ls);

  document.getElementById('actList').innerHTML=A.length?[...A].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(actHTML).join(''):EMPTY;
  document.getElementById('actBadge').textContent=A.length?`${A.length} séances`:'—';

  document.getElementById('stepsChartBadge').textContent=curPeriod+'j';
  document.getElementById('stressChartBadge').textContent=curPeriod+'j';
  document.getElementById('sleepTrendBadge').textContent=Math.min(Sp.length,15)+' nuits';

  mkChart('stepsChart',{type:'bar',data:{labels:Wp.map(d=>fmtDate(d.date)),datasets:[{label:'Pas',data:Wp.map(d=>d.steps),backgroundColor:Wp.map(d=>d.steps>=10000?'#22C55E55':d.steps>=7500?'#4A6CF755':'#94A3B855'),borderColor:Wp.map(d=>d.steps>=10000?'#22C55E':d.steps>=7500?'#4A6CF7':'#94A3B8'),borderWidth:1.5,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.toLocaleString('fr-FR')} pas`}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},y:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}});

  const sw=Wp.filter(d=>d.stress!=null&&d.stress>=0);
  mkChart('stressChart',{type:'line',data:{labels:sw.map(d=>fmtDate(d.date)),datasets:[{label:'Stress',data:sw.map(d=>d.stress),borderColor:'#F59E0B',backgroundColor:'#FEF3C722',borderWidth:2,pointRadius:2,fill:true,tension:.4,yAxisID:'y'},{label:'FC min',data:sw.map(d=>d.minHR||0),borderColor:'#0EA5E9',backgroundColor:'transparent',borderWidth:2,pointRadius:2,fill:false,tension:.4,yAxisID:'y2'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},y:{display:true,position:'left',ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'},min:0,max:100},y2:{display:true,position:'right',ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}}}}});

  renderRunChart('runChart',A);

  const sl=Sp.slice(-15);
  mkChart('sleepTrend',{type:'bar',data:{labels:sl.map(s=>fmtDate(s.date)),datasets:[{label:'Profond',data:sl.map(s=>+(s.deep_min/60).toFixed(2)),backgroundColor:'#4A6CF7',stack:'s'},{label:'Léger',data:sl.map(s=>+(s.light_min/60).toFixed(2)),backgroundColor:'#818CF8',stack:'s'},{label:'REM',data:sl.map(s=>+(s.rem_min/60).toFixed(2)),backgroundColor:'#C4B5FD',stack:'s'},{label:'Éveil',data:sl.map(s=>+(s.awake_min/60).toFixed(2)),backgroundColor:'#FCA5A5',stack:'s'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:9},boxWidth:10}},tooltip:{callbacks:{label:c=>c.raw>0?`${c.dataset.label} : ${fmtH(c.raw)}`:null,footer:items=>{const tot=items.reduce((s,c)=>s+c.raw,0);return tot>0?`Total : ${fmtH(tot)}`:'';}}}},scales:{x:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}},y:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>fmtH(v)},grid:{color:'var(--surface2)'}}}}});
}

// ── Convertit "HH:MM" en heures décimales normalisées pour le graphique coucher/lever
// Les heures de nuit (20h–23h59) → 20–24; après minuit (00h–12h) → 24–36
function _sleepHour(timeStr, isWake){
  if(!timeStr) return null;
  const parts=timeStr.split(':');
  if(parts.length<2) return null;
  let h=parseInt(parts[0]), m=parseInt(parts[1]);
  if(isNaN(h)||isNaN(m)) return null;
  const dec=h+m/60;
  // Coucher : si avant midi → c'est après minuit → +24
  // Lever : si avant 15h → c'est le matin → +24
  if(isWake) return dec<15 ? dec+24 : dec;
  return dec<14 ? dec+24 : dec;
}

function renderBedtimeChart(S){
  const data=S.filter(s=>s.bedtime||s.wakeTime).slice(-21); // 3 dernières semaines
  if(!data.length){ document.getElementById('bedtimeBadge').textContent='—'; return; }
  document.getElementById('bedtimeBadge').textContent=data.length+' nuits';

  const labels=data.map(s=>fmtDate(s.date));
  const beds  =data.map(s=>_sleepHour(s.bedtime,  false));
  const wakes =data.map(s=>_sleepHour(s.wakeTime, true));

  // Floating bar : [bedtime, wakeTime] par nuit
  const barData=data.map((_,i)=>{
    const b=beds[i], w=wakes[i];
    if(b==null||w==null) return null;
    // S'assurer que wake > bed
    return [b, w>b ? w : w+24];
  });

  // Calculer les bornes Y (heures min/max avec marge)
  const allVals=barData.filter(Boolean).flat();
  const yMin=Math.max(18, Math.floor(Math.min(...allVals))-0.5);
  const yMax=Math.min(36, Math.ceil(Math.max(...allVals))+0.5);

  // Formateur axe Y : heures normalisées → "HHh"
  const tickFmt=v=>{const h=Math.round(v)%24; return`${String(h).padStart(2,'0')}h`;};

  dc('bedtimeChart');
  const canvas=document.getElementById('bedtimeChart');
  if(!canvas) return;
  charts['bedtimeChart']=new Chart(canvas,{
    type:'bar',
    data:{
      labels,
      datasets:[{
        label:'Sommeil',
        data:barData,
        backgroundColor:data.map((_,i)=>{
          // Colorer selon durée : vert>7h, jaune 6-7h, rouge<6h
          const b=beds[i],w=wakes[i];
          if(b==null||w==null) return '#E5E7EB';
          const dur=(w>b?w:w+24)-b;
          return dur>=7?'#8B5CF6CC':dur>=6?'#F59E0BCC':'#EF4444CC';
        }),
        borderColor:data.map((_,i)=>{
          const b=beds[i],w=wakes[i];
          if(b==null||w==null) return '#E5E7EB';
          const dur=(w>b?w:w+24)-b;
          return dur>=7?'#8B5CF6':dur>=6?'#F59E0B':'#EF4444';
        }),
        borderWidth:1.5,
        borderRadius:3,
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            title:items=>labels[items[0].dataIndex],
            label:c=>{
              const b=beds[c.dataIndex], w=wakes[c.dataIndex];
              if(b==null||w==null) return'Données manquantes';
              const bed=c.chart.data.datasets[0].data[c.dataIndex];
              if(!bed) return'';
              const dur=(bed[1]-bed[0]);
              const durH=Math.floor(dur), durM=Math.round((dur-durH)*60);
              const bedH=Math.floor(b%24), bedM=Math.round((b%1)*60);
              const wkH =Math.floor(w%24), wkM =Math.round((w%1)*60);
              return[
                `🌙 Coucher : ${String(bedH).padStart(2,'0')}h${String(bedM).padStart(2,'0')}`,
                `☀️ Lever   : ${String(wkH).padStart(2,'0')}h${String(wkM).padStart(2,'0')}`,
                `⏱ Durée   : ${durH}h${String(durM).padStart(2,'0')}`,
              ];
            }
          }
        }
      },
      scales:{
        x:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}},
        y:{
          min:yMin, max:yMax,
          reverse:true,          // coucher en haut, lever en bas
          ticks:{font:{size:9},color:'#9CA3AF',stepSize:1,callback:tickFmt},
          grid:{color:'var(--surface2)'},
        }
      }
    }
  });
}

// ══════════════════════════════════════════
// RENDER SOMMEIL
// ══════════════════════════════════════════
function renderSleep(){
  const S=appData.sleep||[],Sp=byPeriod(S,curPeriod);
  if(!Sp.length){document.getElementById('view-sleep').innerHTML=EMPTY;return;}
  const avg=(arr,k)=>arr.length?Math.round(arr.reduce((s,n)=>s+(n[k]||0),0)/arr.length):0;
  const avgTotal=avg(Sp,'sleepTotal_min'),avgDeep=avg(Sp,'deep_min'),avgLight=avg(Sp,'light_min'),avgRem=avg(Sp,'rem_min'),avgAwake=avg(Sp,'awake_min');
  const beds=Sp.map(s=>s.bedtime).filter(Boolean).sort();
  document.getElementById('sl_avgTotal').textContent=fmt(avgTotal);
  document.getElementById('sl_avgDeep').textContent=fmt(avgDeep);
  document.getElementById('sl_avgRem').textContent=fmt(avgRem);
  document.getElementById('sl_avgBed').textContent=beds.length?beds[Math.floor(beds.length/2)]:'—';
  document.getElementById('sleepTrendBadge2').textContent=Sp.length+' nuits';
  mkChart('sleepTrendFull',{type:'bar',data:{labels:Sp.map(s=>fmtDate(s.date)),datasets:[{label:'Profond',data:Sp.map(s=>+(s.deep_min/60).toFixed(2)),backgroundColor:'#4A6CF7',stack:'s'},{label:'Léger',data:Sp.map(s=>+(s.light_min/60).toFixed(2)),backgroundColor:'#818CF8',stack:'s'},{label:'REM',data:Sp.map(s=>+(s.rem_min/60).toFixed(2)),backgroundColor:'#C4B5FD',stack:'s'},{label:'Éveil',data:Sp.map(s=>+(s.awake_min/60).toFixed(2)),backgroundColor:'#FCA5A5',stack:'s'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}},tooltip:{callbacks:{label:c=>c.raw>0?`${c.dataset.label} : ${fmtH(c.raw)}`:null,footer:items=>{const tot=items.reduce((s,c)=>s+c.raw,0);return tot>0?`Total : ${fmtH(tot)}`:'';}}}},scales:{x:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF',maxTicksLimit:12},grid:{display:false}},y:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>fmtH(v)},grid:{color:'var(--surface2)'}}}}});
  renderBedtimeChart(S);

  const ls=S[S.length-1];
  document.getElementById('sleepLastBadge').textContent=ls.date?fmtDate(ls.date):'—';
  document.getElementById('sl2_inBed').textContent=fmt(ls.inBed_min);
  document.getElementById('sl2_total').textContent=fmt(ls.sleepTotal_min);
  document.getElementById('sl2_bed').textContent=ls.bedtime||'—';
  document.getElementById('sl2_wake').textContent=ls.wakeTime||'—';
  renderSleepDonut('sleepDonut2','sleepPhases2',ls);
  mkChart('sleepPhaseAvg',{type:'bar',data:{labels:['Profond','Léger','REM','Éveil'],datasets:[{data:[avgDeep,avgLight,avgRem,avgAwake],backgroundColor:['#4A6CF7','#818CF8','#C4B5FD','#FCA5A5'],borderRadius:8}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw)}}},scales:{x:{display:true,ticks:{font:{size:11},color:'#9CA3AF'},grid:{display:false}},y:{display:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>fmt(v)},grid:{color:'var(--surface2)'}}}}});
}

// ══════════════════════════════════════════
// RENDER SPORT
// ══════════════════════════════════════════
function renderSport(){
  const A=appData.activities||[];
  const sortDesc=(arr)=>[...arr].sort((a,b)=>b.date.localeCompare(a.date));
  const filtered=sortDesc(actFilter==='all'?A:actFilter==='other'?A.filter(a=>!ACT_KNOWN.includes(a.type)):A.filter(a=>a.type===actFilter));
  const totalMin=A.reduce((s,a)=>s+(a.duration_min||0),0);
  const totalKm=A.filter(a=>a.type==='running').reduce((s,a)=>s+(a.distance_km||0),0);
  const totalCal=A.reduce((s,a)=>s+(a.calories||0),0);
  document.getElementById('sp_total').textContent=A.length;
  document.getElementById('sp_km').textContent=Math.round(totalKm)+' km';
  document.getElementById('sp_time').textContent=fmt(totalMin);
  document.getElementById('sp_cal').textContent=totalCal.toLocaleString('fr-FR');
  renderRunChart('runChartFull',A);
  document.querySelectorAll('#actFilterTabs .filter-tab').forEach(tab=>{const m=(tab.getAttribute('onclick')||'').match(/'([^']+)'/);tab.classList.toggle('active',m&&m[1]===actFilter);});
  document.getElementById('actListFull').innerHTML=filtered.length?filtered.map(actHTML).join(''):'<p style="color:var(--text2);font-size:13px;padding:16px 0">Aucune activité pour ce filtre.</p>';
}
function setActFilter(f){actFilter=f;renderSport();}

// ══════════════════════════════════════════
// RENDER STRESS & FC
// ══════════════════════════════════════════
function renderStressView(){
  const W=appData.wellness||[],Wp=byPeriod(W,curPeriod);
  const sw=Wp.filter(d=>d.stress!=null&&d.stress>=0),hr=Wp.filter(d=>d.minHR);
  const avgS=sw.length?Math.round(sw.reduce((s,d)=>s+d.stress,0)/sw.length):null;
  const avgHR=hr.length?Math.round(hr.reduce((s,d)=>s+d.minHR,0)/hr.length):null;
  const minHR=hr.length?Math.min(...hr.map(d=>d.minHR)):null;
  const bestS=sw.length?Math.min(...sw.map(d=>d.stress)):null;
  document.getElementById('st_avgStress').textContent=avgS!=null?`${avgS} — ${stressInfo(avgS).label}`:'—';
  document.getElementById('st_avgHR').textContent=avgHR!=null?`${avgHR} bpm`:'—';
  document.getElementById('st_minHR').textContent=minHR!=null?`${minHR} bpm`:'—';
  document.getElementById('st_bestStress').textContent=bestS!=null?`${bestS} (${stressInfo(bestS).label})`:'—';
  document.getElementById('stressBadge2').textContent=curPeriod+'j';
  document.getElementById('hrBadge').textContent=curPeriod+'j';

  mkChart('stressChartFull',{type:'line',data:{labels:sw.map(d=>fmtDate(d.date)),datasets:[{label:'Stress',data:sw.map(d=>d.stress),borderColor:'#F59E0B',backgroundColor:'#FEF3C730',borderWidth:2,pointRadius:3,fill:true,tension:.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Stress: ${c.raw} — ${stressInfo(c.raw).label}`}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},y:{display:true,min:0,max:100,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}});
  mkChart('hrRestChart',{type:'line',data:{labels:hr.map(d=>fmtDate(d.date)),datasets:[{label:'FC min (repos)',data:hr.map(d=>d.minHR),borderColor:'#0EA5E9',backgroundColor:'#E0F5FF40',borderWidth:2.5,pointRadius:3,fill:true,tension:.4},{label:'FC max',data:hr.map(d=>d.maxHR||null),borderColor:'#EF444870',backgroundColor:'transparent',borderWidth:1.5,pointRadius:2,fill:false,tension:.4,borderDash:[5,4]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},y:{display:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>`${v} bpm`},grid:{color:'var(--surface2)'}}}}});

  // Body Battery
  const bb=Wp.filter(d=>d.bodyBattery!=null);
  const bbPanel=document.getElementById('bbPanel');
  if(bb.length){
    bbPanel.style.display='block';
    document.getElementById('bbBadge').textContent=curPeriod+'j';
    mkChart('bbChart',{type:'line',data:{labels:bb.map(d=>fmtDate(d.date)),datasets:[{label:'Body Battery',data:bb.map(d=>d.bodyBattery),borderColor:'#22C55E',backgroundColor:'#22C55E20',borderWidth:2.5,pointRadius:3,fill:true,tension:.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Body Battery: ${c.raw}/100`}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},y:{display:true,min:0,max:100,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}});
  } else {
    bbPanel.style.display='none';
  }
}

// ══════════════════════════════════════════
// RENDER OBJECTIFS
// ══════════════════════════════════════════
const GOAL_DEFS={
  steps:{label:'Pas quotidiens',unit:'pas',def:10000,color:'#22C55E',lower:false,
    getVal:(W,S)=>W.length?Math.round(W.reduce((s,d)=>s+(d.steps||0),0)/W.length):0,
    check:(d,t)=>(d.steps||0)>=t},
  sleep:{label:'Sommeil total',unit:'h',def:8,color:'#8B5CF6',lower:false,
    getVal:(W,S)=>S.length?Math.round(S.reduce((s,n)=>s+(n.sleepTotal_min||0),0)/S.length/60*10)/10:0,
    check:(d,t)=>(d.sleepTotal_min||0)/60>=t},
  calories:{label:'Calories brûlées',unit:'kcal',def:2000,color:'#FF6B35',lower:false,
    getVal:(W,S)=>W.length?Math.round(W.reduce((s,d)=>s+(d.calories||0),0)/W.length):0,
    check:(d,t)=>(d.calories||0)>=t},
  stress:{label:'Stress max toléré',unit:'/ 100',def:40,color:'#F59E0B',lower:true,
    getVal:(W,S)=>{const f=W.filter(d=>d.stress>=0);return f.length?Math.round(f.reduce((s,d)=>s+d.stress,0)/f.length):0},
    check:(d,t)=>d.stress>=0&&d.stress<=t},
};
function loadGoals(){try{return JSON.parse(localStorage.getItem(LS_GOALS))||{};}catch{return{};}}
function saveGoal(k,v){const g=loadGoals();g[k]=v;localStorage.setItem(LS_GOALS,JSON.stringify(g));}
function renderGoals(){
  const W=appData.wellness||[],S=appData.sleep||[],Wp=byPeriod(W,curPeriod),Sp=byPeriod(S,curPeriod),saved=loadGoals();
  const gl=document.getElementById('goalList');gl.innerHTML='';
  Object.entries(GOAL_DEFS).forEach(([key,def])=>{
    const target=saved[key]!=null?saved[key]:def.def;
    const val=def.getVal(Wp,Sp);
    const src=key==='sleep'?Sp:key==='stress'?Wp.filter(d=>d.stress>=0):Wp.filter(d=>d[key==='steps'?'steps':'calories']>0);
    const hits=src.filter(d=>def.check(d,target)).length;
    const rate=src.length?Math.round(hits/src.length*100):0;
    const barPct=def.lower?Math.min(100,target/Math.max(val,0.1)*100):Math.min(100,val/target*100);
    const ok=def.lower?val<=target:val>=target;
    gl.innerHTML+=`<div class="goal-item"><div class="goal-header"><div><div class="goal-name">${def.label}</div><div class="goal-val">Moyenne : <b>${Number.isInteger(val)?val.toLocaleString('fr-FR'):val.toFixed(1)} ${def.unit}</b></div></div><div style="display:flex;align-items:center;gap:12px"><div style="text-align:right"><div style="font-size:11px;color:var(--text2);margin-bottom:3px">Objectif</div><div style="display:flex;align-items:center;gap:4px"><input class="goal-input" type="number" value="${target}" min="0" onchange="saveGoal('${key}',parseFloat(this.value)||0);renderGoals()"> ${def.unit}</div></div><span style="font-size:28px;font-weight:800;color:${ok?def.color:'#CBD5E1'}">${ok?'✓':'○'}</span></div></div><div class="goal-bar-bg"><div class="goal-bar" style="width:${Math.max(2,barPct)}%;background:${def.color}"></div></div><div class="goal-rate">Atteint ${rate}% des jours · ${hits}/${src.length} jours</div></div>`;
  });
}

// ══════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════
function openModal(){document.getElementById('overlay').classList.add('open');document.getElementById('clearBtn').style.display=appData?'block':'none';}
function closeModal(){document.getElementById('overlay').classList.remove('open');resetModal();}
function resetModal(){document.getElementById('progressWrap').style.display='none';document.getElementById('progressBar').style.width='0%';document.getElementById('statusOk').style.display='none';document.getElementById('statusErr').style.display='none';document.getElementById('fileInput').value='';}

const dz=document.getElementById('dropZone');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over')});
dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over');const f=e.dataTransfer.files[0];if(f)uploadFile(f)});

async function uploadFile(file){
  if(!file)return;
  const pw=document.getElementById('progressWrap'),pb=document.getElementById('progressBar'),
        pt=document.getElementById('progressText'),ok=document.getElementById('statusOk'),er=document.getElementById('statusErr');
  ok.style.display='none';er.style.display='none';
  pw.style.display='block';pb.style.width='10%';pt.textContent=`Envoi de "${file.name}"…`;
  const fd=new FormData();fd.append('file',file);
  let pct=10;const iv=setInterval(()=>{pct=Math.min(pct+4,85);pb.style.width=pct+'%'},300);
  try{
    const res=await fetch('/api/import',{method:'POST',body:fd});
    clearInterval(iv);pb.style.width='100%';
    const json=await res.json();
    if(!res.ok||json.error){er.textContent='❌ '+json.error;er.style.display='block';return;}
    const s=json.summary;
    ok.textContent=`✓ ${s.wellness} jours · ${s.activities} activités · ${s.sleep} nuits`;
    ok.style.display='block';pt.textContent='Rendu…';
    appData=json.data;
    renderCurrent();
    setTimeout(closeModal,2000);
  }catch{clearInterval(iv);er.textContent='❌ Serveur inaccessible.';er.style.display='block';}
}

function clearData(){
  fetch('/api/import',{method:'POST',body:new FormData()}).catch(()=>{});
  localStorage.removeItem(LS_KEY);appData=null;location.reload();
}

// ══════════════════════════════════════════
// SIDEBAR MOBILE (panneau profil/settings)
// ══════════════════════════════════════════
function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
  document.body.style.overflow='';
}
function toggleSidebar(){
  document.getElementById('sidebar').classList.contains('open')?closeSidebar():openSidebar();
}
// Fermer sidebar quand on change de vue sur mobile
document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
  btn.addEventListener('click',()=>{if(window.innerWidth<=768)closeSidebar();});
});
// Fermer si on passe en mode desktop
window.addEventListener('resize',()=>{if(window.innerWidth>768)closeSidebar();});

// ══════════════════════════════════════════
// BOTTOM NAV — sync active state
// ══════════════════════════════════════════
function syncBottomNav(v){
  document.querySelectorAll('#bottomNav .bnav-item').forEach(b=>{
    b.classList.toggle('active',b.dataset.view===v);
  });
}
// Patch showView pour syncer la bottom nav
const _baseShowView=showView;
showView=function(v){_baseShowView(v);syncBottomNav(v);};

// ══════════════════════════════════════════
// SWIPE GESTURE — bord gauche → ouvre sidebar
// ══════════════════════════════════════════
(function(){
  let tx=0,ty=0,tracking=false;
  document.addEventListener('touchstart',e=>{
    tx=e.touches[0].clientX;ty=e.touches[0].clientY;
    tracking=tx<28; // zone de 28px depuis le bord gauche
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(window.innerWidth>768)return;
    const dx=e.changedTouches[0].clientX-tx;
    const dy=Math.abs(e.changedTouches[0].clientY-ty);
    if(dy>60)return; // mouvement trop vertical
    // Swipe droite depuis le bord → ouvre sidebar
    if(tracking&&dx>55){openSidebar();tracking=false;return;}
    // Swipe gauche sur sidebar ouverte → ferme
    if(document.getElementById('sidebar').classList.contains('open')&&dx<-55){closeSidebar();}
    tracking=false;
  },{passive:true});
})();

// ══════════════════════════════════════════
// PWA — Service Worker + Install Prompt
// ══════════════════════════════════════════
let _installPrompt = null;

// Enregistrement du Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(r => console.log('SW enregistré:', r.scope))
      .catch(e => console.warn('SW échec:', e));
  });
}

// Capturer le prompt d'installation natif
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'flex';
});

// L'app vient d'être installée → cacher le bouton
window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
});

function installPWA() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(r => {
    if (r.outcome === 'accepted') {
      const btn = document.getElementById('installBtn');
      if (btn) btn.style.display = 'none';
    }
    _installPrompt = null;
  });
}

// ══════════════════════════════════════════
// INIT — serveur SQLite en priorité
// ══════════════════════════════════════════
(async function init(){
  // Restore dark mode preference
  const savedTheme=localStorage.getItem(LS_DARK)||'light';
  document.documentElement.setAttribute('data-theme',savedTheme);
  updateDarkBtn(savedTheme);

  // Deep link depuis shortcut PWA (?view=nutrition)
  const viewParam = new URLSearchParams(location.search).get('view');
  const startView = viewParam || 'dashboard';
  showView(startView);
  syncBottomNav(startView);

  // Try server SQLite first (persists across browsers)
  try{
    const res=await fetch('/api/data');
    const json=await res.json();
    if(json.ok&&json.data){appData=json.data;renderCurrent();return;}
  }catch(e){}

  // Fallback to localStorage
  try{const d=localStorage.getItem(LS_KEY);if(d){appData=JSON.parse(d);renderCurrent();}}catch{}
})();

// ══════════════════════════════════════════════════════
// MODULE NUTRITION
// ══════════════════════════════════════════════════════

const MACRO_COLORS={cal:'#FF6B35',prot:'#4A6CF7',gluc:'#22C55E',lip:'#F59E0B'};

// ── Objectifs par type de journée
const DAY_TARGETS={
  dur:          {cal:2900,prot:150,gluc:360,lip:75},
  intermediaire:{cal:2700,prot:150,gluc:300,lip:72},
  facile:       {cal:2500,prot:150,gluc:240,lip:70},
};
const LS_DAY_TYPE='nutri_day_type_v1';
let currentDayType=localStorage.getItem(LS_DAY_TYPE)||'intermediaire';

function selectDayType(type){
  currentDayType=type;
  localStorage.setItem(LS_DAY_TYPE,type);
  document.querySelectorAll('.day-type-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.type===type);
  });
  renderDayTotals(nutriMeals);
}

function syncDayTypeBtns(){
  document.querySelectorAll('.day-type-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.type===currentDayType);
  });
}

// ── Formateur heure depuis ISO string
function fmtTime(iso){
  if(!iso)return'';
  try{const d=new Date(iso);return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}catch{return'';}
}

// ── Donut macros
function renderMacroDonut(canvasId, prot, gluc, lip){
  dc(canvasId);
  const el=document.getElementById(canvasId);
  if(!el)return;
  charts[canvasId]=new Chart(el,{
    type:'doughnut',
    data:{
      labels:['Protéines','Glucides','Lipides'],
      datasets:[{
        data:[prot*4, gluc*4, lip*9], // kcal par macro
        backgroundColor:['#4A6CF7','#22C55E','#F59E0B'],
        borderWidth:0,cutout:'70%'
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${c.raw} kcal`}}}}
  });
}

// ── Render une carte de résultat d'analyse
function renderNutriResult(n, containerId){
  const el=document.getElementById(containerId);
  if(!el)return;
  const confCls='confiance-'+(n.confiance||'basse').toLowerCase();
  const confLbl={haute:'✓ Haute confiance',moyenne:'~ Estimation moyenne',basse:'⚠ Faible confiance'}[n.confiance]||(n.confiance||'');
  const totalKcal=(n.proteines||0)*4+(n.glucides||0)*4+(n.lipides||0)*9;
  const imgHtml=n.image_url
    ?`<img src="${n.image_url}" class="nutri-result-img" alt="repas">`
    :'';
  el.style.display='block';
  el.innerHTML=`
    <div class="panel-full" style="margin-bottom:16px">
      <div class="panel-header">
        <div class="panel-title">
          <svg viewBox="0 0 24 24" fill="var(--green)" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
          Résultat de l'analyse
        </div>
        <span class="nutri-confiance ${confCls}">${confLbl}</span>
      </div>
      <div class="nutri-result-header">
        ${imgHtml}
        <div><div class="nutri-desc">${n.description||'Repas analysé'}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:4px">${fmtTime(n.analyzed_at)||'À l\'instant'}</div></div>
      </div>
      <!-- Macros -->
      <div class="macro-grid">
        <div class="macro-card">
          <div class="macro-val" style="color:${MACRO_COLORS.cal}">${n.calories||0}</div>
          <div class="macro-unit">kcal</div>
          <div class="macro-lbl">Calories</div>
        </div>
        <div class="macro-card">
          <div class="macro-val" style="color:${MACRO_COLORS.prot}">${n.proteines||0}g</div>
          <div class="macro-unit">${Math.round((n.proteines||0)*4)} kcal</div>
          <div class="macro-lbl">Protéines</div>
        </div>
        <div class="macro-card">
          <div class="macro-val" style="color:${MACRO_COLORS.gluc}">${n.glucides||0}g</div>
          <div class="macro-unit">${Math.round((n.glucides||0)*4)} kcal</div>
          <div class="macro-lbl">Glucides</div>
        </div>
        <div class="macro-card">
          <div class="macro-val" style="color:${MACRO_COLORS.lip}">${n.lipides||0}g</div>
          <div class="macro-unit">${Math.round((n.lipides||0)*9)} kcal</div>
          <div class="macro-lbl">Lipides</div>
        </div>
      </div>
      <!-- Donut + légende -->
      <div class="nutri-chart-wrap">
        <div class="nutri-donut"><canvas id="nutriDonutResult"></canvas></div>
        <div class="nutri-legend">
          ${[['Protéines',n.proteines||0,MACRO_COLORS.prot],['Glucides',n.glucides||0,MACRO_COLORS.gluc],['Lipides',n.lipides||0,MACRO_COLORS.lip]]
            .map(([lbl,g,col])=>`<div class="nutri-leg-row">
              <div class="nutri-leg-dot" style="background:${col}"></div>
              <span class="nutri-leg-lbl">${lbl}</span>
              <span class="nutri-leg-val">${g}g</span>
            </div>`).join('')}
          ${n.fibres?`<div class="nutri-leg-row"><div class="nutri-leg-dot" style="background:#94A3B8"></div><span class="nutri-leg-lbl">Fibres</span><span class="nutri-leg-val">${n.fibres}g</span></div>`:''}
        </div>
      </div>
      <!-- Aliments détectés -->
      ${(n.aliments||[]).length?`
      <div style="margin-top:4px">
        <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">Aliments détectés</div>
        <ul class="aliment-list">${(n.aliments||[]).map(a=>`<li class="aliment-item">${a}</li>`).join('')}</ul>
      </div>`:''}
    </div>`;
  setTimeout(()=>renderMacroDonut('nutriDonutResult',n.proteines||0,n.glucides||0,n.lipides||0),50);
}

// ── Totaux du jour — barre objectifs + camemberts
function renderDayTotals(meals){
  const tot={cal:0,prot:0,gluc:0,lip:0};
  meals.forEach(m=>{tot.cal+=m.calories||0;tot.prot+=m.proteines||0;tot.gluc+=m.glucides||0;tot.lip+=m.lipides||0;});
  const targets=DAY_TARGETS[currentDayType]||DAY_TARGETS.intermediaire;
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const emptyCol=isDark?'#334155':'#E5E7EB';
  const RED='#EF4444';

  // ── Barre objectifs
  const objBar=document.getElementById('nutriObjectivesBar');
  if(objBar){
    objBar.innerHTML=`
      <div class="noi"><span class="noi-emoji">🎯</span><span class="noi-val" style="color:${MACRO_COLORS.cal}">${targets.cal}</span><span class="noi-unit">kcal</span></div>
      <div class="noi-sep"></div>
      <div class="noi"><span class="noi-emoji">🥩</span><span class="noi-val" style="color:${MACRO_COLORS.prot}">${targets.prot}g</span><span class="noi-unit">protéines</span></div>
      <div class="noi-sep"></div>
      <div class="noi"><span class="noi-emoji">🍞</span><span class="noi-val" style="color:${MACRO_COLORS.gluc}">${targets.gluc}g</span><span class="noi-unit">glucides</span></div>
      <div class="noi-sep"></div>
      <div class="noi"><span class="noi-emoji">🥑</span><span class="noi-val" style="color:${MACRO_COLORS.lip}">${targets.lip}g</span><span class="noi-unit">lipides</span></div>`;
  }

  // ── Camemberts
  const defs=[
    {id:'cal', val:tot.cal, unit:'kcal', col:MACRO_COLORS.cal,  max:targets.cal},
    {id:'prot',val:tot.prot,unit:'g',    col:MACRO_COLORS.prot, max:targets.prot},
    {id:'gluc',val:tot.gluc,unit:'g',    col:MACRO_COLORS.gluc, max:targets.gluc},
    {id:'lip', val:tot.lip, unit:'g',    col:MACRO_COLORS.lip,  max:targets.lip},
  ];

  defs.forEach(d=>{
    const pct   =Math.min(100,Math.round(d.val/d.max*100));
    const over  =d.val>d.max;
    const remain=Math.max(0,d.max-d.val);
    const col   =over?RED:d.col;

    // Centre %
    const pctEl=document.getElementById('dcp-'+d.id);
    if(pctEl){
      pctEl.innerHTML=`<span style="color:${col};font-size:17px;font-weight:800">${pct}%</span>`;
    }

    // Texte restant
    const remEl=document.getElementById('dr-'+d.id);
    if(remEl){
      remEl.style.color=over?RED:'';
      remEl.textContent=over?`+${d.val-d.max} ${d.unit} excès`:`${remain} ${d.unit} restants`;
    }

    // Graphe
    dc('dc-'+d.id);
    const canvas=document.getElementById('dc-'+d.id);
    if(!canvas)return;
    charts['dc-'+d.id]=new Chart(canvas,{
      type:'doughnut',
      data:{datasets:[{
        data:[d.val, Math.max(0,d.max-d.val)],
        backgroundColor:[col, emptyCol],
        borderWidth:0,
        cutout:'76%',
      }]},
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{enabled:false}},
        animation:{duration:500},
      }
    });
  });

  syncDayTypeBtns();
}

// ── Historique repas
function renderMealHistory(meals){
  const el=document.getElementById('mealHistory');
  if(!el)return;
  if(!meals.length){el.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg><h3>Aucun repas analysé aujourd'hui</h3><p>Prenez une photo d'un repas pour commencer</p></div>`;return;}
  el.innerHTML=meals.map(m=>{
    const imgHtml=m.image_file
      ?`<img src="/static/meals/${m.image_file}" class="meal-thumb" alt="${m.description}">`
      :`<div class="meal-thumb-placeholder">🍽</div>`;
    return`<div class="meal-card" id="meal-${m.id}">
      ${imgHtml}
      <div class="meal-info">
        <div class="meal-name">${m.description||'Repas'}</div>
        <div class="meal-time">${fmtTime(m.analyzed_at)}</div>
        <div class="meal-macros">
          <span class="meal-macro-pill" style="background:${MACRO_COLORS.cal}22;color:${MACRO_COLORS.cal}">${m.calories} kcal</span>
          <span class="meal-macro-pill" style="background:${MACRO_COLORS.prot}22;color:${MACRO_COLORS.prot}">P ${m.proteines}g</span>
          <span class="meal-macro-pill" style="background:${MACRO_COLORS.gluc}22;color:${MACRO_COLORS.gluc}">G ${m.glucides}g</span>
          <span class="meal-macro-pill" style="background:${MACRO_COLORS.lip}22;color:${MACRO_COLORS.lip}">L ${m.lipides}g</span>
        </div>
      </div>
      <button class="meal-delete" onclick="deleteMeal(${m.id})" title="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>`;
  }).join('');
}

// ── Vue principale Nutrition
async function renderNutritionView(){
  await loadNutritionHistory();
}

async function loadNutritionHistory(){
  const today=new Date().toISOString().slice(0,10);
  try{
    const r=await fetch(`/api/meals?date=${today}`);
    const j=await r.json();
    nutriMeals=j.ok?j.meals:[];
    renderDayTotals(nutriMeals);
    renderMealHistory(nutriMeals);
  }catch{nutriMeals=[];renderMealHistory([]);}
}

// ── Supprimer un repas
async function deleteMeal(id){
  if(!confirm('Supprimer ce repas ?'))return;
  await fetch(`/api/meals/${id}`,{method:'DELETE'});
  const el=document.getElementById('meal-'+id);
  if(el)el.remove();
  nutriMeals=nutriMeals.filter(m=>m.id!==id);
  renderDayTotals(nutriMeals);
  if(!nutriMeals.length)renderMealHistory([]);
}

// ── Compression image avant envoi (max 4 MB, max 1600px)
function compressImage(file, maxBytes=4*1024*1024, maxDim=1600){
  return new Promise(resolve=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let {width:w,height:h}=img;
      // Réduire dimensions si trop grandes
      if(w>maxDim||h>maxDim){
        if(w>h){h=Math.round(h*maxDim/w);w=maxDim;}
        else{w=Math.round(w*maxDim/h);h=maxDim;}
      }
      const canvas=document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      // Réduire qualité jusqu'à passer sous maxBytes
      let quality=0.85;
      const tryExport=()=>{
        canvas.toBlob(blob=>{
          if(!blob){resolve(file);return;}
          if(blob.size<=maxBytes||quality<=0.3){
            resolve(new File([blob],file.name,{type:'image/jpeg'}));
          } else {
            quality-=0.1;
            tryExport();
          }
        },'image/jpeg',quality);
      };
      tryExport();
    };
    img.onerror=()=>resolve(file); // fallback sans compression
    img.src=url;
  });
}

// ── Upload & analyse photo
async function analyzePhoto(file){
  if(!file)return;
  const preview=document.getElementById('nutriPreview');
  const loading=document.getElementById('nutriLoading');
  const result=document.getElementById('nutriResultWrap');
  const errEl=document.getElementById('nutriErr');

  // Preview immédiat
  const reader=new FileReader();
  reader.onload=e=>{preview.src=e.target.result;preview.style.display='block';};
  reader.readAsDataURL(file);

  // Reset UI
  if(result)result.style.display='none';
  if(errEl){errEl.style.display='none';errEl.textContent='';}
  loading.style.display='block';

  // Compression si > 4 MB
  if(file.size > 4*1024*1024){
    file = await compressImage(file);
  }

  const fd=new FormData();
  fd.append('file',file);
  try{
    const res=await fetch('/api/analyze-meal',{method:'POST',body:fd});
    const j=await res.json();
    loading.style.display='none';
    if(!res.ok||j.error){
      if(errEl){errEl.textContent='❌ '+j.error;errEl.style.display='block';}
      return;
    }
    renderNutriResult(j.nutrition,'nutriResultWrap');
    // Rafraîchir l'historique
    nutriMeals.unshift(j.nutrition);
    renderDayTotals(nutriMeals);
    renderMealHistory(nutriMeals);
  }catch(e){
    loading.style.display='none';
    if(errEl){errEl.textContent='❌ Serveur inaccessible.';errEl.style.display='block';}
  }
}

// ── Basculer onglets Photo / Texte
function switchNutriTab(tab){
  document.getElementById('tabPhoto').classList.toggle('active', tab==='photo');
  document.getElementById('tabText').classList.toggle('active',  tab==='text');
  document.getElementById('nutriPanelPhoto').style.display = tab==='photo' ? '' : 'none';
  document.getElementById('nutriPanelText').style.display  = tab==='text'  ? '' : 'none';
}

// ── Remplir un exemple dans la textarea
function fillExample(txt){
  const ta=document.getElementById('nutriTextInput');
  if(ta){ ta.value=txt; ta.focus(); }
}

// ── Analyser un repas saisi en texte
async function analyzeMealText(){
  const ta=document.getElementById('nutriTextInput');
  const text=(ta?.value||'').trim();
  if(!text){ ta?.focus(); return; }

  const loading=document.getElementById('nutriLoading');
  const loadTxt=document.getElementById('nutriLoadingTxt');
  const result =document.getElementById('nutriResultWrap');
  const errEl  =document.getElementById('nutriErr');

  if(result) result.style.display='none';
  if(errEl){ errEl.style.display='none'; errEl.textContent=''; }
  if(loadTxt) loadTxt.textContent='OpenAI analyse votre repas…';
  loading.style.display='block';

  try{
    const res=await fetch('/api/analyze-meal-text',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({description: text})
    });
    const j=await res.json();
    loading.style.display='none';
    if(!res.ok||j.error){
      if(errEl){ errEl.textContent='❌ '+j.error; errEl.style.display='block'; }
      return;
    }
    renderNutriResult(j.nutrition,'nutriResultWrap');
    nutriMeals.unshift(j.nutrition);
    renderDayTotals(nutriMeals);
    renderMealHistory(nutriMeals);
    ta.value='';
  }catch(e){
    loading.style.display='none';
    if(errEl){ errEl.textContent='❌ Serveur inaccessible.'; errEl.style.display='block'; }
  }
}

// ── Init drag-and-drop zone nutrition
function initNutriDrop(){
  const dz=document.getElementById('nutriDropZone');
  const inp=document.getElementById('nutriFileInput');
  if(!dz||!inp)return;
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over')});
  dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over');const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('image/'))analyzePhoto(f);});
  inp.addEventListener('change',()=>{if(inp.files[0])analyzePhoto(inp.files[0]);});
}
// Init au chargement
document.addEventListener('DOMContentLoaded', ()=>{
  initNutriDrop();
  initGarminSync();
  loadTrainingPlan();
});

// ══════════════════════════════════════
// PLANNING — TRAINING WEEK
// ══════════════════════════════════════
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

// ── Génère les 7 prochains jours à partir d'aujourd'hui
function get7Days(){
  const DAY_FR=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const days=[];
  const today=new Date();
  for(let i=0;i<7;i++){
    const d=new Date(today);
    d.setDate(today.getDate()+i);
    days.push({
      dayName: DAY_FR[d.getDay()],
      dayNum:  d.getDate(),
      month:   d.getMonth()+1,
      isToday: i===0,
      date:    d,
    });
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
      renderView(curView);
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
