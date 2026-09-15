// ── nutrition.js — Vue Nutrition : analyse photo/texte, macros, historique repas ──

const MACRO_COLORS={cal:'#FF6B35',prot:'#4A6CF7',gluc:'#22C55E',lip:'#F59E0B'};

// ══════════════════════════════════════════
// NUTRITION — OBJECTIFS DU JOUR
// Calculés depuis la séance du jour (plan ou activité faite) et le dernier poids.
// ══════════════════════════════════════════
const WEIGHT_GOAL   ={kg:74, date:'2026-11-01'};   // marathon de Toulouse
const MAX_LOSS_WEEK =0.5;      // kg/semaine : au-delà, le bloc marathon et le tendon trinquent
const BASE_KCAL     =2350;     // dépense Garmin médiane d'un jour sans séance (juin–sept. 2026)
const KCAL_PER_KG   =7700;

// Déficit visé et plancher de glucides (g/kg) selon le type de journée
const DAY_TYPES={
  repos: {label:'Repos',              emoji:'🛌', col:'#6B7280', deficit:700, carbs:2.5},
  ef:    {label:'Endurance',          emoji:'🏃', col:'#22C55E', deficit:600, carbs:3},
  renfo: {label:'Renfo / Hyrox',      emoji:'💪', col:'#F97316', deficit:600, carbs:3},
  cle:   {label:'Séance clé',         emoji:'🔥', col:'#EF4444', deficit:350, carbs:5},
  longue:{label:'Sortie longue',      emoji:'⛰️', col:'#8B5CF6', deficit:100, carbs:6},
  charge:{label:'Recharge glucidique',emoji:'🍝', col:'#0EA5E9', deficit:0,   carbs:9},
};

function currentWeight(){
  const w=((appData&&appData.weight)||[]).filter(x=>x.weight_kg);
  return w.length?w[w.length-1]:null;
}

// Type de journée et dépense de la séance à partir du titre du plan
function classifySession(s,weight){
  if(!s) return{type:'repos',kcal:0,src:'Pas de séance au plan'};
  const t=s.title||'';
  const num=v=>parseFloat(v.replace(',','.'));
  // Distance : « Total : environ 12 km » dans le contenu, sinon « 4 × 2 km » (+ 4 km
  // d'échauffement et retour au calme), sinon la plus grande distance du titre.
  const total=(s.content||'').match(/total[^\n]*?(\d+(?:[.,]\d+)?)\s*km/i);
  const reps=t.match(/(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*km/i);
  const kms=[...t.matchAll(/(\d+(?:[.,]\d+)?)\s*km/gi)].map(m=>num(m[1]));
  const km=!kms.length?0:total?num(total[1]):reps?+reps[1]*num(reps[2])+4:Math.max(...kms);
  const min=(t.match(/(\d+)\s*min/i)||[])[1];
  let type='ef',kcal=0;
  if(/déménagement/i.test(t))                     return{type:'cle',kcal:800,src:t};  // journée entière de port de charges : on mange
  if(/^🔄|repos/i.test(t)&&!/🏃/.test(t))          return{type:'repos',kcal:/actif|cartons/i.test(t)?100:0,src:t};
  if(/longue/i.test(t)||km>=18)                   type='longue';
  else if(/séance clé|fraction|allure|seuil|vma|\d\s*[×x]\s*\d/i.test(t)&&km) type='cle';
  else if(/renfo|hyrox|💪/i.test(t)&&!km)          {type='renfo'; kcal=(min?+min:45)*7;}
  if(km) kcal+=Math.round(km*weight*0.8);          // ≈ 0,8 kcal/kg/km au-delà du métabolisme de base
  if(/renfo|hyrox/i.test(t)&&km) kcal+=250;        // renfo + footing le même jour
  return{type,kcal,src:t};
}

function computeDayTargets(){
  const today=new Date();today.setHours(0,0,0,0);
  const todayStr=localISO(today);
  const w=currentWeight();
  const weight=w?w.weight_kg:78.5;
  const session=(typeof getTodaySession==='function')?getTodaySession():null;
  let {type,kcal,src}=classifySession(session,weight);

  // Séance déjà faite : la dépense réelle Garmin remplace l'estimation
  const done=((appData&&appData.activities)||[]).filter(a=>a.date===todayStr);
  const doneKcal=done.reduce((s,a)=>s+(a.calories||0),0);
  if(doneKcal) kcal=Math.round(doneKcal*0.85);     // retire la part du métabolisme de base

  // Rythme : on vise l'objectif, sans dépasser MAX_LOSS_WEEK
  const goal=new Date(WEIGHT_GOAL.date+'T00:00:00');
  const daysLeft=Math.round((goal-today)/86400000);
  const needWeek=daysLeft>0?(weight-WEIGHT_GOAL.kg)/daysLeft*7:0;
  const rateWeek=Math.max(0,Math.min(MAX_LOSS_WEEK,needWeek));
  let deficit=DAY_TYPES[type].deficit*(MAX_LOSS_WEEK?rateWeek/MAX_LOSS_WEEK:0);
  if(daysLeft<=3&&daysLeft>=1){type='charge';deficit=0;}       // J-3 → J-1 : recharge
  else if(daysLeft<=10) deficit/=2;                              // semaine d'affûtage

  const cfg=DAY_TYPES[type];
  const tdee=BASE_KCAL+kcal;
  const prot=Math.round(weight*2.0);    // 2 g/kg : protège le muscle en déficit
  const lip =Math.round(weight*0.8);
  const carbFloor=Math.round(weight*cfg.carbs);
  let cal=Math.round(tdee-deficit);
  let gluc=Math.round((cal-prot*4-lip*9)/4);
  if(gluc<carbFloor){gluc=carbFloor;cal=prot*4+lip*9+gluc*4;}
  const round=(v,n)=>Math.round(v/n)*n;
  return{type,cfg,weight,weightDate:w?w.date:null,src,kcal,tdee,
    deficit:Math.max(0,tdee-cal),needWeek,rateWeek,daysLeft,
    targets:{cal:round(cal,10),prot:round(prot,5),gluc:round(gluc,5),lip:round(lip,5)}};
}

function renderNutriPlanCard(p){
  const el=document.getElementById('nutriPlanCard');if(!el)return;
  const nf=(v,d=0)=>v.toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
  // Projection au rythme retenu (déficit moyen d'une semaine type ≈ 85 % du rythme visé)
  const projected=p.weight-p.rateWeek*0.85*Math.max(0,p.daysLeft-3)/7;
  let note;
  if(p.type==='charge') note='Recharge glucidique avant le marathon : +1 à 1,5 kg sur la balance, c\'est du glycogène et de l\'eau, pas du gras.';
  else if(p.needWeek>MAX_LOSS_WEEK) note=`${WEIGHT_GOAL.kg} kg le ${fmtDate(WEIGHT_GOAL.date)} demanderait −${nf(p.needWeek,2)} kg/semaine. En plein bloc marathon, avec un tendon qui cicatrise, je plafonne à −${nf(MAX_LOSS_WEEK,1)} kg/semaine. Projection réaliste : ~${nf(projected,1)} kg avant la recharge des 3 derniers jours.`;
  else if(p.needWeek<=0) note='Objectif de poids atteint : les apports visent l\'équilibre.';
  else note=`Rythme visé −${nf(p.rateWeek,2)} kg/semaine : objectif ${WEIGHT_GOAL.kg} kg tenable.`;
  el.innerHTML=`
    <div class="npc-head">
      <div class="npc-title">🎯 Objectif du jour</div>
      <span class="npc-type" style="background:${p.cfg.col}20;color:${p.cfg.col}">${p.cfg.emoji} ${p.cfg.label}</span>
    </div>
    <div class="npc-rows">
      <div class="npc-row"><b>${nf(p.weight,1)} kg</b><span>Poids${p.weightDate?' · '+fmtDate(p.weightDate):''} → ${WEIGHT_GOAL.kg} kg</span></div>
      <div class="npc-row"><b>${nf(p.tdee)} kcal</b><span>Dépense estimée (séance ${nf(p.kcal)} kcal)</span></div>
      <div class="npc-row"><b>−${nf(p.deficit)} kcal</b><span>Déficit du jour</span></div>
      <div class="npc-row"><b>J-${p.daysLeft}</b><span>Marathon de Toulouse</span></div>
    </div>
    <div class="npc-note">Séance : ${p.src}<br>${note}</div>
    <div class="npc-weight">
      <label for="npcWeightInput">Poids du jour</label>
      <input id="npcWeightInput" type="number" step="0.1" min="40" max="150" inputmode="decimal" placeholder="${nf(p.weight,1)}">
      <span>kg</span>
      <button onclick="saveManualWeight()">Enregistrer</button>
    </div>`;
}

async function saveManualWeight(){
  const inp=document.getElementById('npcWeightInput');
  const kg=parseFloat((inp?.value||'').replace(',','.'));
  if(!(kg>40&&kg<150)){inp?.focus();return;}
  try{
    const r=await fetch('/api/weight/manual',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({weight_kg:kg,date:localISO(new Date())})});
    const j=await r.json();
    if(!j.ok){alert('❌ '+(j.error||'Erreur'));return;}
    appData.weight=j.weight;
    renderDayTotals(nutriMeals);
    renderWeightChart();
  }catch{alert('❌ Serveur inaccessible.');}
}

// ── Formateur heure depuis ISO string
function fmtTime(iso){
  if(!iso)return'';
  try{const d=new Date(iso);return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}catch{return'';}
}

// ══════════════════════════════════════════
// NUTRITION — POIDS CHART (barres colorées)
// ══════════════════════════════════════════
function renderWeightChart(){
  const panel=document.getElementById('weightPanel');if(!panel)return;
  const all=(appData&&appData.weight)||[];
  const filtered=all.filter(w=>w.weight_kg).slice(-90);
  if(!filtered.length){panel.style.display='none';return;}
  panel.style.display='block';

  const last=filtered[filtered.length-1].weight_kg;
  const first=filtered[0].weight_kg;
  const diff=+(last-first).toFixed(1);
  const diffStr=(diff>0?'+':'')+diff+' kg';
  document.getElementById('weightBadge').textContent=`${last} kg (${diffStr})`;

  const vals=filtered.map(d=>d.weight_kg);
  const yMin=+(Math.min(...vals)-1).toFixed(1);
  const yMax=+(Math.max(...vals)+1).toFixed(1);

  // Couleur : vert si descend vs première valeur, rouge si monte
  const colors=filtered.map(d=>{
    const delta=d.weight_kg-first;
    return delta<=0?'#22C55ECC':'#EF4444CC';
  });

  mkChart('weightChart',{
    type:'bar',
    data:{
      labels:filtered.map(d=>fmtDate(d.date)),
      datasets:[{
        label:'Poids',
        data:vals,
        backgroundColor:colors,
        borderColor:colors.map(c=>c.replace('CC','')),
        borderWidth:1,
        borderRadius:4,
      }]
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw} kg`}}},
      scales:{
        x:{display:true,ticks:{font:{size:9},maxTicksLimit:14,color:'#9CA3AF'},grid:{display:false}},
        y:{display:true,min:yMin,max:yMax,ticks:{font:{size:9},color:'#9CA3AF',callback:v=>`${v} kg`},grid:{color:'var(--surface2)'}},
      }}
  });
}

// ══════════════════════════════════════════
// NUTRITION — BILAN CALORIES
// ══════════════════════════════════════════
function renderCalorieBalance(meals,W){
  const card=document.getElementById('calBilanCard');if(!card)return;
  const burned=(W&&W.length?W[W.length-1].calories:0)||0;
  if(!burned){card.style.display='none';return;}
  const consumed=meals.reduce((s,m)=>s+(m.calories||0),0);
  const balance=consumed-burned;
  const col=balance>300?'#EF4444':balance<-500?'#4A6CF7':'#22C55E';
  const lbl=balance>300?'Excédent':balance<-500?'Déficit':'Équilibre';
  card.style.display='block';
  card.innerHTML=`<div class="cal-bilan-card">
    <div class="cbc-item"><span class="cbc-val">${burned.toLocaleString('fr-FR')}</span><span class="cbc-lbl">🔥 Dépensées</span></div>
    <div class="cbc-sep">−</div>
    <div class="cbc-item"><span class="cbc-val">${consumed.toLocaleString('fr-FR')}</span><span class="cbc-lbl">🍽 Consommées</span></div>
    <div class="cbc-sep">=</div>
    <div class="cbc-item"><span class="cbc-val" style="color:${col}">${balance>0?'+':''}${balance.toLocaleString('fr-FR')}</span><span class="cbc-lbl" style="color:${col}">${lbl}</span></div>
  </div>`;
}

// ══════════════════════════════════════════
// NUTRITION — HISTORIQUE MACROS
// ══════════════════════════════════════════
async function renderMacroHistory(){
  const panel=document.getElementById('macroHistPanel');if(!panel)return;
  try{
    const r=await fetch('/api/meals-history?days=7');
    const j=await r.json();
    if(!j.ok||!j.history.length){panel.style.display='none';return;}
    panel.style.display='block';
    const h=j.history;
    mkChart('macroHistChart',{
      type:'bar',
      data:{
        labels:h.map(d=>fmtDate(d.meal_date)),
        datasets:[
          {label:'Protéines (g)',data:h.map(d=>d.prot||0),backgroundColor:'#4A6CF7CC',stack:'s'},
          {label:'Glucides (g)',data:h.map(d=>d.gluc||0),backgroundColor:'#22C55ECC',stack:'s'},
          {label:'Lipides (g)',data:h.map(d=>d.lip||0),backgroundColor:'#F59E0BCC',stack:'s'},
        ]
      },
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'top',labels:{font:{size:10},boxWidth:10}}},
        scales:{x:{display:true,ticks:{font:{size:10},color:'#9CA3AF'},grid:{display:false}},
          y:{display:true,stacked:true,ticks:{font:{size:9},color:'#9CA3AF'},grid:{color:'var(--surface2)'}}}}
    });
  }catch{panel.style.display='none';}
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
  const plan=computeDayTargets();
  renderNutriPlanCard(plan);
  const targets=plan.targets;
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
  const today=localISO(new Date());
  try{
    const r=await fetch(`/api/meals?date=${today}`);
    const j=await r.json();
    nutriMeals=j.ok?j.meals:[];
    renderCalorieBalance(nutriMeals,appData?appData.wellness:[]);
    renderDayTotals(nutriMeals);
    renderMealHistory(nutriMeals);
    await renderMacroHistory();
    renderWeightChart();
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
