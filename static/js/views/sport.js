// ── sport.js — Vue Sport : allure, PR, VO2max, zones FC ──

// ══════════════════════════════════════════
// SPORT — ÉVOLUTION ALLURE
// ══════════════════════════════════════════
function renderPaceChart(A){
  const panel=document.getElementById('pacePanel');if(!panel)return;
  const runs=A.filter(a=>a.type==='running'&&a.distance_km>1&&a.duration_min>0)
    .sort((a,b)=>a.date.localeCompare(b.date));
  if(runs.length<3){panel.style.display='none';return;}
  panel.style.display='block';
  const paces=runs.map(r=>+(r.duration_min/r.distance_km).toFixed(2));
  const smoothed=paces.map((p,i)=>{
    const sl=paces.slice(Math.max(0,i-2),i+1);
    return +(sl.reduce((s,v)=>s+v,0)/sl.length).toFixed(2);
  });
  const last=paces[paces.length-1];
  const pFmt=v=>`${Math.floor(v)}'${String(Math.round((v%1)*60)).padStart(2,'0')}"`;
  document.getElementById('paceBadge').textContent=pFmt(last)+'/km';
  const all=[...paces,...smoothed];
  const yMin=+(Math.min(...all)-0.5).toFixed(1);
  const yMax=+(Math.max(...all)+0.5).toFixed(1);
  mkChart('paceChart',{type:'line',
    data:{labels:runs.map(r=>fmtDate(r.date)),datasets:[
      {label:'Allure',data:paces,borderColor:'#FF6B3550',backgroundColor:'transparent',borderWidth:1,pointRadius:1.5,tension:.2},
      {label:'Tendance',data:smoothed,borderColor:'#FF6B35',backgroundColor:'transparent',borderWidth:2.5,pointRadius:0,tension:.4},
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}},
        tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${pFmt(c.raw)}/km`}}},
      scales:{
        x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,min:yMin,max:yMax,reverse:true,
          ticks:{font:{size:9},color:'#9CA3AF',callback:v=>pFmt(v)},
          grid:{color:'var(--surface2)'}}}}
  });
}

// ══════════════════════════════════════════
// SPORT — PR RECORDS
// ══════════════════════════════════════════
function renderPRCards(A){
  const panel=document.getElementById('prPanel');if(!panel)return;
  const runs=A.filter(a=>a.type==='running'&&a.distance_km>0&&a.duration_min>0);
  if(!runs.length){panel.style.display='none';return;}
  const targets=[{dist:5,label:'5 km'},{dist:10,label:'10 km'},{dist:21.0975,label:'Semi-marathon'}];
  const pFmt=v=>`${Math.floor(v)}'${String(Math.round((v%1)*60)).padStart(2,'0')}"`;
  const tFmt=min=>{const h=Math.floor(min/60),m=Math.floor(min%60),s=Math.round((min*60)%60);return h>0?`${h}h${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}"`:`${m}'${String(s).padStart(2,'0')}"`; };
  const cards=targets.map(t=>{
    const matching=runs.filter(r=>r.distance_km>=t.dist*0.7&&r.distance_km<=t.dist*1.3);
    if(!matching.length)return null;
    const best=matching.reduce((b,r)=>{const p=r.duration_min/r.distance_km;return p<b.pace?{pace:p,r}:b;},{pace:Infinity,r:null});
    if(!best.r)return null;
    return{label:t.label,time:tFmt(best.pace*t.dist),pace:pFmt(best.pace)+'/km',date:fmtDate(best.r.date)};
  }).filter(Boolean);
  if(!cards.length){panel.style.display='none';return;}
  panel.style.display='block';
  document.getElementById('prGrid').innerHTML=cards.map(c=>`<div class="pr-card"><div class="pr-dist">${c.label}</div><div class="pr-time">${c.time}</div><div class="pr-pace">${c.pace}</div><div class="pr-date">${c.date}</div></div>`).join('');
}

// ══════════════════════════════════════════
// RENDER SPORT
// ══════════════════════════════════════════
function renderSport(){
  const A=appData.activities||[];

  // Stats filtrées sur la période sélectionnée (curPeriod jours)
  const cutoff=new Date();
  cutoff.setDate(cutoff.getDate()-curPeriod);
  const cutoffStr=cutoff.toISOString().slice(0,10);
  const Ap=A.filter(a=>a.date>=cutoffStr);

  const runs    =Ap.filter(a=>a.type==='running');
  const strength=Ap.filter(a=>a.type==='strength_training');
  const totalKm =runs.reduce((s,a)=>s+(a.distance_km||0),0);
  const totalMin=[...runs,...strength].reduce((s,a)=>s+(a.duration_min||0),0);

  document.getElementById('sp_runs').textContent=runs.length;
  document.getElementById('sp_strength').textContent=strength.length;
  document.getElementById('sp_km').textContent=totalKm.toFixed(1)+' km';
  document.getElementById('sp_time').textContent=fmt(totalMin);

  // Liste complète triée par date décroissante (pas filtrée par période)
  const sortDesc=(arr)=>[...arr].sort((a,b)=>b.date.localeCompare(a.date));
  const filtered=sortDesc(actFilter==='all'?A:actFilter==='other'?A.filter(a=>!ACT_KNOWN.includes(a.type)):A.filter(a=>a.type===actFilter));

  renderRunChart('runChartFull',A);
  renderVo2maxChart(A,cutoffStr);
  renderHRZones(A,cutoffStr);
  renderPaceChart(A);
  renderPRCards(A);

  document.querySelectorAll('#actFilterTabs .filter-tab').forEach(tab=>{const m=(tab.getAttribute('onclick')||'').match(/'([^']+)'/);tab.classList.toggle('active',m&&m[1]===actFilter);});
  document.getElementById('actListFull').innerHTML=filtered.length?filtered.map(actHTML).join(''):'<p style="color:var(--text2);font-size:13px;padding:16px 0">Aucune activité pour ce filtre.</p>';
}
function setActFilter(f){actFilter=f;renderSport();}

// ══════════════════════════════════════════
// SPORT — VO2MAX CHART
// ══════════════════════════════════════════
function linReg(xs,ys){
  const n=xs.length;if(n<2)return{slope:0,intercept:ys[0]||0};
  const sx=xs.reduce((a,b)=>a+b,0),sy=ys.reduce((a,b)=>a+b,0);
  const sxy=xs.reduce((s,x,i)=>s+x*ys[i],0),sx2=xs.reduce((s,x)=>s+x*x,0);
  const denom=(n*sx2-sx*sx)||1;
  const slope=(n*sxy-sx*sy)/denom;
  return{slope,intercept:(sy-slope*sx)/n};
}

function renderVo2maxChart(A,cutoffStr){
  const panel=document.getElementById('vo2maxPanel');if(!panel)return;
  const all=A.filter(a=>a.vo2max&&a.type==='running').sort((a,b)=>a.date.localeCompare(b.date));
  if(!all.length){panel.style.display='none';return;}
  const pts=cutoffStr?all.filter(p=>p.date>=cutoffStr):all;
  const display=pts.length?pts:all; // fallback si aucune donnée sur la période
  panel.style.display='block';
  const last=display[display.length-1].vo2max;
  const first=display[0].vo2max;
  const diff=+(last-first).toFixed(1);
  const diffStr=(diff>0?'+':'')+diff;
  document.getElementById('vo2maxBadge').textContent=`${last} mL/kg/min (${diffStr})`;
  document.getElementById('vo2maxPeriodBadge').textContent=curPeriod+'j';
  const vals=display.map(p=>p.vo2max);
  const yMin=Math.max(0,Math.min(...vals)-2);
  const yMax=Math.max(...vals)+2;
  // Projection linéaire 90j (seulement si ≥5 points)
  if(display.length>=5){
    const xs=display.map((_,i)=>i);
    const reg=linReg(xs,vals);
    const lastIdx=display.length-1;
    // 3 points futurs espacés de 30j
    const futureLabels=[30,60,90].map(d=>{const dt=new Date(display[lastIdx].date);dt.setDate(dt.getDate()+d);return fmtDate(dt.toISOString().slice(0,10));});
    // Valeurs projetées (continuation de la tendance)
    const step=30/(display.length>1?(new Date(display[lastIdx].date)-new Date(display[0].date))/(display.length-1)/86400000:1);
    const futureVals=[1,2,3].map(k=>+(reg.slope*(lastIdx+k*step)+reg.intercept).toFixed(1));
    // Données combinées : nulls pour les points réels, puis les projections
    const projData=Array(display.length).fill(null);
    projData[display.length-1]=vals[display.length-1]; // connecter depuis le dernier point
    const allLabels=[...display.map(p=>fmtDate(p.date)),...futureLabels];
    const allVals=[...vals,...Array(3).fill(null)];
    const allProj=[...projData,...futureVals];
    const projectedIn90=futureVals[2];
    const projDiff=+(projectedIn90-vals[vals.length-1]).toFixed(1);
    document.getElementById('vo2maxBadge').textContent=`${vals[vals.length-1]} mL/kg/min → ~${projectedIn90} (${projDiff>0?'+':''}${projDiff})`;
    const forecastDataset={label:'Tendance 90j',data:allProj,borderColor:'#F59E0B',backgroundColor:'transparent',borderWidth:1.5,borderDash:[5,5],pointRadius:3,tension:.4,spanGaps:true};
    // On doit reconstruire le chart avec les labels étendus
    mkChart('vo2maxChart',{type:'line',
      data:{labels:allLabels,datasets:[
        {label:'VO2max',data:allVals,borderColor:'#0EA5E9',backgroundColor:'#0EA5E920',borderWidth:2.5,pointRadius:3,fill:true,tension:.4,spanGaps:false},
        forecastDataset,
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}},
          tooltip:{callbacks:{label:c=>c.raw!=null?`${c.dataset.label}: ${c.raw} mL/kg/min`:null}}},
        scales:{
          x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},
          y:{display:true,min:yMin,max:yMax,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}
    });
    return; // évite le double rendu
  }
  mkChart('vo2maxChart',{
    type:'line',
    data:{labels:display.map(p=>fmtDate(p.date)),datasets:[{
      label:'VO2max',data:vals,borderColor:'#0EA5E9',backgroundColor:'#0EA5E920',
      borderWidth:2.5,pointRadius:3,fill:true,tension:.4
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`VO2max: ${c.raw} mL/kg/min`}}},
      scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:8,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,min:yMin,max:yMax,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}
  });
}

// ══════════════════════════════════════════
// SPORT — ZONES FC (estimation from avgHR)
// ══════════════════════════════════════════
function renderHRZones(A,cutoffStr){
  const panel=document.getElementById('hrZonesPanel');if(!panel)return;
  const runs=A.filter(a=>a.type==='running'&&a.avgHR&&a.date>=cutoffStr);
  if(!runs.length){panel.style.display='none';return;}
  // Référence maxHR : max des activités ou 185 par défaut
  const refMax=Math.max(...A.filter(a=>a.maxHR).map(a=>a.maxHR),185);
  const ZONES=['Z1 <60%','Z2 60–70%','Z3 70–80%','Z4 80–90%','Z5 >90%'];
  const ZCOLS=['#22C55E','#4A6CF7','#F59E0B','#FF6B35','#EF4444'];
  const counts=[0,0,0,0,0];
  runs.forEach(a=>{
    const pct=a.avgHR/refMax*100;
    if(pct<60)counts[0]++;
    else if(pct<70)counts[1]++;
    else if(pct<80)counts[2]++;
    else if(pct<90)counts[3]++;
    else counts[4]++;
  });
  panel.style.display='block';
  document.getElementById('hrZonesBadge').textContent=runs.length+' courses';
  mkChart('hrZonesChart',{
    type:'bar',
    data:{labels:ZONES,datasets:[{data:counts,backgroundColor:ZCOLS.map(c=>c+'CC'),borderColor:ZCOLS,borderWidth:1.5,borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw} course${c.raw>1?'s':''}`}}},
      scales:{x:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}},
        y:{display:true,ticks:{font:{size:10},color:'#9CA3AF'},grid:{display:false}}}}
  });
}
