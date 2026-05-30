// ── sleep.js — Vue Sommeil : charts, régularité, heure idéale, corrélation ──

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
  if(!Sp.length){
    // Ne pas écraser le HTML — juste laisser les valeurs à '—'
    ['sl_avgTotal','sl_avgDeep','sl_avgRem','sl_avgBed','sl_avgWake','sl_regularity'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent='—';});
    return;
  }
  const avg=(arr,k)=>arr.length?Math.round(arr.reduce((s,n)=>s+(n[k]||0),0)/arr.length):0;
  const avgTotal=avg(Sp,'sleepTotal_min'),avgDeep=avg(Sp,'deep_min'),avgLight=avg(Sp,'light_min'),avgRem=avg(Sp,'rem_min'),avgAwake=avg(Sp,'awake_min');
  const beds=Sp.map(s=>s.bedtime).filter(Boolean).sort();
  document.getElementById('sl_avgTotal').textContent=fmt(avgTotal);
  document.getElementById('sl_avgDeep').textContent=fmt(avgDeep);
  document.getElementById('sl_avgRem').textContent=fmt(avgRem);
  document.getElementById('sl_avgBed').textContent=beds.length?beds[Math.floor(beds.length/2)]:'—';
  document.getElementById('sleepTrendBadge2').textContent=Sp.length+' nuits';
  const sleepTotals=Sp.map(s=>+(s.sleepTotal_min/60).toFixed(2));
  mkChart('sleepTrendFull',{type:'bar',data:{labels:Sp.map(s=>fmtDate(s.date)),datasets:[{label:'Profond',data:Sp.map(s=>+(s.deep_min/60).toFixed(2)),backgroundColor:'#4A6CF7',stack:'s'},{label:'Léger',data:Sp.map(s=>+(s.light_min/60).toFixed(2)),backgroundColor:'#818CF8',stack:'s'},{label:'REM',data:Sp.map(s=>+(s.rem_min/60).toFixed(2)),backgroundColor:'#C4B5FD',stack:'s'},{label:'Éveil',data:Sp.map(s=>+(s.awake_min/60).toFixed(2)),backgroundColor:'#FCA5A5',stack:'s'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}},tooltip:{callbacks:{label:c=>c.raw>0?`${c.dataset.label} : ${fmtH(c.raw)}`:null,footer:items=>{const tot=sleepTotals[items[0].dataIndex];return tot>0?`Total : ${fmtH(tot)}`:'';}}}},scales:{x:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF',maxTicksLimit:12},grid:{display:false}},y:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>fmtH(v)},grid:{color:'var(--surface2)'}}}}});
  renderBedtimeChart(S);
  renderSleepRegularity(Sp);
  // Score de sommeil
  const avgDeepPct=avgTotal>0?(avgDeep/avgTotal):0;
  const sleepDurScore=Math.min(40,avgTotal/480*40);
  const sleepDepScore=Math.min(35,(avgDeepPct/0.20)*35);
  const sleepRegScore=Math.min(25,lastSleepRegularityScore/10*25);
  const sleepScore=Math.round(sleepDurScore+sleepDepScore+sleepRegScore);
  const ssBadge=document.getElementById('sleepScoreBadge');
  if(ssBadge&&avgTotal>0){ssBadge.textContent=`Score ${sleepScore}/100`;ssBadge.style.display='';}
  renderIdealBedtime(Sp);
  renderSleepCorrelation(S,appData.wellness||[]);

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
// SOMMEIL — RÉGULARITÉ + RÉVEIL MOYEN
// ══════════════════════════════════════════
function renderSleepRegularity(Sp){
  const wakes=Sp.map(s=>s.wakeTime).filter(Boolean).sort();
  const avgWake=wakes.length?wakes[Math.floor(wakes.length/2)]:'—';
  document.getElementById('sl_avgWake').textContent=avgWake;

  // Std dev des heures de coucher (en décimal)
  const beds=Sp.map(s=>{
    if(!s.bedtime)return null;
    const [h,m]=s.bedtime.split(':').map(Number);
    let dec=h+m/60;
    if(dec<14)dec+=24;
    return dec;
  }).filter(v=>v!==null);
  if(!beds.length){document.getElementById('sl_regularity').textContent='—';return;}
  const meanB=beds.reduce((s,v)=>s+v,0)/beds.length;
  const stddev=Math.sqrt(beds.reduce((s,v)=>s+(v-meanB)**2,0)/beds.length);
  const score=Math.max(0,Math.min(10,10-stddev*2)).toFixed(1);
  document.getElementById('sl_regularity').textContent=score;
  lastSleepRegularityScore=parseFloat(score);
}

// ══════════════════════════════════════════
// SOMMEIL — HEURE IDÉALE DE COUCHER
// ══════════════════════════════════════════
function renderIdealBedtime(Sp){
  const box=document.getElementById('idealBedtimeBox');if(!box)return;
  const valid=Sp.filter(s=>s.bedtime&&s.deep_min>0&&s.sleepTotal_min>0);
  if(valid.length<5){box.style.display='none';return;}
  const sorted=[...valid].sort((a,b)=>b.deep_min/b.sleepTotal_min-a.deep_min/a.sleepTotal_min);
  const top=sorted.slice(0,Math.max(3,Math.floor(sorted.length*0.25)));
  const beds=top.map(s=>{const[h,m]=s.bedtime.split(':').map(Number);let d=h+m/60;if(d<14)d+=24;return d;}).sort((a,b)=>a-b);
  const med=beds[Math.floor(beds.length/2)];
  const hh=Math.floor(med%24);const mm=String(Math.round((med%1)*60)).padStart(2,'0');
  document.getElementById('idealBedtimeVal').textContent=`${String(hh).padStart(2,'0')}:${mm}`;
  box.style.display='block';
}

// ══════════════════════════════════════════
// SOMMEIL — CORRÉLATION SOMMEIL → FORME
// ══════════════════════════════════════════
function renderSleepCorrelation(S,W){
  const panel=document.getElementById('sleepCorrPanel');if(!panel)return;
  // Map wellness by date
  const wMap={};W.forEach(d=>wMap[d.date]=d);
  // For each sleep night, get next-day BB or stress
  const pts=[];
  S.forEach(s=>{
    const nextDate=new Date(s.date);nextDate.setDate(nextDate.getDate()+1);
    const nd=nextDate.toISOString().slice(0,10);
    const w=wMap[nd];
    if(!w)return;
    // Body Battery prioritaire, sinon stress inversé (100-stress) comme proxy de forme
    const bb=w.bodyBattery!=null?w.bodyBattery:(w.stress>=0?Math.max(0,100-w.stress):null);
    if(bb==null||s.sleepTotal_min<=0)return;
    pts.push({date:s.date,sleep:+(s.sleepTotal_min/60).toFixed(2),bb});
  });
  if(pts.length<4){panel.style.display='none';return;}
  panel.style.display='block';

  // Détecter si on utilise BB réel ou proxy stress
  const hasBB=W.some(d=>d.bodyBattery!=null);
  const bbLabel=hasBB?'Body Battery J+1':'Forme J+1 (100−stress)';
  const bbColor=hasBB?'#22C55E':'#F59E0B';

  const last30=pts.slice(-30);
  mkChart('sleepCorrChart',{
    type:'line',
    data:{labels:last30.map(p=>fmtDate(p.date)),datasets:[
      {label:'Sommeil (h)',data:last30.map(p=>p.sleep),borderColor:'#8B5CF6',backgroundColor:'transparent',borderWidth:2,pointRadius:2,tension:.4,yAxisID:'y'},
      {label:bbLabel,data:last30.map(p=>p.bb),borderColor:bbColor,backgroundColor:'transparent',borderWidth:2,pointRadius:2,tension:.4,yAxisID:'y2'},
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}},
        tooltip:{callbacks:{label:c=>c.datasetIndex===0?`Sommeil: ${fmtH(c.raw)}`:c.raw!=null?`${bbLabel}: ${c.raw}`:null}}},
      scales:{
        x:{display:true,ticks:{font:{size:9},maxTicksLimit:10,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,position:'left',ticks:{font:{size:9},color:'#8B5CF6',callback:v=>fmtH(v)},grid:{color:'var(--surface2)'},title:{display:true,text:'Sommeil',color:'#8B5CF6',font:{size:9}}},
        y2:{display:true,position:'right',min:0,max:100,ticks:{font:{size:9},color:bbColor},grid:{display:false},title:{display:true,text:hasBB?'Body Battery':'Forme (0-100)',color:bbColor,font:{size:9}}},
      }}
  });
}
