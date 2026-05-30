// ── forme.js — Vue fusionnée « Forme & Bien-être » (Pas + Stress & FC) ──

function renderForme(){
  try{ renderPasForme(); }catch(e){ console.error('[renderForme] paseforme:', e); }
  try{ renderStressView(); }catch(e){ console.error('[renderForme] stress:', e); }
}
