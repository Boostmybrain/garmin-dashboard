// ── dashboard.js — Tableau de bord : forme du jour, heatmap, comparaison, alertes, rapport ──

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
    const wk=localISO(mon);
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
  const paceStr=(a.distance_km>0&&a.duration_min>0)?
    (p=>{return Math.floor(p)+"'"+String(Math.round((p%1)*60)).padStart(2,'0')+'"'})(a.duration_min/a.distance_km)
    :'';
  return `<div class="act-item"><div class="act-ic" style="background:${ic.bg}">${ic.svg}</div><div class="act-info"><div class="act-name">${typeLabel(a.type)}</div><div class="act-date">${fmtDate(a.date)}${a.name&&a.name!==a.type?' · '+a.name:''}</div></div><div class="act-stats">${a.distance_km>0?`<div class="act-stat"><span class="v">${a.distance_km} km</span><span class="l">Distance</span></div>`:''}<div class="act-stat"><span class="v">${a.duration_min} min</span><span class="l">Durée</span></div>${a.avgHR?`<div class="act-stat"><span class="v">${a.avgHR} bpm</span><span class="l">FC moy</span></div>`:''  }${paceStr?`<div class="act-stat"><span class="v">${paceStr}/km</span><span class="l">Allure moy</span></div>`:''  }${a.calories?`<div class="act-stat"><span class="v">${a.calories} kcal</span><span class="l">Cal dépensées</span></div>`:''}</div></div>`;
}
const EMPTY=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Aucune donnée</h3><p>Importez un fichier Garmin</p></div>`;

// ══════════════════════════════════════════
// FORME DU JOUR — sommeil, stress, FC repos et charge d'entraînement
// ══════════════════════════════════════════
// Fraîcheur d'entraînement : CTL (42 j) − ATL (7 j), TSS estimé depuis la FC moyenne
function trainingFreshness(A){
  const refMax=Math.max(...A.filter(a=>a.maxHR).map(a=>a.maxHR),185);
  const tssMap={};
  A.forEach(a=>{
    const intensity=a.avgHR?Math.min(1,a.avgHR/refMax):0.65;
    tssMap[a.date]=(tssMap[a.date]||0)+a.duration_min*intensity*intensity*100/60;
  });
  const k_ctl=1-Math.exp(-1/42),k_atl=1-Math.exp(-1/7);
  let ctl=0,atl=0;
  for(let i=179;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const tss=tssMap[localISO(d)]||0;
    ctl+=k_ctl*(tss-ctl);atl+=k_atl*(tss-atl);
  }
  return ctl-atl;
}

// Récupération (sommeil, stress, FC repos vs ta propre référence) + charge d'entraînement.
function dayAssessment(W,S,A){
  const l=W.length?W[W.length-1]:{},ls=S.length?S[S.length-1]:{};
  const sleep=Math.min(30,(ls.sleepTotal_min||0)/480*30);
  const stress=(l.stress!=null&&l.stress>=0)?(100-l.stress)/100*30:15;
  // FC repos : écart à la médiane des 30 jours précédents (−4 pts par bpm au-dessus)
  const past=W.slice(-31,-1).map(rhr).filter(v=>v).sort((a,b)=>a-b);
  const base=past.length>=5?past[Math.floor(past.length/2)]:null;
  let hr=10;
  if(rhr(l)) hr=base?Math.max(0,Math.min(20,20-Math.max(0,rhr(l)-base)*4)):Math.max(0,Math.min(20,(80-rhr(l))/30*20));
  const freshness=trainingFreshness(A);
  const load=Math.max(0,Math.min(20,10+freshness/2));
  const total=Math.round(sleep+stress+hr+load);
  const lvl=total>=80?0:total>=60?1:total>=40?2:3;
  return{
    total,freshness,
    parts:{sleep:Math.round(sleep),stress:Math.round(stress),hr:Math.round(hr),load:Math.round(load)},
    label:['Excellent','Bon','Moyen','Fatigué'][lvl],
    color:['#4A6CF7','#22C55E','#F59E0B','#EF4444'][lvl],
    desc:['Excellente récupération — séance intense possible.','Bonne forme — entraînement normal.','Forme moyenne — séance légère ou modérée.','Récupération insuffisante — repos ou récupération active.'][lvl],
    reco:['💪 Séance intense possible aujourd\'hui','✅ Entraînement normal aujourd\'hui','⚡ Séance légère ou modérée aujourd\'hui','🛌 Récupération recommandée aujourd\'hui'][lvl],
  };
}

function renderScore(W,S,A){
  const sc=dayAssessment(W,S,A);
  document.getElementById('scoreCard').style.display='flex';
  document.getElementById('scoreVal').textContent=sc.total;
  document.getElementById('sc_sleep').textContent=sc.parts.sleep+'/30';
  document.getElementById('sc_stress').textContent=sc.parts.stress+'/30';
  document.getElementById('sc_hr').textContent=sc.parts.hr+'/20';
  document.getElementById('sc_load').textContent=sc.parts.load+'/20';
  document.getElementById('scoreLabel').textContent=`Forme du jour : ${sc.label}`;
  document.getElementById('scoreDesc').textContent=sc.desc;
  mkChart('scoreRing',{type:'doughnut',data:{labels:['Score','Reste'],datasets:[{data:[sc.total,100-sc.total],backgroundColor:[sc.color,'var(--surface2)'],borderWidth:0,cutout:'78%'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:false}},animation:{duration:600}}});

  // Chiffres du jour, en texte simple sous le verdict
  const last=W.length?W[W.length-1]:{},ls=S.length?S[S.length-1]:{};
  const nb=v=>v!=null?v.toLocaleString('fr-FR'):'—';
  const si=stressInfo(last.stress);
  const lines=[
    {ic:'😴',lbl:'Sommeil',     val:fmt(ls.sleepTotal_min),                  sub:'dernière nuit'},
    {ic:'🔥',lbl:'Calories',    val:nb(last.calories)+' kcal',               sub:'brûlées'},
    {ic:'👟',lbl:'Pas',         val:nb(last.steps),                          sub:'aujourd\'hui'},
    {ic:'❤️',lbl:'FC min / max',val:(rhr(last)||'—')+' bpm',                 sub:`FC repos · max : ${last.maxHR||'—'} bpm`},
    {ic:'🧠',lbl:'Stress',      val:last.stress>=0?last.stress:'—',          sub:si.label},
  ];
  document.getElementById('scoreLines').innerHTML=lines.map(x=>
    `<div class="score-line"><span class="score-line-ic">${x.ic}</span><span class="score-line-lbl">${x.lbl}</span><span class="score-line-txt"><span class="score-line-val">${x.val}</span> <span class="score-line-sub">${x.sub}</span></span></div>`
  ).join('');
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
      const key=localISO(d);
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
// N derniers jours vs les N précédents, découpés par date.
// completeDaysOnly : la journée en cours (pas, calories partiels) est exclue,
// la fenêtre finit alors hier. Les nuits et séances d'aujourd'hui sont complètes.
function rollingWindows(arr,n,completeDaysOnly=false){
  const dayStr=k=>{const d=new Date();d.setDate(d.getDate()-k);return localISO(d);};
  const shift=completeDaysOnly?1:0;
  const end=dayStr(shift-1), t0=dayStr(n+shift), t1=dayStr(2*n+shift);
  // fenêtre courante : ]t0, end[   fenêtre précédente : ]t1, t0]
  return{
    curr:arr.filter(d=>d.date>t0&&d.date<end),
    prev:arr.filter(d=>d.date>t1&&d.date<=t0),
  };
}
function renderComparison(W,S){
  const panel=document.getElementById('compPanel');
  if(!W.length){panel.style.display='none';return;}
  panel.style.display='block';
  document.getElementById('compBadge').textContent=`${curPeriod} derniers jours vs ${curPeriod} précédents`;

  const {curr,prev}=rollingWindows(W,curPeriod,true);
  const {curr:currS,prev:prevS}=rollingWindows(S,curPeriod);
  const avg=(arr,k)=>{const f=arr.filter(d=>d[k]!=null&&d[k]>0);return f.length?f.reduce((s,d)=>s+d[k],0)/f.length:0};

  const nf=(v,dec)=>v.toLocaleString('fr-FR',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const metrics=[
    {id:'steps',  label:'Pas moy.',     unit:'k',    dec:1, curr:avg(curr,'steps')/1000,        prev:avg(prev,'steps')/1000,        col:'#4A6CF7',lowerBetter:false},
    {id:'sleep',  label:'Sommeil moy.', unit:'h',    dec:1, curr:avg(currS,'sleepTotal_min')/60, prev:avg(prevS,'sleepTotal_min')/60, col:'#8B5CF6',lowerBetter:false},
    {id:'cal',    label:'Calories moy.',unit:'kcal', dec:0, curr:avg(curr,'calories'),          prev:avg(prev,'calories'),          col:'#FF6B35',lowerBetter:false},
    {id:'stress', label:'Stress moy.',  unit:'',     dec:0, curr:avg(curr.filter(d=>d.stress>=0),'stress'),prev:avg(prev.filter(d=>d.stress>=0),'stress'),col:'#F59E0B',lowerBetter:true},
  ].map(m=>{
    const delta=m.prev?(m.curr-m.prev)/m.prev*100:null;
    const better=delta==null?null:(m.lowerBetter?delta<0:delta>0);
    const fmtV=v=>`${nf(v,m.dec)}${m.unit?' '+m.unit:''}`;
    return{...m,delta,fmtV,deltaCol:delta==null||Math.round(delta)===0?'#94A3B8':better?'#22C55E':'#EF4444'};
  });

  const grid=document.getElementById('compGrid');
  grid.innerHTML=metrics.map(m=>{
    const arrow=m.delta>0?'↑':m.delta<0?'↓':'→';
    const barPct=m.prev?Math.min(100,m.curr/m.prev*100):100;
    const deltaTxt=m.delta==null?'—':`${arrow} ${Math.abs(Math.round(m.delta))}%`;
    return`<div class="cmp-card">
      <div class="cmp-label">${m.label}</div>
      <div class="cmp-row"><span class="cmp-val">${m.fmtV(m.curr)}</span><span style="color:${m.deltaCol};font-weight:700;font-size:13px">${deltaTxt}</span></div>
      <div class="cmp-prev">Préc. : ${m.prev?m.fmtV(m.prev):'pas de données'}</div>
      <div class="cmp-bar-bg"><div class="cmp-bar-curr" style="width:${barPct}%;background:${m.col}"></div></div>
    </div>`;
  }).join('');

  // Variation en % : une seule unité pour les 4 mesures. Les valeurs brutes
  // (≈ 2 500 kcal contre 8,8 k pas) rendaient 3 barres sur 4 invisibles.
  const withPrev=metrics.filter(m=>m.delta!=null);
  const maxAbs=Math.max(10,...withPrev.map(m=>Math.ceil(Math.abs(m.delta)/5)*5));
  mkChart('compChart',{type:'bar',data:{
    labels:withPrev.map(m=>m.label),
    datasets:[{
      label:'Variation',
      data:withPrev.map(m=>+m.delta.toFixed(1)),
      backgroundColor:withPrev.map(m=>m.deltaCol+'CC'),
      borderColor:withPrev.map(m=>m.deltaCol),
      borderWidth:1.5,borderRadius:6,barThickness:22,
    }]
  },options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>{const m=withPrev[c.dataIndex];return`${m.delta>0?'+':''}${nf(m.delta,1)} %  (${m.fmtV(m.curr)} vs ${m.fmtV(m.prev)})`;}}}},
    scales:{
      x:{min:-maxAbs,max:maxAbs,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>`${v>0?'+':''}${v} %`},
        grid:{color:c=>c.tick.value===0?'#94A3B8':cssVar('--surface2'),lineWidth:c=>c.tick.value===0?1.5:1}},
      y:{ticks:{font:{size:11},color:'#6B7280'},grid:{display:false}},
    }}});
}

// ══════════════════════════════════════════
// RENDER DASHBOARD
// ══════════════════════════════════════════
function renderDashboard(){
  const W=appData.wellness||[],A=appData.activities||[],S=appData.sleep||[],C=appData.customer||{};
  const Wp=byPeriod(W,curPeriod);

  if(C.firstName){document.getElementById('userName').textContent=C.firstName;document.getElementById('avatarInitial').textContent=C.firstName[0].toUpperCase();}

  renderScore(W,S,A);
  renderAlerts(W,S,A);
  renderWeeklyReport(W,S,A);
  renderHeatmap(W);
  renderComparison(W,S);

  document.getElementById('actList').innerHTML=A.length?[...A].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(actHTML).join(''):EMPTY;
  document.getElementById('actBadge').textContent=A.length?`${A.length} séances`:'—';

  document.getElementById('stepsChartBadge').textContent=curPeriod+'j';
  document.getElementById('stressChartBadge').textContent=curPeriod+'j';

  mkChart('stepsChart',{type:'bar',data:{labels:Wp.map(d=>fmtDate(d.date)),datasets:[{label:'Pas',data:Wp.map(d=>d.steps),backgroundColor:Wp.map(d=>d.steps>=10000?'#22C55E55':d.steps>=7500?'#4A6CF755':'#94A3B855'),borderColor:Wp.map(d=>d.steps>=10000?'#22C55E':d.steps>=7500?'#4A6CF7':'#94A3B8'),borderWidth:1.5,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw.toLocaleString('fr-FR')} pas`}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},y:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}});

  const sw=Wp.filter(d=>d.stress!=null&&d.stress>=0);
  mkChart('stressChart',{type:'line',data:{labels:sw.map(d=>fmtDate(d.date)),datasets:[{label:'Stress',data:sw.map(d=>d.stress),borderColor:'#F59E0B',backgroundColor:'#FEF3C722',borderWidth:2,pointRadius:2,fill:true,tension:.4,yAxisID:'y'},{label:'FC repos',data:sw.map(d=>rhr(d)||null),spanGaps:true,borderColor:'#0EA5E9',backgroundColor:'transparent',borderWidth:2,pointRadius:2,fill:false,tension:.4,yAxisID:'y2'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},y:{display:true,position:'left',ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'},min:0,max:100},y2:{display:true,position:'right',ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}}}}});

  renderRunChart('runChart',A);
}

// ══════════════════════════════════════════
// ALERTES DASHBOARD
// ══════════════════════════════════════════
function renderAlerts(W,S,A){
  const panel=document.getElementById('alertsPanel');if(!panel)return;
  const alerts=[];
  const last=W.length?W[W.length-1]:{};
  const ls=S.length?S[S.length-1]:{};
  // Sommeil court
  if(ls.sleepTotal_min>0&&ls.sleepTotal_min<360) alerts.push({type:'warn',msg:`Sommeil court hier : ${fmt(ls.sleepTotal_min)}`});
  // Stress élevé
  if(last.stress>=0&&last.stress>70) alerts.push({type:'danger',msg:`Stress élevé : ${last.stress}/100`});
  // Peu de pas
  if(last.steps>0&&last.steps<3000) alerts.push({type:'info',msg:`Peu de pas : ${last.steps.toLocaleString('fr-FR')}`});
  // FC repos anormale
  if(rhr(last)&&W.length>=7){
    const avgRHR=Math.round(W.slice(-14).filter(d=>rhr(d)).reduce((s,d)=>s+rhr(d),0)/W.slice(-14).filter(d=>rhr(d)).length);
    if(rhr(last)>avgRHR+8) alerts.push({type:'warn',msg:`FC repos élevée : ${rhr(last)} bpm (moy. ${avgRHR})`});
  }
  if(!alerts.length){panel.style.display='none';return;}
  panel.style.display='block';
  panel.innerHTML=`<div class="alerts-strip">${alerts.map(a=>`<span class="alert-pill alert-${a.type}">${a.msg}</span>`).join('')}</div>`;
}

// ══════════════════════════════════════════
// RAPPORT HEBDOMADAIRE
// ══════════════════════════════════════════
function renderWeeklyReport(W,S,A){
  const panel=document.getElementById('weeklyPanel');if(!panel)return;
  // 7 derniers jours glissants vs les 7 d'avant : une semaine calendaire
  // comparait un lundi seul à une semaine pleine.
  const {curr:thisW,prev:prevW}=rollingWindows(W,7,true);
  const {curr:thisSl,prev:prevSl}=rollingWindows(S,7);
  const {curr:thisA,prev:prevA}=rollingWindows(A,7);
  const avg=(arr,k)=>{const f=arr.filter(d=>d[k]>0);return f.length?f.reduce((s,d)=>s+d[k],0)/f.length:0;};
  const thisRuns=thisA.filter(a=>a.type==='running');
  const prevRuns=prevA.filter(a=>a.type==='running');

  const metrics=[
    {lbl:'Pas / jour',curr:avg(thisW,'steps'),prev:avg(prevW,'steps'),fmt:v=>Math.round(v).toLocaleString('fr-FR'),lower:false},
    {lbl:'Sommeil',curr:avg(thisSl,'sleepTotal_min'),prev:avg(prevSl,'sleepTotal_min'),fmt:v=>fmt(Math.round(v)),lower:false},
    {lbl:'Sorties course',curr:thisRuns.length,prev:prevRuns.length,fmt:v=>v+' séances',lower:false},
    {lbl:'Km courus',curr:thisRuns.reduce((s,a)=>s+(a.distance_km||0),0),prev:prevRuns.reduce((s,a)=>s+(a.distance_km||0),0),fmt:v=>v.toLocaleString('fr-FR',{minimumFractionDigits:1,maximumFractionDigits:1})+' km',lower:false},
    {lbl:'Stress moy.',curr:avg(thisW.filter(d=>d.stress>=0),'stress'),prev:avg(prevW.filter(d=>d.stress>=0),'stress'),fmt:v=>Math.round(v)||'—',lower:true},
    {lbl:'FC repos moy.',curr:avg(thisW.filter(d=>rhr(d)),d=>rhr(d)),prev:avg(prevW.filter(d=>rhr(d)),d=>rhr(d)),fmt:v=>Math.round(v)?Math.round(v)+' bpm':'—',lower:true},
  ];
  // fix: avg for rhr needs special handling
  const avgRHR=(arr)=>{const f=arr.filter(d=>rhr(d));return f.length?f.reduce((s,d)=>s+rhr(d),0)/f.length:0;};
  metrics[5].curr=avgRHR(thisW);metrics[5].prev=avgRHR(prevW);

  if(!thisW.length&&!thisA.length){panel.style.display='none';return;}
  const badge=document.getElementById('weeklyBadge');
  if(badge) badge.textContent='7 derniers jours vs 7 précédents';
  panel.style.display='block';
  const grid=document.getElementById('weeklyGrid');if(!grid)return;
  grid.innerHTML=metrics.map(m=>{
    const delta=m.prev>0?(m.curr-m.prev)/m.prev*100:0;
    const better=m.lower?delta<=0:delta>=0;
    const col=Math.abs(delta)<1?'#94A3B8':better?'#22C55E':'#EF4444';
    const arrow=delta>1?'↑':delta<-1?'↓':'→';
    return`<div class="weekly-card">
      <div class="wk-lbl">${m.lbl}</div>
      <div class="wk-val">${m.fmt(m.curr)}</div>
      <div class="wk-prev">Préc. : ${m.fmt(m.prev)}</div>
      <div class="wk-delta" style="color:${col}">${arrow} ${Math.abs(Math.round(delta))}%</div>
    </div>`;
  }).join('');
}
