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

// --- Tendenza della quota ---------------------------------------------------
// La quota "2" che SCENDE significa squadra ospite piu' favorita: e' il verso
// che interessa alla strategia, quindi lo si evidenzia in verde.

const TREND_ARROW = { down: '▼', up: '▲', flat: '=' };

function trendBadge(tr) {
  if (!tr) return '<span class="trend none" title="Prima rilevazione: nessun confronto disponibile">nuova</span>';
  const sign = tr.delta > 0 ? '+' : '';
  const body = tr.direction === 'flat' ? 'stabile' : `${sign}${tr.delta.toFixed(2)}`;
  const title = `Rispetto al giro precedente (${fmtTime(tr.previousAt)}): ${sign}${tr.deltaPct}%.`
    + ` Dalla prima rilevazione (${fmtTime(tr.openedAt)}, ${tr.open.toFixed(2)}): ${tr.fromOpen > 0 ? '+' : ''}${tr.fromOpen.toFixed(2)}.`
    + ` ${tr.samples} rilevazioni.`;
  return `<span class="trend ${tr.direction}" title="${esc(title)}">${TREND_ARROW[tr.direction]} ${body}</span>`;
}

/** Mini grafico dell'andamento della media, ultime rilevazioni. */
function sparkline(tr) {
  const pts = tr?.spark;
  if (!pts || pts.length < 3) return '';
  const min = Math.min(...pts), max = Math.max(...pts);
  const mid = (min + max) / 2;
  // Scala ancorata a un minimo del 4% del valore: senza questo il grafico si
  // autoscalerebbe sul proprio intervallo e un'oscillazione da centesimo
  // apparirebbe come un crollo. Le quote ferme devono sembrare ferme.
  const span = Math.max(max - min, mid * 0.04) || 1;
  const lo = mid - span / 2;
  const w = 54, h = 16;
  const d = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((p - lo) / span) * (h - 2) - 1;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark ${tr.direction}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
    aria-label="Andamento della quota, ultime ${pts.length} rilevazioni: da ${pts[0].toFixed(2)} a ${pts[pts.length-1].toFixed(2)}">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function matchCard(m, threshold) {
  const el = document.createElement('article');
  el.className = 'match' + (m.triggered ? ' hit' : '');

  const s = m.awayStats ?? {};
  const under = m.books.filter(b => !b.excluded && b.away <= threshold).length;
  const tr = m.trend;
  el.innerHTML = `
    <div class="match-head">
      <div class="kickoff">${esc(fmtTime(m.commenceTime))}</div>
      <div class="teams">${esc(m.home)} <span style="opacity:.5">–</span> <span class="away">${esc(m.away)}</span></div>
      <div class="summary">
        ${m.triggered ? '<span class="badge">SEGNALE</span>' : ''}
        ${trendBadge(tr)}
        ${sparkline(tr)}
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
    ${a.trend ? trendBadge(a.trend) : ''}
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
