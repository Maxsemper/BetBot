// Frontend del monitor: legge i JSON generati dal job e li rende leggibili.
// Nessuna dipendenza esterna, nessuna chiave API nel browser.

const REFRESH_MS = 15 * 60 * 1000; // ricontrolla il file ogni 15 min mentre la pagina e' aperta
const state = { data: null, hidden: new Set(), onlyTriggered: false };

// Perche' un bookmaker non concorre al calcolo (vedi scripts/rules.mjs).
const EXCLUSION_LABEL = {
  exchange: 'exchange, escluso',
  outlier: 'fuori mercato, escluso',
  invalid: 'quota non valida',
};

const $ = sel => document.querySelector(sel);

const fmtTime = iso => new Date(iso).toLocaleString('it-IT', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const fmtOdd = n => (typeof n === 'number' ? n.toFixed(2) : '—');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function load() {
  const bust = `?t=${Date.now()}`;
  const [odds, alerts] = await Promise.all([
    fetch(`data/odds.json${bust}`).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))),
    fetch(`data/alerts.json${bust}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
  ]);
  state.data = odds;
  render(odds, alerts);
  maybeNotify(odds);
}

function render(data, alerts) {
  $('#threshold').textContent = fmtOdd(data.threshold);
  $('#updated').textContent = fmtTime(data.fetchedAt);
  $('#quota').textContent = data.quota?.remaining ?? '—';
  $('#provider').textContent = data.provider;

  if (data.errors?.length) {
    const el = $('#errors');
    el.hidden = false;
    el.textContent = 'Errori ultimo aggiornamento:\n' + data.errors.join('\n');
  }

  $('#demoBanner').hidden = !data.demo;

  renderFilters(data);
  renderLeagues(data);
  renderAlerts(alerts);
}

function renderFilters(data) {
  const box = $('#leagueFilters');
  box.innerHTML = '';
  for (const l of data.leagues) {
    const hits = l.matches.filter(m => m.triggered).length;
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.setAttribute('aria-pressed', String(!state.hidden.has(l.key)));
    btn.innerHTML = `${esc(l.label)}<span class="count">${l.matches.length}${hits ? ` · ${hits}⚑` : ''}</span>`;
    btn.onclick = () => {
      state.hidden.has(l.key) ? state.hidden.delete(l.key) : state.hidden.add(l.key);
      renderFilters(data);
      renderLeagues(data);
    };
    box.appendChild(btn);
  }
}

function renderLeagues(data) {
  const main = $('#content');
  main.innerHTML = '';
  let shown = 0;

  for (const league of data.leagues) {
    if (state.hidden.has(league.key)) continue;
    const matches = state.onlyTriggered ? league.matches.filter(m => m.triggered) : league.matches;
    if (!matches.length) continue;
    shown += matches.length;

    const sec = document.createElement('section');
    sec.className = 'league';
    sec.innerHTML = `<h2>${esc(league.label)}</h2>`;
    for (const m of matches) sec.appendChild(matchCard(m, data.threshold));
    main.appendChild(sec);
  }

  if (!shown) {
    main.innerHTML = '<p class="loading">Nessuna partita da mostrare con i filtri attuali.</p>';
  }
}

function matchCard(m, threshold) {
  const el = document.createElement('article');
  el.className = 'match' + (m.triggered ? ' hit' : '');

  const s = m.awayStats ?? {};
  const under = m.books.filter(b => !b.excluded && b.away <= threshold).length;
  el.innerHTML = `
    <div class="match-head">
      <div class="kickoff">${esc(fmtTime(m.commenceTime))}</div>
      <div class="teams">${esc(m.home)} <span style="opacity:.5">–</span> <span class="away">${esc(m.away)}</span></div>
      <div class="summary">
        ${m.triggered ? '<span class="badge">SEGNALE</span>' : ''}
        <span class="best">min <b>${fmtOdd(s.min)}</b> · media ${fmtOdd(s.avg)} · ${s.count ?? 0} book${under ? ` · <b>${under}</b> sotto soglia` : ""}</span>
      </div>
    </div>`;

  const books = document.createElement('div');
  books.className = 'books';
  books.hidden = !m.triggered; // le partite in segnale sono gia' espanse
  books.innerHTML = `
    <table>
      <thead><tr><th>Bookmaker</th><th>1</th><th>X</th><th>2</th></tr></thead>
      <tbody>
        ${m.books.map(b => `
          <tr class="${b.excluded ? 'excluded' : ''}">
            <td>${esc(b.title)}${b.excluded ? ` <span class="tag">${EXCLUSION_LABEL[b.excluded] ?? b.excluded}</span>` : ''}</td>
            <td>${fmtOdd(b.home)}</td>
            <td>${fmtOdd(b.draw)}</td>
            <td class="two${!b.excluded && b.away <= threshold ? ' under' : ''}">${fmtOdd(b.away)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  el.appendChild(books);

  el.querySelector('.match-head').onclick = () => { books.hidden = !books.hidden; };
  return el;
}

function renderAlerts(alerts) {
  const items = alerts.items ?? [];
  if (!items.length) return;
  $('#alertsSection').hidden = false;
  $('#alertsList').innerHTML = items.slice(0, 30).map(a => `
    <li>${esc(fmtTime(a.notifiedAt ?? a.commenceTime))} — <b>${esc(a.league)}</b>:
    ${esc(a.home)} – <b>${esc(a.away)}</b> · quota 2 da <b>${fmtOdd(a.minAway)}</b>
    (${esc(a.matchingBooks.map(b => b.title).join(', '))})</li>`).join('');
}

// --- Notifica browser (facoltativa, funziona solo a pagina aperta) ---
function maybeNotify(data) {
  if (!$('#notify').checked || Notification?.permission !== 'granted') return;
  const seen = new Set(JSON.parse(localStorage.getItem('notifiedIds') ?? '[]'));
  const fresh = data.leagues.flatMap(l => l.matches.filter(m => m.triggered).map(m => ({ ...m, league: l.label })))
    .filter(m => !seen.has(m.id));
  for (const m of fresh.slice(0, 5)) {
    new Notification(`Quota 2 ≤ ${data.threshold}`, {
      body: `${m.league}: ${m.home} – ${m.away} · ${fmtOdd(m.awayStats.min)}`,
      tag: m.id,
    });
    seen.add(m.id);
  }
  localStorage.setItem('notifiedIds', JSON.stringify([...seen].slice(-500)));
}

$('#onlyTriggered').onchange = e => { state.onlyTriggered = e.target.checked; renderLeagues(state.data); };
$('#notify').onchange = e => { if (e.target.checked) Notification.requestPermission(); };

load().catch(err => {
  $('#content').innerHTML = `<p class="errors">Impossibile caricare i dati: ${esc(err.message)}.<br>
    Il job non ha ancora generato <code>docs/data/odds.json</code>? Lancia il workflow "Monitor quote" da GitHub Actions.</p>`;
});
setInterval(() => load().catch(() => {}), REFRESH_MS);
