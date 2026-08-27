// Tracker: registro reale delle giocate.
//
// I dati vivono in localStorage, cioe' solo in questo browser: il repository e'
// pubblico e lo storico di stake e profitti non deve finirci. In cambio serve un
// backup manuale, che e' il pulsante "Backup".
//
// La logica pura (quando una riga entra, resta o esce; profitti; statistiche)
// sta in tracker-core.js ed e' coperta dai test.

import {
  STORAGE_KEY, SCHEMA_VERSION, RESULTS,
  syncWithSignals, profitLoss, summarize, summarizeByLeague,
  isLocked, isPlayed, toCsv, parseBackup, newRow, applyResults,
  computedProfitLoss, hasPlOverride, equityCurve,
} from './tracker-core.js';
import { renderEquityChart } from './equity-chart.js';

const state = { rows: [], hidden: new Set(), onlyPlayed: false, hideSettled: false };

// Spiegazione del punteggio mostrato accanto alla partita.
const SCORE_TITLE = {
  full_time: 'Risultato finale',
  postponed: 'Partita rinviata',
  canceled: 'Partita annullata',
};

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = iso => new Date(iso).toLocaleString('it-IT', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
});
const eur = n => (n == null ? '—' : (n >= 0 ? '+' : '−') + '€' + Math.abs(n).toFixed(2));
// Stesso segno meno di eur(), altrimenti ROI e P/L si scrivono in due modi diversi.
const pct = n => (n == null ? '—' : (n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + '%');

// --- Persistenza -------------------------------------------------------------
// localStorage puo' non essere disponibile (finestra privata, dati del sito
// bloccati): in quel caso il tracker resta usabile per la sessione, ma va detto.

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed.rows : [];
  } catch (e) {
    warnStorage('Impossibile leggere i dati salvati: ' + e.message);
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SCHEMA_VERSION, savedAt: new Date().toISOString(), rows: state.rows,
    }));
  } catch (e) {
    warnStorage('Le modifiche NON sono state salvate: ' + e.message
      + '. Esporta un backup prima di chiudere la pagina.');
  }
}

function warnStorage(msg) {
  const el = $('#storageNote');
  el.hidden = false;
  el.textContent = msg;
}

// --- Ciclo principale --------------------------------------------------------

async function fetchJson(path) {
  try {
    const res = await fetch(path + '?t=' + Date.now());
    return res.ok ? await res.json() : null;
  } catch {
    return null; // si prosegue con il solo storico locale
  }
}

/** Avvisa quali esiti sono stati compilati da soli, senza interrompere nulla. */
function notifyFilled(n) {
  const el = $('#autoNote');
  el.hidden = false;
  el.textContent = n === 1
    ? '1 esito compilato automaticamente dai risultati delle partite. Puoi correggerlo se non torna.'
    : `${n} esiti compilati automaticamente dai risultati delle partite. Puoi correggerli se non tornano.`;
}

async function init() {
  state.rows = load();

  const [data, results] = await Promise.all([
    fetchJson('data/odds.json'),
    fetchJson('data/results.json'),
  ]);

  if (data) {
    state.rows = syncWithSignals(state.rows, data).rows;
  }

  // Gli esiti delle partite giocate arrivano da soli. Va fatto dopo il sync,
  // perche' il sync congela le righe iniziate e questo le compila.
  if (results) {
    const { rows, filled } = applyResults(state.rows, results);
    state.rows = rows;
    if (filled.length) notifyFilled(filled.length);
  }

  if (data || results) save();

  renderFilters(data);
  render();
}

function commit() {
  save();
  render();
}

// --- Rendering ---------------------------------------------------------------

function visibleRows() {
  return state.rows.filter(r => {
    if (state.hidden.has(r.league)) return false;
    if (state.onlyPlayed && !isPlayed(r)) return false;
    if (state.hideSettled && r.result) return false;
    return true;
  });
}

function renderFilters(data) {
  const leagues = data?.leagues?.map(l => l.label) ?? ['Serie A', 'La Liga', 'Ligue 1'];
  const box = $('#leagueFilters');
  box.innerHTML = '';
  for (const label of leagues) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.setAttribute('aria-pressed', String(!state.hidden.has(label)));
    btn.textContent = label;
    btn.onclick = () => {
      state.hidden.has(label) ? state.hidden.delete(label) : state.hidden.add(label);
      renderFilters(data);
      render();
    };
    box.appendChild(btn);
  }
}

function render() {
  renderStats();
  renderChart();
  renderTable();
  renderByLeague();
}

/**
 * Il grafico si ridisegna alla larghezza reale invece di essere scalato:
 * scalare deformerebbe spessori e testo. Serve quindi ridisegnarlo anche
 * quando la finestra cambia dimensione.
 */
function renderChart() {
  renderEquityChart($('#chart'), equityCurve(state.rows));
}

// Ridisegno alla larghezza nuova, ma non a ogni pixel del trascinamento.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderChart, 150);
});

function renderStats() {
  const s = summarize(state.rows);
  const plClass = s.profitLoss > 0 ? 'pos' : s.profitLoss < 0 ? 'neg' : '';
  $('#stats').innerHTML = `
    <div class="stat big ${plClass}"><span class="k">Profit / Loss</span><span class="v">${eur(s.concluse ? s.profitLoss : null)}</span></div>
    <div class="stat"><span class="k">ROI</span><span class="v ${plClass}">${pct(s.roi)}</span></div>
    <div class="stat"><span class="k">Giocate</span><span class="v">${s.giocate}</span></div>
    <div class="stat"><span class="k">Vinte / Perse</span><span class="v">${s.vinte} / ${s.perse}</span></div>
    <div class="stat"><span class="k">Win rate</span><span class="v">${pct(s.winRate)}</span></div>
    <div class="stat"><span class="k">Stake totale</span><span class="v">€${s.stake.toFixed(2)}</span></div>
    <div class="stat"><span class="k">Quota media</span><span class="v">${s.quotaMedia ? s.quotaMedia.toFixed(2) : '—'}</span></div>
    <div class="stat"><span class="k">In corso</span><span class="v">${s.inCorso}</span></div>`;

  // Con un P/L corretto a mano, win rate e profitto smettono di essere
  // coerenti fra loro: una partita puo' essere vinta e aver reso meno dello
  // stake, o averlo perso. Meglio dirlo che lasciar dubitare dei conti.
  const nota = $('#plNote');
  nota.hidden = s.conPlManuale === 0;
  if (s.conPlManuale) {
    nota.textContent = `${s.conPlManuale} ${s.conPlManuale === 1 ? 'giocata ha' : 'giocate hanno'}`
      + ' il profitto corretto a mano (per esempio un cashout):'
      + ' il win rate le conta secondo l’esito, il Profit/Loss usa la cifra che hai inserito.';
  }
}

function renderByLeague() {
  const rows = summarizeByLeague(state.rows);
  $('#byLeague').hidden = rows.length === 0;
  if (!rows.length) return;
  $('#byLeagueBody').innerHTML = `
    <div class="table-wrap"><table class="grid by-league">
      <thead><tr><th>Campionato</th><th>Giocate</th><th>V / P</th><th>Win rate</th><th>Stake</th><th>P/L</th><th>ROI</th></tr></thead>
      <tbody>${rows.map(s => `
        <tr>
          <td>${esc(s.league)}</td><td>${s.giocate}</td><td>${s.vinte} / ${s.perse}</td>
          <td>${pct(s.winRate)}</td><td>€${s.stake.toFixed(2)}</td>
          <td class="${s.profitLoss > 0 ? 'pos' : s.profitLoss < 0 ? 'neg' : ''}">${eur(s.concluse ? s.profitLoss : null)}</td>
          <td class="${s.roi > 0 ? 'pos' : s.roi < 0 ? 'neg' : ''}">${pct(s.roi)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function renderTable() {
  const rows = visibleRows();
  const main = $('#content');

  if (!rows.length) {
    main.innerHTML = `<p class="loading">Nessuna partita nel tracker.
      Le partite sotto soglia compaiono qui da sole al prossimo aggiornamento dei segnali,
      oppure usa <b>+ Aggiungi partita</b>.</p>`;
    return;
  }

  main.innerHTML = `
    <div class="table-wrap"><table class="grid tracker">
      <thead>
        <tr>
          <th class="c-pin" title="Fissa la riga: non seguira' piu' i cambi di quota"></th>
          <th class="c-match">Partita</th>
          <th class="c-when">Data</th>
          <th class="c-result">Esito</th>
          <th class="c-num">Quota</th>
          <th class="c-num">Stake €</th>
          <th class="c-num">P/L €</th>
          <th class="c-notes">Note</th>
          <th class="c-del"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table></div>`;

  const tbody = main.querySelector('tbody');
  for (const row of rows) tbody.appendChild(renderRow(row));
}

function renderRow(row) {
  const tr = document.createElement('tr');
  const pl = profitLoss(row);
  const manuale = hasPlOverride(row);
  const locked = isLocked(row);
  tr.className = [
    row.result ? 'settled' : '',
    row.frozen ? 'frozen' : '',
    pl > 0 ? 'pos-row' : pl < 0 ? 'neg-row' : '',
  ].filter(Boolean).join(' ');

  const stato = row.frozen ? 'Partita giocata: la riga resta nello storico.'
    : locked ? 'Fissata: non segue piu’ i cambi di quota.'
    : 'Automatica: esce dal tracker se la quota risale sopra soglia.';

  tr.innerHTML = `
    <td class="c-pin">
      <button class="pin ${row.pinned ? 'on' : ''}" title="${esc(stato)}"
        ${row.frozen ? 'disabled' : ''} aria-pressed="${Boolean(row.pinned)}">
        ${row.frozen ? '🔒' : row.pinned ? '📌' : '📍'}
      </button>
    </td>
    <td class="c-match">
      <span class="lg">${esc(row.league)}</span>
      ${esc(row.home)} – <b>${esc(row.away)}</b>
      ${row.score ? `<span class="score" title="${esc(SCORE_TITLE[row.score.status] ?? 'Risultato finale')}">${row.score.home}–${row.score.away}</span>` : ''}
      ${row.signalOdds ? `<span class="hint" title="Quota media dei bookmaker al momento del segnale. Confrontala con la tua quota per vedere se hai preso meglio o peggio del mercato.">segnale ${row.signalOdds.toFixed(2)}</span>` : ''}
      ${row.source === 'manual' ? '<span class="hint">manuale</span>' : ''}
    </td>
    <td class="c-when">${esc(fmtDate(row.commenceTime))}</td>
    <td class="c-result">
      <select class="f-result" aria-label="Esito">
        <option value="">—</option>
        <option value="${RESULTS.WIN}">Vinta</option>
        <option value="${RESULTS.LOSE}">Persa</option>
        <option value="${RESULTS.VOID}">Annullata</option>
      </select>
      ${row.resultAuto ? '<span class="auto-tag" title="Compilato dal risultato della partita. Modificalo se non torna.">auto</span>' : ''}
    </td>
    <td class="c-num"><input class="f-odds" type="number" step="0.01" min="1.01" inputmode="decimal" aria-label="Quota"></td>
    <td class="c-num"><input class="f-stake" type="number" step="0.5" min="0" inputmode="decimal" aria-label="Stake in euro"></td>
    <td class="c-num pl ${manuale ? 'manual' : ''}">
      <input class="f-pl" type="number" step="0.01" inputmode="decimal"
        aria-label="Profit/Loss in euro"
        title="${esc(manuale
          ? 'Valore inserito da te: sostituisce il calcolo. Svuota il campo per tornare a stake x (quota - 1).'
          : 'Calcolato da stake e quota. Scrivici dentro per correggerlo, ad esempio dopo un cashout.')}">
      ${manuale ? '<span class="pl-tag" title="Profitto corretto a mano">man.</span>' : ''}
    </td>
    <td class="c-notes"><input class="f-notes" type="text" maxlength="200" aria-label="Note" placeholder="…"></td>
    <td class="c-del"><button class="del" title="Rimuovi dal tracker" aria-label="Rimuovi">✕</button></td>`;

  // I valori si impostano via proprieta', non nell'HTML: cosi' non serve
  // preoccuparsi di escape dentro gli attributi.
  const fResult = tr.querySelector('.f-result');
  const fOdds = tr.querySelector('.f-odds');
  const fStake = tr.querySelector('.f-stake');
  const fPl = tr.querySelector('.f-pl');
  const fNotes = tr.querySelector('.f-notes');
  fResult.value = row.result ?? '';
  fOdds.value = row.odds ?? '';
  fStake.value = row.stake ?? '';
  fNotes.value = row.notes ?? '';

  // Campo P/L: mostra il valore corretto a mano se c'e', altrimenti lascia
  // vedere il calcolo come segnaposto. Cosi' si capisce cosa si sta
  // sovrascrivendo, e svuotare il campo torna al calcolo.
  const calcolato = computedProfitLoss(row);
  fPl.value = manuale ? row.plOverride : '';
  fPl.placeholder = calcolato === null ? '—' : calcolato.toFixed(2);

  const parseNum = v => (v === '' || v == null ? null : Number(v));

  // Inserire un dato equivale a fissare la riga: non deve piu' poter sparire
  // perche' il mercato si e' mosso.
  const update = patch => {
    const i = state.rows.findIndex(r => r.id === row.id);
    if (i < 0) return;
    state.rows[i] = { ...state.rows[i], ...patch, updatedAt: new Date().toISOString() };
    if (!state.rows[i].frozen) state.rows[i].pinned = true;
    commit();
  };

  // Correggere a mano un esito automatico ne toglie la marcatura: da quel
  // momento e' un dato tuo.
  fResult.onchange = () => update({ result: fResult.value || null, resultAuto: false });
  fOdds.onchange = () => update({ odds: parseNum(fOdds.value) });
  fStake.onchange = () => update({ stake: parseNum(fStake.value) });
  // Svuotare il campo rimuove la correzione e torna al calcolo automatico.
  fPl.onchange = () => update({ plOverride: parseNum(fPl.value) });
  fNotes.onchange = () => update({ notes: fNotes.value });

  tr.querySelector('.pin').onclick = () => {
    const i = state.rows.findIndex(r => r.id === row.id);
    if (i < 0) return;
    state.rows[i] = { ...state.rows[i], pinned: !state.rows[i].pinned };
    commit();
  };

  tr.querySelector('.del').onclick = () => {
    const label = `${row.home} – ${row.away}`;
    if (isPlayed(row) && !confirm(`Rimuovere ${label}? Ha uno stake registrato: il dato va perso.`)) return;
    state.rows = state.rows.filter(r => r.id !== row.id);
    commit();
  };

  return tr;
}

// --- Azioni ------------------------------------------------------------------

function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

$('#exportCsv').onclick = () => {
  // ﻿: senza BOM Excel apre il CSV in ANSI e sbaglia le lettere accentate.
  download(`tracker-${stamp()}.csv`, '﻿' + toCsv(visibleRows()), 'text/csv;charset=utf-8');
};

$('#exportJson').onclick = () => {
  download(`tracker-backup-${stamp()}.json`,
    JSON.stringify({ version: SCHEMA_VERSION, savedAt: new Date().toISOString(), rows: state.rows }, null, 2),
    'application/json');
};

$('#importJson').onclick = () => $('#importFile').click();

$('#importFile').onchange = async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const rows = parseBackup(await file.text());
    if (!confirm(`Il backup contiene ${rows.length} partite e sostituira’ le ${state.rows.length} attuali. Procedere?`)) return;
    state.rows = rows;
    commit();
  } catch (err) {
    alert('Backup non valido: ' + err.message);
  } finally {
    e.target.value = '';
  }
};

$('#addManual').onclick = () => {
  const dlg = $('#manualDialog');
  $('#manualForm').reset();
  dlg.showModal();
};

$('#manualForm').onsubmit = e => {
  if (e.submitter?.value !== 'ok') return;
  const f = new FormData(e.target);
  const home = String(f.get('home')).trim();
  const away = String(f.get('away')).trim();
  const when = new Date(String(f.get('commenceTime')));
  if (!home || !away || Number.isNaN(when.getTime())) return;

  const row = newRow(
    { id: 'man_' + Date.now().toString(36), home, away, commenceTime: when.toISOString() },
    String(f.get('league')),
    { source: 'manual' },
  );
  state.rows = [...state.rows, row].sort(
    (a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  commit();
};

$('#onlyPlayed').onchange = e => { state.onlyPlayed = e.target.checked; render(); };
$('#hideSettled').onchange = e => { state.hideSettled = e.target.checked; render(); };

init();
