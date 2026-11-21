// ── sport.js — Vue Sport : allure, PR, VO2max, zones FC ──

// ══════════════════════════════════════════
// SPORT — SÉANCES DE FORCE VALIDÉES PAR LES HABITUDES
// Jour où le plan prévoyait une séance de force ET où l'habitude « Sport » est
// cochée = séance faite, même si la montre ne l'a pas enregistrée.
// ══════════════════════════════════════════
let _habitStrength = null;      // [{date,type,name,duration_min,fromHabit:true}]
let _habitStrengthLoading = false;
// Séance de force : 💪/🏋️ ou mot-clé, sauf les séances de course (titre en 🏃,
// ex. « 🏃 EF 8 km + 4 × 3 min allure Hyrox »)
const _STRENGTH_TITLE = /force|muscu|renfo|hyrox|stations|💪|🏋/i;
// Jour de repos (🔄, 😴 ou « repos » dans le titre) : la case Sport cochée veut
// dire « repos respecté », pas séance faite → jamais de muscu ajoutée.
const _isRestTitle = t => /^\s*(🔄|😴|🛌)/u.test(t||'') || /\brepos\b/i.test(t||'');
const _isStrengthTitle = t => !/^\s*🏃/u.test(t||'') && !_isRestTitle(t) && _STRENGTH_TITLE.test(t||'');

async function loadHabitStrength(){
  if(_habitStrengthLoading) return;
  _habitStrengthLoading = true;
  try{
    const [h, t] = await Promise.all([
      fetch('/api/habits?days=400',{cache:'no-store'}).then(r=>r.json()),
      fetch('/api/training/history',{cache:'no-store'}).then(r=>r.json()),
    ]);
    const habits = (h && h.ok && h.habits) || {};
    const today  = localISO(new Date());
    _habitStrength = ((t && t.ok && t.sessions) || [])
      .filter(s => s.date <= today && _isStrengthTitle(s.title) && habits[s.date]?.Sport)
      .map(s => {
        const m = (s.title||'').match(/(\d+)\s*min\b/i);
        const name = (s.title||'').replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u,'')
                                   .replace(/\s*·\s*\d+\s*min\b/i,'').trim();
        return {date:s.date, type:'strength_training', name,
                duration_min: m ? parseInt(m[1],10) : 0, fromHabit:true};
      });
  }catch(e){ _habitStrength = _habitStrength || []; }
  _habitStrengthLoading = false;
  if(curView==='sport') renderSport();
  else if(curView==='dashboard' && typeof renderDashboard==='function') renderDashboard();
}

// Activités montre + séances de force cochées non enregistrées par la montre
function sportActivities(){
  const A = appData.activities||[];
  if(!_habitStrength) return A;
  const strengthDays = new Set(A.filter(a=>/strength/i.test(a.type||'')).map(a=>a.date));
  return [...A, ..._habitStrength.filter(s=>!strengthDays.has(s.date))];
}

// ══════════════════════════════════════════
// RENDER SPORT
// ══════════════════════════════════════════
function renderSport(){
  if(_habitStrength===null) loadHabitStrength();
  const A=sportActivities();

  // Stats filtrées sur la période sélectionnée (curPeriod jours)
  const cutoff=new Date();
  cutoff.setDate(cutoff.getDate()-curPeriod);
  const cutoffStr=localISO(cutoff);
  const Ap=A.filter(a=>a.date>=cutoffStr);

  const runs    =Ap.filter(a=>a.type==='running');
  const strength=Ap.filter(a=>a.type==='strength_training');
  const totalKm =runs.reduce((s,a)=>s+(a.distance_km||0),0);
  const totalMin=[...runs,...strength].reduce((s,a)=>s+(a.duration_min||0),0);

  document.getElementById('sp_runs').textContent=runs.length;
  document.getElementById('sp_strength').textContent=strength.length;
  document.getElementById('sp_km').textContent=nfr(totalKm)+' km';
  document.getElementById('sp_time').textContent=fmt(totalMin);

  // Liste complète triée par date décroissante (pas filtrée par période)
  const sortDesc=(arr)=>[...arr].sort((a,b)=>b.date.localeCompare(a.date));
  const filtered=sortDesc(actFilter==='all'?A:actFilter==='other'?A.filter(a=>!ACT_KNOWN.includes(a.type)):A.filter(a=>a.type===actFilter));

  renderRunChart('runChartFull',A);
  renderVo2maxChart(A,cutoffStr);
  renderHRZones(A,cutoffStr);

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
  const diffStr=(diff>0?'+':'')+nfr(diff);
  document.getElementById('vo2maxBadge').textContent=`${nfr(last)} mL/kg/min (${diffStr})`;
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
    const futureLabels=[30,60,90].map(d=>{const dt=new Date(display[lastIdx].date);dt.setDate(dt.getDate()+d);return fmtDate(localISO(dt));});
    // Valeurs projetées (continuation de la tendance)
    const step=30/(display.length>1?(new Date(display[lastIdx].date)-new Date(display[0].date))/(display.length-1)/86400000:1);
    // Borne physiologique : au mieux ~1 point de VO2max par mois, et la
    // régression sur une poignée de points partait sinon à +5 en 90 jours.
    const base=vals[vals.length-1];
    const futureVals=[1,2,3].map(k=>{
      const raw=reg.slope*(lastIdx+k*step)+reg.intercept;
      return +Math.max(base-k, Math.min(base+k, raw)).toFixed(1);
    });
    // Données combinées : nulls pour les points réels, puis les projections
    const projData=Array(display.length).fill(null);
    projData[display.length-1]=vals[display.length-1]; // connecter depuis le dernier point
    const allLabels=[...display.map(p=>fmtDate(p.date)),...futureLabels];
    const allVals=[...vals,...Array(3).fill(null)];
    const allProj=[...projData,...futureVals];
    const projectedIn90=futureVals[2];
    const projDiff=+(projectedIn90-vals[vals.length-1]).toFixed(1);
    document.getElementById('vo2maxBadge').textContent=`${nfr(vals[vals.length-1])} → ~${nfr(projectedIn90)} mL/kg/min en 90 j (${projDiff>0?'+':''}${nfr(projDiff)})`;
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
