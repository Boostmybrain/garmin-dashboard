// ── flashcards.js — Système de révision par répétition espacée (SM-2) + import Anki ──

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
let _fcDecks        = [];
let _fcReviewCards  = [];   // cartes dues pour la session en cours
let _fcReviewIdx    = 0;
let _fcRevealed     = false;
let _fcCurrentDeck  = null; // {id, name}
let _fcMode         = 'list'; // 'list' | 'review' | 'anki' | 'add'

// ══════════════════════════════════════════
// IMPORT .APKG (AnkiWeb / Anki desktop)
// ══════════════════════════════════════════
function _fcOpenApkgImport() {
  // Ouvrir le sélecteur de fichier
  const inp = document.getElementById('fcApkgInput');
  if (inp) inp.click();
}

async function _fcHandleApkg(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = ''; // reset pour pouvoir re-sélectionner le même fichier

  // Afficher un état de chargement
  const wrap = document.getElementById('fcWrap');
  const oldContent = wrap.innerHTML;
  wrap.innerHTML = `
    <div style="text-align:center;padding:48px 24px">
      <div class="fc-spinner"></div>
      <h3 style="margin-top:16px;font-size:16px;font-weight:700">Import en cours…</h3>
      <p style="color:var(--text2);font-size:13px;margin-top:6px">Lecture de ${file.name}</p>
    </div>`;

  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/flashcards/import-apkg', { method: 'POST', body: fd });
    const j = await r.json();

    if (!r.ok || j.error) {
      wrap.innerHTML = `
        <div style="text-align:center;padding:32px">
          <p style="color:var(--red);font-weight:700">❌ ${j.error}</p>
          <button class="fc-btn fc-btn-secondary" style="margin-top:12px"
            onclick="renderFlashcards()">Retour</button>
        </div>`;
      return;
    }

    // Succès ou 0 cartes
    if(j.total_added === 0){
      const dbg = j.debug || {};
      wrap.innerHTML = `
        <div style="padding:24px">
          <h3 style="color:var(--red);margin-bottom:12px">⚠️ 0 cartes importées</h3>
          <pre style="background:var(--surface2);padding:12px;border-radius:8px;font-size:11px;
            overflow-x:auto;white-space:pre-wrap;line-height:1.6">${JSON.stringify(dbg,null,2)}</pre>
          <button class="fc-btn fc-btn-secondary" style="margin-top:12px"
            onclick="renderFlashcards()">Retour</button>
        </div>`;
      return;
    }
    const lines = j.decks.map(d => `• ${d} — ${j.cards_per_deck[d]} carte${j.cards_per_deck[d]>1?'s':''}`).join('<br>');
    wrap.innerHTML = `
      <div style="text-align:center;padding:32px;display:flex;flex-direction:column;align-items:center;gap:14px">
        <div style="font-size:56px">✅</div>
        <h3 style="font-size:18px;font-weight:800;margin:0">${j.total_added} cartes importées</h3>
        <div style="font-size:13px;color:var(--text2);line-height:1.8">${lines}</div>
        <button class="fc-btn fc-btn-primary" style="margin-top:8px"
          onclick="renderFlashcards()">Voir mes decks</button>
      </div>`;
    showToast(`${j.total_added} cartes importées !`);

  } catch(e) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:32px">
        <p style="color:var(--red)">❌ Erreur : ${e.message}</p>
        <button class="fc-btn fc-btn-secondary" style="margin-top:12px"
          onclick="renderFlashcards()">Retour</button>
      </div>`;
  }
}

// ══════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════
async function renderFlashcards() {
  const wrap = document.getElementById('fcWrap');
  if (!wrap) return;

  if (_fcMode === 'review') { _renderReview(wrap); return; }
  if (_fcMode === 'anki')   { await _renderAnkiImport(wrap); return; }
  if (_fcMode === 'add')    { _renderAddCard(wrap); return; }

  // Mode liste (défaut)
  await _renderDeckList(wrap);
}

// ══════════════════════════════════════════
// LISTE DES DECKS
// ══════════════════════════════════════════
async function _renderDeckList(wrap) {
  // Stats globales
  let stats = { total_due: 0, total_cards: 0, total_decks: 0, reviewed_today: 0 };
  try {
    const sr = await fetch('/api/flashcards/stats');
    stats = await sr.json();
  } catch {}

  // Liste des decks
  try {
    const r = await fetch('/api/flashcards/decks');
    const j = await r.json();
    _fcDecks = j.decks || [];
  } catch { _fcDecks = []; }

  const dueBadge = stats.total_due > 0
    ? `<span class="fc-due-badge">${stats.total_due} à réviser</span>` : '';

  wrap.innerHTML = `
    <!-- Stats globales -->
    <div class="fc-stat-row">
      <div class="fc-stat-card">
        <div class="fc-stat-val">${stats.total_due}</div>
        <div class="fc-stat-lbl">À réviser</div>
      </div>
      <div class="fc-stat-card">
        <div class="fc-stat-val">${stats.reviewed_today}</div>
        <div class="fc-stat-lbl">Révisées aujourd'hui</div>
      </div>
      <div class="fc-stat-card">
        <div class="fc-stat-val">${stats.total_cards}</div>
        <div class="fc-stat-lbl">Cartes totales</div>
      </div>
      <div class="fc-stat-card">
        <div class="fc-stat-val">${stats.total_decks}</div>
        <div class="fc-stat-lbl">Decks</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="fc-actions">
      <button class="fc-btn fc-btn-primary" onclick="_fcOpenApkgImport()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Importer fichier .apkg
      </button>
      <button class="fc-btn fc-btn-secondary" onclick="_fcOpenNewDeck()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nouveau deck
      </button>
    </div>
    <!-- Input fichier caché pour .apkg -->
    <input type="file" id="fcApkgInput" accept=".apkg" style="display:none"
           onchange="_fcHandleApkg(this)">

    <!-- Formulaire nouveau deck (masqué) -->
    <div id="fcNewDeckForm" style="display:none;margin-bottom:16px">
      <div class="fc-input-row">
        <input id="fcNewDeckName" class="fc-input" placeholder="Nom du deck (ex: Italien)" maxlength="60">
        <button class="fc-btn fc-btn-primary" onclick="_fcCreateDeck()">Créer</button>
        <button class="fc-btn fc-btn-secondary" onclick="document.getElementById('fcNewDeckForm').style.display='none'">✕</button>
      </div>
    </div>

    <!-- Liste des decks -->
    ${_fcDecks.length === 0
      ? `<div class="fc-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="60" height="60">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <p>Aucun deck — importez depuis Anki ou créez un deck manuellement</p>
        </div>`
      : _fcDecks.map(d => `
        <div class="fc-deck-card" onclick="_fcStartReview(${d.id},'${d.name.replace(/'/g,"\\'")}')">
          <div class="fc-deck-info">
            <div class="fc-deck-name">${d.name}</div>
            <div class="fc-deck-meta">
              ${d.total} carte${d.total>1?'s':''} · ${d.new} nouvelle${d.new>1?'s':''}
            </div>
          </div>
          <div class="fc-deck-right">
            ${d.due > 0
              ? `<span class="fc-due-pill">${d.due} due${d.due>1?'s':''}</span>`
              : `<span class="fc-done-pill">✓ À jour</span>`}
            <div class="fc-deck-btns">
              <button class="fc-icon-btn" title="Ajouter une carte"
                onclick="event.stopPropagation();_fcOpenAddCard(${d.id},'${d.name.replace(/'/g,"\\'")}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
              <button class="fc-icon-btn fc-icon-danger" title="Supprimer le deck"
                onclick="event.stopPropagation();_fcDeleteDeck(${d.id},'${d.name.replace(/'/g,"\\'")}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `).join('')
    }
  `;
}


// ══════════════════════════════════════════
// MODE RÉVISION
// ══════════════════════════════════════════
async function _fcStartReview(deckId, deckName) {
  _fcCurrentDeck = { id: deckId, name: deckName };

  // Charger les cartes dues (+ nouvelles)
  try {
    const r = await fetch(`/api/flashcards/decks/${deckId}/cards?due=1`);
    const j = await r.json();
    // Mélanger légèrement
    _fcReviewCards = (j.cards || []).sort(() => Math.random() - 0.4);
  } catch {
    _fcReviewCards = [];
  }

  _fcReviewIdx = 0;
  _fcRevealed  = false;
  _fcMode = 'review';
  renderFlashcards();
}

function _renderReview(wrap) {
  if (!_fcReviewCards.length || _fcReviewIdx >= _fcReviewCards.length) {
    // Session terminée
    wrap.innerHTML = `
      <div class="fc-session-done">
        <div class="fc-done-icon">🎉</div>
        <h2>Session terminée !</h2>
        <p>${_fcReviewIdx} carte${_fcReviewIdx>1?'s':''} révisée${_fcReviewIdx>1?'s':''}</p>
        <button class="fc-btn fc-btn-primary" onclick="_fcMode='list';renderFlashcards()">
          Retour aux decks
        </button>
      </div>
    `;
    return;
  }

  const card     = _fcReviewCards[_fcReviewIdx];
  const progress = _fcReviewIdx + 1;
  const total    = _fcReviewCards.length;
  const pct      = Math.round((progress / total) * 100);

  wrap.innerHTML = `
    <!-- Header -->
    <div class="fc-review-header">
      <button class="fc-btn fc-btn-ghost" onclick="_fcMode='list';renderFlashcards()">✕</button>
      <div class="fc-review-title">${_fcCurrentDeck.name}</div>
      <span style="font-size:12px;color:var(--text2)">${progress}/${total}</span>
    </div>

    <!-- Barre de progression -->
    <div class="fc-progress-bar">
      <div class="fc-progress-fill" style="width:${pct}%"></div>
    </div>

    <!-- Carte -->
    <div class="fc-card${_fcRevealed?' revealed':''}">
      <div class="fc-card-front">
        <div class="fc-card-label">Question</div>
        <div class="fc-card-text">${card.front}</div>
      </div>
      ${_fcRevealed ? `
        <div class="fc-card-divider"></div>
        <div class="fc-card-back">
          <div class="fc-card-label">Réponse</div>
          <div class="fc-card-text fc-answer-text">${card.back}</div>
        </div>
      ` : ''}
    </div>

    <!-- Boutons -->
    ${!_fcRevealed ? `
      <button class="fc-btn fc-btn-reveal" onclick="_fcReveal()">
        Voir la réponse
      </button>
    ` : `
      <div class="fc-rating-row">
        <button class="fc-rating-btn fc-rate-again"  onclick="_fcAnswer(0)">
          <span class="fc-rate-label">Encore</span>
          <span class="fc-rate-sub">&lt;1j</span>
        </button>
        <button class="fc-rating-btn fc-rate-hard"   onclick="_fcAnswer(1)">
          <span class="fc-rate-label">Difficile</span>
          <span class="fc-rate-sub">&lt;1j</span>
        </button>
        <button class="fc-rating-btn fc-rate-good"   onclick="_fcAnswer(3)">
          <span class="fc-rate-label">Bien</span>
          <span class="fc-rate-sub">≥${card.interval || 1}j</span>
        </button>
        <button class="fc-rating-btn fc-rate-easy"   onclick="_fcAnswer(5)">
          <span class="fc-rate-label">Facile</span>
          <span class="fc-rate-sub">≥${Math.max(4, Math.round((card.interval||1) * (card.ease_factor||2.5)))}j</span>
        </button>
      </div>
    `}
  `;
}

function _fcReveal() {
  _fcRevealed = true;
  renderFlashcards();
}

async function _fcAnswer(quality) {
  const card = _fcReviewCards[_fcReviewIdx];
  try {
    await fetch(`/api/flashcards/cards/${card.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quality })
    });
  } catch {}
  _fcReviewIdx++;
  _fcRevealed = false;
  renderFlashcards();
}

// ══════════════════════════════════════════
// CRÉER DECK / AJOUTER CARTE MANUELLEMENT
// ══════════════════════════════════════════
function _fcOpenNewDeck() {
  const form = document.getElementById('fcNewDeckForm');
  if (form) { form.style.display = 'flex'; document.getElementById('fcNewDeckName')?.focus(); }
}

async function _fcCreateDeck() {
  const inp  = document.getElementById('fcNewDeckName');
  const name = inp?.value.trim();
  if (!name) return;
  try {
    const r = await fetch('/api/flashcards/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const j = await r.json();
    if (j.error) { showToast(j.error, 'error'); return; }
    showToast(`Deck «${name}» créé`);
    _fcMode = 'list';
    renderFlashcards();
  } catch { showToast('Erreur serveur', 'error'); }
}

function _fcOpenAddCard(deckId, deckName) {
  _fcCurrentDeck = { id: deckId, name: deckName };
  _fcMode = 'add';
  renderFlashcards();
}

function _renderAddCard(wrap) {
  wrap.innerHTML = `
    <div class="fc-back-bar">
      <button class="fc-btn fc-btn-ghost" onclick="_fcMode='list';renderFlashcards()">← Retour</button>
      <h3 style="margin:0;font-size:16px;font-weight:700">Ajouter une carte — ${_fcCurrentDeck.name}</h3>
    </div>
    <div class="fc-add-form">
      <label class="fc-label">Recto (question)</label>
      <textarea id="fcFrontInput" class="fc-textarea" placeholder="Ex: Qu'est-ce que «ciao» en français ?" rows="3"></textarea>
      <label class="fc-label" style="margin-top:12px">Verso (réponse)</label>
      <textarea id="fcBackInput" class="fc-textarea" placeholder="Ex: Salut / Bonjour / Au revoir" rows="3"></textarea>
      <div class="fc-add-actions">
        <button class="fc-btn fc-btn-primary" onclick="_fcSubmitCard(false)">Ajouter</button>
        <button class="fc-btn fc-btn-secondary" onclick="_fcSubmitCard(true)">Ajouter et continuer</button>
      </div>
      <div id="fcAddErr" style="color:var(--red);font-size:13px;margin-top:8px;display:none"></div>
    </div>
  `;
  document.getElementById('fcFrontInput')?.focus();
}

async function _fcSubmitCard(keepOpen) {
  const front = document.getElementById('fcFrontInput')?.value.trim();
  const back  = document.getElementById('fcBackInput')?.value.trim();
  const errEl = document.getElementById('fcAddErr');
  if (!front || !back) { errEl.textContent='Recto et verso requis'; errEl.style.display='block'; return; }
  errEl.style.display='none';
  try {
    await fetch(`/api/flashcards/decks/${_fcCurrentDeck.id}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [{ front, back }] })
    });
    showToast('Carte ajoutée');
    if (keepOpen) {
      document.getElementById('fcFrontInput').value = '';
      document.getElementById('fcBackInput').value  = '';
      document.getElementById('fcFrontInput')?.focus();
    } else {
      _fcMode = 'list'; renderFlashcards();
    }
  } catch { showToast('Erreur serveur', 'error'); }
}

async function _fcDeleteDeck(deckId, deckName) {
  if (!confirm(`Supprimer le deck «${deckName}» et toutes ses cartes ?`)) return;
  await fetch(`/api/flashcards/decks/${deckId}`, { method: 'DELETE' });
  showToast(`Deck «${deckName}» supprimé`);
  renderFlashcards();
}
