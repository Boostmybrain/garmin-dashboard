// ── paseforme.js — Vue Pas & Forme : pas quotidiens, charge d'entraînement, objectifs ──

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

// ══════════════════════════════════════════
// PAS & FORME
// ══════════════════════════════════════════
function renderPasForme(){
  const A=appData.activities||[];
  const W=appData.wellness||[];
  const Wp=byPeriod(W,curPeriod);

  // ── Pas quotidiens ──
  document.getElementById('stepsChartBadgeSport').textContent=curPeriod+'j';
  const STEPS_GOAL=10000;
  mkChart('stepsChartSport',{
    type:'bar',
    data:{
      labels:Wp.map(d=>fmtDate(d.date)),
      datasets:[{
        label:'Pas',
        data:Wp.map(d=>d.steps||0),
        backgroundColor:Wp.map(d=>(d.steps||0)>=STEPS_GOAL?'#22C55E55':(d.steps||0)>=7500?'#4A6CF755':'#94A3B855'),
        borderColor:    Wp.map(d=>(d.steps||0)>=STEPS_GOAL?'#22C55E'  :(d.steps||0)>=7500?'#4A6CF7'  :'#94A3B8'),
        borderWidth:1.5,borderRadius:4,
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c=>`${c.raw.toLocaleString('fr-FR')} pas`}},
        annotation:{annotations:{goal:{type:'line',yMin:STEPS_GOAL,yMax:STEPS_GOAL,
          borderColor:'#22C55E',borderWidth:1.5,borderDash:[6,4],
          label:{content:'Objectif 10 000',display:true,position:'end',font:{size:10},color:'#22C55E',backgroundColor:'transparent'}}}}
      },
      scales:{
        x:{display:true,ticks:{font:{size:9},maxTicksLimit:curPeriod<=7?7:curPeriod<=30?12:16,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>v>=1000?(v/1000).toFixed(0)+'k':v},grid:{color:'var(--surface2)'},min:0},
      }
    }
  });

  // ── Charge d'entraînement ──
  renderTrainingLoad(A);
}

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
// SPORT — CHARGE D'ENTRAÎNEMENT (ATL/CTL)
// ══════════════════════════════════════════
function renderTrainingLoad(A){
  const panel=document.getElementById('trainingLoadPanel');if(!panel)return;
  if(!A.length){panel.style.display='none';return;}
  // TSS par jour : sum(duration_min * (avgHR/refMax)^2 * 100/60)
  const refMax=Math.max(...A.filter(a=>a.maxHR).map(a=>a.maxHR),185);
  const tssMap={};
  A.forEach(a=>{
    const intensity=a.avgHR?Math.min(1,a.avgHR/refMax):0.65;
    const tss=a.duration_min*intensity*intensity*100/60;
    tssMap[a.date]=(tssMap[a.date]||0)+tss;
  });
  // Generate date range: last 90 days
  const dates=[];
  for(let i=89;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);dates.push(d.toISOString().slice(0,10));}
  // Exponential moving averages
  const k_ctl=1-Math.exp(-1/42),k_atl=1-Math.exp(-1/7);
  let ctl=0,atl=0;
  const ctlArr=[],atlArr=[],formArr=[];
  dates.forEach(d=>{
    const tss=tssMap[d]||0;
    ctl=ctl+k_ctl*(tss-ctl);
    atl=atl+k_atl*(tss-atl);
    ctlArr.push(+ctl.toFixed(1));
    atlArr.push(+atl.toFixed(1));
    formArr.push(+(ctl-atl).toFixed(1));
  });
  const lbls=dates.map(fmtDate);
  panel.style.display='block';
  const lastForm=formArr[formArr.length-1];
  const lastCTL=ctlArr[ctlArr.length-1];
  const lastATL=atlArr[atlArr.length-1];
  let formLabel='';
  if(lastForm>25)formLabel='⚡ Très frais';
  else if(lastForm>5)formLabel='✅ Prêt';
  else if(lastForm>-10)formLabel='🔄 Équilibre';
  else if(lastForm>-30)formLabel='⚠️ Chargé';
  else formLabel='🔴 Surcharge';
  document.getElementById('trainingLoadBadge').textContent=`Fraîcheur ${lastForm>0?'+':''}${lastForm} — ${formLabel}`;
  mkChart('trainingLoadChart',{
    type:'line',
    data:{labels:lbls,datasets:[
      {label:'Forme CTL',data:ctlArr,borderColor:'#4A6CF7',backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.4},
      {label:'Fatigue ATL',data:atlArr,borderColor:'#EF4444',backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.4},
      {label:'Fraîcheur',data:formArr,borderColor:'#22C55E',backgroundColor:'#22C55E18',borderWidth:1.5,pointRadius:0,tension:.4,fill:true},
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${c.raw}`}}},
      scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:10,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}
  });
}
