// ── dashboard.js — Tableau de bord : score, records, heatmap, comparaison, alertes, rapport ──

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
  const paceStr=(a.distance_km>0&&a.duration_min>0)?
    (p=>{return Math.floor(p)+"'"+String(Math.round((p%1)*60)).padStart(2,'0')+'"'})(a.duration_min/a.distance_km)
    :'';
  return `<div class="act-item"><div class="act-ic" style="background:${ic.bg}">${ic.svg}</div><div class="act-info"><div class="act-name">${typeLabel(a.type)}</div><div class="act-date">${fmtDate(a.date)}${a.name&&a.name!==a.type?' · '+a.name:''}</div></div><div class="act-stats">${a.distance_km>0?`<div class="act-stat"><span class="v">${a.distance_km} km</span><span class="l">Distance</span></div>`:''}<div class="act-stat"><span class="v">${a.duration_min} min</span><span class="l">Durée</span></div>${a.avgHR?`<div class="act-stat"><span class="v">${a.avgHR} bpm</span><span class="l">FC moy</span></div>`:''  }${paceStr?`<div class="act-stat"><span class="v">${paceStr}/km</span><span class="l">Allure moy</span></div>`:''  }${a.calories?`<div class="act-stat"><span class="v">${a.calories} kcal</span><span class="l">Cal dépensées</span></div>`:''}</div></div>`;
}
const EMPTY=`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><h3>Aucune donnée</h3><p>Importez un fichier Garmin</p></div>`;

// ══════════════════════════════════════════
// SCORE
// ══════════════════════════════════════════
function calcScore(W,S){
  const l=W.length?W[W.length-1]:{},ls=S.length?S[S.length-1]:{};
  const slSc=Math.min(30,(ls.sleepTotal_min||0)/480*30);
  const stSc=(l.stress!=null&&l.stress>=0)?(100-l.stress)/100*30:15;
  const hrSc=rhr(l)?Math.max(0,Math.min(20,(80-rhr(l))/30*20)):10;
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
  const lowestHR=W.filter(d=>rhr(d)).reduce((b,d)=>rhr(d)<rhr(b)?d:b,{restingHR:null,minHR:999});
  const bestSleep=S.reduce((b,s)=>s.sleepTotal_min>b.sleepTotal_min?s:b,{sleepTotal_min:0});
  const maxCal=W.reduce((b,d)=>d.calories>b.calories?d:b,{calories:0});
  const longestAct=A.reduce((b,a)=>a.duration_min>b.duration_min?a:b,{duration_min:0});

  const recs=[
    {icon:'👟',val:maxStepDay.steps?(maxStepDay.steps/1000).toFixed(1)+'k':'—',lbl:'Record pas'},
    {icon:'🏃',val:bestRun.distance_km?bestRun.distance_km+' km':'—',lbl:'Meilleure course'},
    {icon:'❤️',val:rhr(lowestHR)&&rhr(lowestHR)<999?rhr(lowestHR)+' bpm':'—',lbl:'FC repos min'},
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
// WIDGET RÉSUMÉ DU JOUR
// ══════════════════════════════════════════
function renderDaySummary(W,S,A){
  const card=document.getElementById('daySummaryCard');if(!card)return;
  if(!W.length&&!S.length){card.style.display='none';return;}
  card.style.display='flex';
  // Date du jour
  const today=new Date();
  const days=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const months=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  document.getElementById('dscDate').textContent=`${days[today.getDay()]} ${today.getDate()} ${months[today.getMonth()]}`;
  // Stats du dernier jour
  const lw=W.length?W[W.length-1]:{};
  const ls=S.length?S[S.length-1]:{};
  document.getElementById('dscSteps').textContent=lw.steps?Math.round(lw.steps/1000*10)/10+'k':'—';
  document.getElementById('dscSleep').textContent=ls.sleepTotal_min?fmt(ls.sleepTotal_min):'—';
  document.getElementById('dscHR').textContent=rhr(lw)?rhr(lw)+' bpm':'—';
  document.getElementById('dscStress2').textContent=lw.stress>=0?lw.stress:'—';
  // Recommandation basée sur freshness CTL/ATL + sommeil + stress
  const refMax=Math.max(...A.filter(a=>a.maxHR).map(a=>a.maxHR),185);
  const tssMap={};
  A.forEach(a=>{
    const intensity=a.avgHR?Math.min(1,a.avgHR/refMax):0.65;
    const tss=a.duration_min*intensity*intensity*100/60;
    tssMap[a.date]=(tssMap[a.date]||0)+tss;
  });
  const k_ctl=1-Math.exp(-1/42),k_atl=1-Math.exp(-1/7);
  let ctl=0,atl=0;
  for(let i=89;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const ds=d.toISOString().slice(0,10);
    const tss=tssMap[ds]||0;
    ctl+=k_ctl*(tss-ctl);atl+=k_atl*(tss-atl);
  }
  const freshness=ctl-atl;
  const sleepH=(ls.sleepTotal_min||0)/60;
  const stress=lw.stress>=0?lw.stress:50;
  let reco='';
  if(freshness>10&&sleepH>=7&&stress<50) reco='💪 Bonne fenêtre — séance intense possible';
  else if(freshness<-15||sleepH<5.5||stress>65) reco='🛌 Récupération recommandée aujourd\'hui';
  else if(freshness<-5||sleepH<6.5) reco='⚡ Séance légère ou modérée conseillée';
  else reco='✅ Forme correcte — entraînement normal';
  document.getElementById('dscReco').textContent=reco;
}

// ══════════════════════════════════════════
// RENDER DASHBOARD
// ══════════════════════════════════════════
function renderDashboard(){
  const W=appData.wellness||[],A=appData.activities||[],S=appData.sleep||[],C=appData.customer||{};
  const Wp=byPeriod(W,curPeriod),Sp=byPeriod(S,curPeriod);

  renderDaySummary(W,S,A);

  if(C.firstName){document.getElementById('userName').textContent=C.firstName;document.getElementById('avatarInitial').textContent=C.firstName[0].toUpperCase();}

  renderScore(W,S);
  renderAlerts(W,S,A);
  renderWeeklyReport(W,S,A);
  renderRecords(W,A,S);
  renderHeatmap(W);
  renderComparison(W,S);

  const last=W.length?W[W.length-1]:{},ls=S.length?S[S.length-1]:{};
  document.getElementById('kSleep').textContent=fmt(ls.sleepTotal_min);
  document.getElementById('kCal').textContent=(last.calories||0).toLocaleString('fr-FR');
  document.getElementById('kSteps').textContent=(last.steps||0).toLocaleString('fr-FR');
  document.getElementById('kHR').innerHTML=`${rhr(last)||'—'}<span style="font-size:14px;font-weight:400;color:var(--text2)"> bpm</span>`;
  document.getElementById('kHRsub').textContent=`FC repos · max : ${last.maxHR||'—'} bpm`;
  const si=stressInfo(last.stress);
  document.getElementById('kStress').textContent=last.stress>=0?last.stress:'—';
  document.getElementById('kStressLabel').textContent=si.label;

  // Trends
  renderTrend('tSleep', calcTrend(S,'sleepTotal_min',curPeriod,false));
  renderTrend('tCal',   calcTrend(W,'calories',curPeriod,false));
  renderTrend('tSteps', calcTrend(W,'steps',curPeriod,false));
  renderTrend('tHR',    calcTrend(W.map(d=>({...d,_rhr:rhr(d)})),'_rhr',curPeriod,true));
  renderTrend('tStress',calcTrend(W.filter(d=>d.stress>=0),'stress',curPeriod,true));

  spark('spSleep',S.slice(-14).map(s=>s.sleepTotal_min),'#8B5CF6');
  spark('spCal',W.slice(-14).map(d=>d.calories),'#FF6B35');
  spark('spSteps',W.slice(-14).map(d=>d.steps),'#22C55E');
  spark('spHR',W.slice(-14).map(d=>rhr(d)||0),'#0EA5E9');
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
  mkChart('stressChart',{type:'line',data:{labels:sw.map(d=>fmtDate(d.date)),datasets:[{label:'Stress',data:sw.map(d=>d.stress),borderColor:'#F59E0B',backgroundColor:'#FEF3C722',borderWidth:2,pointRadius:2,fill:true,tension:.4,yAxisID:'y'},{label:'FC repos',data:sw.map(d=>rhr(d)||0),borderColor:'#0EA5E9',backgroundColor:'transparent',borderWidth:2,pointRadius:2,fill:false,tension:.4,yAxisID:'y2'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},y:{display:true,position:'left',ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'},min:0,max:100},y2:{display:true,position:'right',ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}}}}});

  renderRunChart('runChart',A);

  const sl=Sp.slice(-15);
  const slTotals=sl.map(s=>+(s.sleepTotal_min/60).toFixed(2));
  mkChart('sleepTrend',{type:'bar',data:{labels:sl.map(s=>fmtDate(s.date)),datasets:[{label:'Profond',data:sl.map(s=>+(s.deep_min/60).toFixed(2)),backgroundColor:'#4A6CF7',stack:'s'},{label:'Léger',data:sl.map(s=>+(s.light_min/60).toFixed(2)),backgroundColor:'#818CF8',stack:'s'},{label:'REM',data:sl.map(s=>+(s.rem_min/60).toFixed(2)),backgroundColor:'#C4B5FD',stack:'s'},{label:'Éveil',data:sl.map(s=>+(s.awake_min/60).toFixed(2)),backgroundColor:'#FCA5A5',stack:'s'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:9},boxWidth:10}},tooltip:{callbacks:{label:c=>c.raw>0?`${c.dataset.label} : ${fmtH(c.raw)}`:null,footer:items=>{const tot=slTotals[items[0].dataIndex];return tot>0?`Total : ${fmtH(tot)}`:'';}}}},scales:{x:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{display:false}},y:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>fmtH(v)},grid:{color:'var(--surface2)'}}}}});
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
  // Lundi de la semaine actuelle
  const today=new Date();
  const dow=today.getDay();
  const thisMonday=new Date(today);
  thisMonday.setDate(today.getDate()-(dow===0?6:dow-1));
  thisMonday.setHours(0,0,0,0);
  const lastMonday=new Date(thisMonday);lastMonday.setDate(thisMonday.getDate()-7);

  const inRange=(arr,from,to)=>arr.filter(d=>d.date>=from.toISOString().slice(0,10)&&d.date<to.toISOString().slice(0,10));
  const avg=(arr,k)=>{const f=arr.filter(d=>d[k]>0);return f.length?f.reduce((s,d)=>s+d[k],0)/f.length:0;};

  const thisW=inRange(W,thisMonday,new Date(thisMonday.getTime()+7*86400000));
  const prevW=inRange(W,lastMonday,thisMonday);
  const thisSl=inRange(S,thisMonday,new Date(thisMonday.getTime()+7*86400000));
  const prevSl=inRange(S,lastMonday,thisMonday);
  const thisA=inRange(A,thisMonday,new Date(thisMonday.getTime()+7*86400000));
  const prevA=inRange(A,lastMonday,thisMonday);
  const thisRuns=thisA.filter(a=>a.type==='running');
  const prevRuns=prevA.filter(a=>a.type==='running');

  const metrics=[
    {lbl:'Pas / jour',curr:avg(thisW,'steps'),prev:avg(prevW,'steps'),fmt:v=>Math.round(v).toLocaleString('fr-FR'),lower:false},
    {lbl:'Sommeil',curr:avg(thisSl,'sleepTotal_min'),prev:avg(prevSl,'sleepTotal_min'),fmt:v=>fmt(Math.round(v)),lower:false},
    {lbl:'Sorties course',curr:thisRuns.length,prev:prevRuns.length,fmt:v=>v+' séances',lower:false},
    {lbl:'Km courus',curr:thisRuns.reduce((s,a)=>s+(a.distance_km||0),0),prev:prevRuns.reduce((s,a)=>s+(a.distance_km||0),0),fmt:v=>v.toFixed(1)+' km',lower:false},
    {lbl:'Stress moy.',curr:avg(thisW.filter(d=>d.stress>=0),'stress'),prev:avg(prevW.filter(d=>d.stress>=0),'stress'),fmt:v=>Math.round(v)||'—',lower:true},
    {lbl:'FC repos moy.',curr:avg(thisW.filter(d=>rhr(d)),d=>rhr(d)),prev:avg(prevW.filter(d=>rhr(d)),d=>rhr(d)),fmt:v=>Math.round(v)?Math.round(v)+' bpm':'—',lower:true},
  ];
  // fix: avg for rhr needs special handling
  const avgRHR=(arr)=>{const f=arr.filter(d=>rhr(d));return f.length?f.reduce((s,d)=>s+rhr(d),0)/f.length:0;};
  metrics[5].curr=avgRHR(thisW);metrics[5].prev=avgRHR(prevW);

  if(!thisW.length&&!thisA.length){panel.style.display='none';return;}
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
