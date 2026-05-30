// ── stress.js — Vue Stress & FC : stress, FC repos, HRV, Body Battery ──

// ══════════════════════════════════════════
// RENDER STRESS & FC
// ══════════════════════════════════════════
function renderStressView(){
  const W=appData.wellness||[],Wp=byPeriod(W,curPeriod);
  const sw=Wp.filter(d=>d.stress!=null&&d.stress>=0),hr=Wp.filter(d=>rhr(d));
  const avgS=sw.length?Math.round(sw.reduce((s,d)=>s+d.stress,0)/sw.length):null;
  const avgHR=hr.length?Math.round(hr.reduce((s,d)=>s+rhr(d),0)/hr.length):null;
  const minRHR=hr.length?Math.min(...hr.map(d=>rhr(d))):null;
  const bestS=sw.length?Math.min(...sw.map(d=>d.stress)):null;
  document.getElementById('st_avgStress').textContent=avgS!=null?`${avgS} — ${stressInfo(avgS).label}`:'—';
  document.getElementById('st_avgHR').textContent=avgHR!=null?`${avgHR} bpm`:'—';
  document.getElementById('st_minHR').textContent=minRHR!=null?`${minRHR} bpm`:'—';
  // st_bestStress supprimé du HTML — ligne retirée
  document.getElementById('stressBadge2').textContent=curPeriod+'j';
  document.getElementById('hrBadge').textContent=curPeriod+'j';

  mkChart('stressChartFull',{type:'line',data:{labels:sw.map(d=>fmtDate(d.date)),datasets:[{label:'Stress',data:sw.map(d=>d.stress),borderColor:'#F59E0B',backgroundColor:'#FEF3C730',borderWidth:2,pointRadius:3,fill:true,tension:.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Stress: ${c.raw} — ${stressInfo(c.raw).label}`}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},y:{display:true,min:0,max:100,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}});
  mkChart('hrRestChart',{type:'line',data:{labels:hr.map(d=>fmtDate(d.date)),datasets:[{label:'FC repos',data:hr.map(d=>rhr(d)),borderColor:'#0EA5E9',backgroundColor:'#E0F5FF40',borderWidth:2.5,pointRadius:3,fill:true,tension:.4},{label:'FC max',data:hr.map(d=>d.maxHR||null),borderColor:'#EF444870',backgroundColor:'transparent',borderWidth:1.5,pointRadius:2,fill:false,tension:.4,borderDash:[5,4]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},y:{display:true,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>`${v} bpm`},grid:{color:'var(--surface2)'}}}}});

  renderHRVChart(Wp);

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
// STRESS — HRV CHART
// ══════════════════════════════════════════
function renderHRVChart(Wp){
  const panel=document.getElementById('hrvPanel');if(!panel)return;
  const hrv=Wp.filter(d=>d.hrv!=null);
  if(!hrv.length){panel.style.display='none';return;}
  panel.style.display='block';
  document.getElementById('hrvBadge').textContent=curPeriod+'j';
  mkChart('hrvChart',{
    type:'line',
    data:{labels:hrv.map(d=>fmtDate(d.date)),datasets:[{
      label:'HRV',data:hrv.map(d=>d.hrv),borderColor:'#8B5CF6',backgroundColor:'#8B5CF620',
      borderWidth:2.5,pointRadius:3,fill:true,tension:.4
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`HRV: ${c.raw} ms`}}},
      scales:{x:{display:true,ticks:{font:{size:9},maxTicksLimit:12,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}
  });
}
