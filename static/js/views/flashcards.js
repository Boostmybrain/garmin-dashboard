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
// ANKI CONNECT (navigateur → localhost:8765)
// ══════════════════════════════════════════
async function _ankiCall(action, params = {}) {
  const r = await fetch('http://localhost:8765', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function _testAnkiConnect() {
  try {
    const v = await _ankiCall('version');
    return v >= 6;
  } catch { return false; }
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
      <button class="fc-btn fc-btn-primary" onclick="_fcOpenAnkiImport()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Importer depuis Anki
      </button>
      <button class="fc-btn fc-btn-secondary" onclick="_fcOpenNewDeck()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Nouveau deck
      </button>
    </div>

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
// IMPORT DEPUIS ANKI
// ══════════════════════════════════════════
function _fcOpenAnkiImport() {
  _fcMode = 'anki';
  renderFlashcards();
}

async function _renderAnkiImport(wrap) {
  wrap.innerHTML = `
    <div class="fc-back-bar">
      <button class="fc-btn fc-btn-ghost" onclick="_fcMode='list';renderFlashcards()">← Retour</button>
      <h3 style="margin:0;font-size:16px;font-weight:700">Importer depuis Anki</h3>
    </div>
    <div class="fc-anki-info">
      <p style="font-size:13px;color:var(--text2);line-height:1.6">
        ⚙️ Pour importer, <strong>Anki doit être ouvert</strong> sur ce PC avec le plugin
        <strong>AnkiConnect</strong> installé.<br>
        <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" style="color:var(--blue)">
          Installer AnkiConnect (code : 2055492159)
        </a>
      </p>
    </div>
    <div id="fcAnkiContent">
      <div style="text-align:center;padding:32px">
        <div class="fc-spinner"></div>
        <p style="margin-top:12px;font-size:13px;color:var(--text2)">Connexion à Anki…</p>
      </div>
    </div>
  `;

  const content = document.getElementById('fcAnkiContent');

  // Tester la connexion
  const ok = await _testAnkiConnect();
  if (!ok) {
    content.innerHTML = `
      <div class="fc-anki-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3>Anki non détecté</h3>
        <p>Vérifiez que :</p>
        <ol>
          <li>Anki est ouvert sur ce PC</li>
          <li>Le plugin AnkiConnect est installé (code 2055492159)</li>
          <li>Vous accédez à l'app depuis <strong>ce PC</strong> (pas depuis un autre appareil)</li>
        </ol>
        <button class="fc-btn fc-btn-primary" onclick="_renderAnkiImport(document.getElementById('fcWrap').querySelector('#fcAnkiContent').parentElement)">
          Réessayer
        </button>
      </div>
    `;
    return;
  }

  // Récupérer les decks Anki
  try {
    const ankiDecks = await _ankiCall('deckNamesAndIds');
    const deckNames = Object.keys(ankiDecks).filter(n => n !== 'Default').sort();

    content.innerHTML = `
      <p style="font-size:13px;color:var(--green);font-weight:600;margin-bottom:14px">
        ✅ Anki connecté — ${deckNames.length} deck${deckNames.length>1?'s':''} trouvé${deckNames.length>1?'s':''}
      </p>
      <div class="fc-anki-decks">
        ${deckNames.map(name => `
          <div class="fc-anki-deck-row">
            <span class="fc-anki-deck-name">${name}</span>
            <button class="fc-btn fc-btn-primary fc-btn-sm"
              onclick="_fcImportAnkiDeck('${name.replace(/'/g,"\\'")}',this)">
              Importer
            </button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<p style="color:var(--red)">Erreur : ${e.message}</p>`;
  }
}

async function _fcImportAnkiDeck(deckName, btn) {
  btn.disabled = true;
  btn.textContent = '…';

  try {
    // 1. Obtenir les IDs de notes du deck
    const noteIds = await _ankiCall('findNotes', { query: `deck:"${deckName}"` });
    if (!noteIds.length) {
      btn.textContent = '0 carte';
      return;
    }

    // 2. Récupérer les infos des notes par batch de 50
    const cards = [];
    for (let i = 0; i < noteIds.length; i += 50) {
      const batch = noteIds.slice(i, i + 50);
      const infos = await _ankiCall('notesInfo', { notes: batch });
      for (const note of infos) {
        const fields = note.fields;
        const front = fields.Front?.value || fields.front?.value
          || Object.values(fields)[0]?.value || '';
        const back  = fields.Back?.value  || fields.back?.value
          || Object.values(fields)[1]?.value || '';
        if (front && back) {
          cards.push({ front: _stripHtml(front), back: _stripHtml(back), anki_note_id: note.noteId });
        }
      }
      btn.textContent = `${Math.min(i+50, noteIds.length)}/${noteIds.length}`;
    }

    // 3. Créer ou récupérer le deck dans notre DB
    const deckRes = await fetch('/api/flashcards/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: deckName, anki_name: deckName })
    });
    const deckJ = await deckRes.json();
    const deckId = deckJ.id || (await (await fetch('/api/flashcards/decks')).json()).decks.find(d=>d.name===deckName)?.id;

    // 4. Envoyer les cartes
    await fetch(`/api/flashcards/decks/${deckId}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards })
    });

    btn.textContent = `✓ ${cards.length} cartes`;
    btn.style.background = 'var(--green)';
    showToast(`${cards.length} cartes importées depuis «${deckName}»`);
  } catch (e) {
    btn.textContent = '❌ Erreur';
    btn.disabled = false;
    console.error(e);
  }
}

function _stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || html;
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
