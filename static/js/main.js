// ── main.js — Modale import, sidebar mobile, PWA, init DOMContentLoaded ──

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
function showToast(msg,type='success'){
  const t=document.createElement('div');
  t.className=`toast toast-${type}`;
  t.textContent=msg;
  document.body.appendChild(t);
  // Double rAF pour déclencher la transition CSS après insert
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('toast-show')));
  setTimeout(()=>{
    t.classList.remove('toast-show');
    setTimeout(()=>t.remove(),300);
  },3500);
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
    setTimeout(()=>{
      closeModal();
      showToast(`${s.wellness} jours · ${s.activities} activités · ${s.sleep} nuits`);
    },1800);
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
// PULL-TO-REFRESH (mobile uniquement)
// ══════════════════════════════════════════
(function initPullToRefresh(){
  const indicator=document.getElementById('ptrIndicator');
  if(!indicator||!('ontouchstart' in window))return;
  let startY=0,pulling=false;
  const THRESHOLD=72;

  document.addEventListener('touchstart',e=>{
    if(window.scrollY===0&&e.touches.length===1){
      startY=e.touches[0].clientY;
      pulling=true;
    }
  },{passive:true});

  document.addEventListener('touchmove',e=>{
    if(!pulling)return;
    const dy=e.touches[0].clientY-startY;
    if(dy<8){pulling=false;return;}
    const offset=Math.min(dy*0.38,56);
    indicator.style.transform=`translateX(-50%) translateY(${offset-60}px)`;
    indicator.classList.toggle('ptr-ready',dy>THRESHOLD);
  },{passive:true});

  document.addEventListener('touchend',e=>{
    if(!pulling)return;
    pulling=false;
    const dy=e.changedTouches[0].clientY-startY;
    if(dy>THRESHOLD){
      indicator.style.transform='translateX(-50%) translateY(0)';
      indicator.classList.add('ptr-loading');
      fetch('/api/data')
        .then(r=>r.json())
        .then(json=>{
          if(json.ok&&json.data){appData=json.data;renderCurrent();}
          indicator.classList.remove('ptr-loading','ptr-ready');
          indicator.style.transform='';
          showToast('Données actualisées');
        })
        .catch(()=>{
          indicator.classList.remove('ptr-loading','ptr-ready');
          indicator.style.transform='';
          showToast('Impossible d\'actualiser','error');
        });
    }else{
      indicator.style.transform='';
      indicator.classList.remove('ptr-ready');
    }
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

  // Skeletons pendant le chargement asynchrone
  showSkeletons(true);

  // Try server SQLite first (persists across browsers)
  try{
    const res=await fetch('/api/data');
    const json=await res.json();
    showSkeletons(false);
    if(json.ok&&json.data){appData=json.data;renderCurrent();return;}
  }catch(e){showSkeletons(false);}

  // Fallback to localStorage
  try{const d=localStorage.getItem(LS_KEY);if(d){appData=JSON.parse(d);renderCurrent();return;}}catch{}

  // Toujours pas de données → afficher l'overlay
  _showNoData(true);
})();

// ══════════════════════════════════════════
// DOMCONTENTLOADED
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', ()=>{
  initNutriDrop();
  initGarminSync();
  loadTrainingPlan();
});
