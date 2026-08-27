// Grafico della curva del profitto cumulato.
//
// SVG generato a mano, senza librerie: la pagina non ha dipendenze esterne e
// non deve iniziare ad averne per un grafico.
//
// L'SVG viene ridisegnato alla larghezza reale del contenitore invece di essere
// scalato: scalare un viewBox deformerebbe anche gli spessori delle linee e la
// dimensione del testo.

const PAD = { top: 14, right: 76, bottom: 24, left: 50 };
const ALTEZZA = 210;

const eur = n => (n >= 0 ? '+' : '−') + '€' + Math.abs(n).toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtGiorno = iso => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });

/**
 * Passo "tondo" per l'asse, dalla scala 1 / 2 / 5 x potenze di dieci.
 *
 * Si prende il passo piu' fine che non superi il numero massimo di tacche,
 * invece di dividere l'intervallo e arrotondare: quel calcolo, su un intervallo
 * di 65 euro, sceglieva 50 e lasciava l'asse con due sole tacche.
 */
function passoTondo(min, max, maxTick = 5) {
  const conta = passo => Math.floor(max / passo) - Math.ceil(min / passo) + 1;
  for (let e = -2; e <= 7; e++) {
    for (const m of [1, 2, 5]) {
      const passo = m * 10 ** e;
      if (conta(passo) <= maxTick) return passo;
    }
  }
  return 10 ** 7;
}

/**
 * Scala verticale. Include SEMPRE lo zero: senza, una curva tutta positiva
 * sembrerebbe partire da sotto e il confronto con la linea di pareggio
 * — che e' il punto del grafico — si perderebbe.
 */
function scalaY(punti, altezzaUtile) {
  const valori = punti.map(p => p.cum);
  let min = Math.min(0, ...valori);
  let max = Math.max(0, ...valori);
  if (min === max) { min -= 1; max += 1; }           // curva piatta a zero
  const margine = (max - min) * 0.12;
  min -= margine;
  max += margine;

  const passo = passoTondo(min, max);
  const tick = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max; v += passo) {
    tick.push(Math.round(v * 100) / 100);
  }
  return {
    min, max, tick,
    // I decimali seguono il passo: con passo 0.5, scrivere le tacche a zero
    // decimali produrrebbe due "-1" e due "1" di fila.
    decimali: passo < 0.1 ? 2 : passo < 1 ? 1 : 0,
    y: v => altezzaUtile - ((v - min) / (max - min)) * altezzaUtile,
  };
}

/**
 * Disegna il grafico dentro `host`.
 * @param {HTMLElement} host
 * @param {Array} punti risultato di equityCurve()
 */
export function renderEquityChart(host, punti) {
  host.textContent = '';

  if (!punti.length) {
    host.innerHTML = `<p class="chart-empty">Il grafico compare qui quando registri
      la prima giocata conclusa: mostrera' come il profitto si e' mosso nel tempo.</p>`;
    return;
  }

  // Il grafico si disegna alla larghezza reale del contenitore e mai oltre:
  // un SVG piu' largo del suo host sborda e fa scorrere la pagina in orizzontale.
  // Se il contenitore non e' ancora stato disposto, si riprova al frame dopo.
  const disponibile = host.clientWidth;
  if (!disponibile) {
    requestAnimationFrame(() => renderEquityChart(host, punti));
    return;
  }

  const larghezza = disponibile;
  // Su spazi stretti i margini si riducono, altrimenti l'area del grafico
  // sparisce e restano solo le etichette.
  const stretto = larghezza < 420;
  const padL = stretto ? 34 : PAD.left;
  const padR = stretto ? 52 : PAD.right;
  const w = Math.max(60, larghezza - padL - padR);
  const h = ALTEZZA - PAD.top - PAD.bottom;
  const sy = scalaY(punti, h);

  // Con una sola giocata non c'e' una linea da tracciare: si mostra il punto.
  const x = i => (punti.length === 1 ? w / 2 : (i / (punti.length - 1)) * w);
  const py = p => sy.y(p.cum);
  const yZero = sy.y(0);

  const linea = punti.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
  // L'area si chiude sulla linea dello zero, non sul fondo del grafico: cosi'
  // il riempimento misura la distanza dal pareggio.
  const area = punti.length > 1
    ? `${linea} L${x(punti.length - 1).toFixed(1)},${yZero.toFixed(1)} L${x(0).toFixed(1)},${yZero.toFixed(1)} Z`
    : '';

  const ultimo = punti[punti.length - 1];
  const segno = ultimo.cum >= 0 ? 'pos' : 'neg';
  const id = 'eq' + Math.random().toString(36).slice(2, 8);

  const tick = sy.tick.map(v => `
    <line class="grid" x1="0" y1="${sy.y(v).toFixed(1)}" x2="${w}" y2="${sy.y(v).toFixed(1)}"/>
    <text class="tick" x="-8" y="${(sy.y(v) + 3.5).toFixed(1)}" text-anchor="end">${v.toFixed(sy.decimali)}</text>`).join('');

  host.innerHTML = `
  <svg class="equity" width="${larghezza}" height="${ALTEZZA}" viewBox="0 0 ${larghezza} ${ALTEZZA}"
       role="img" tabindex="0"
       aria-label="Andamento del profitto cumulato su ${punti.length} giocate concluse: da ${eur(punti[0].cum)} a ${eur(ultimo.cum)}. I valori esatti sono nella tabella qui sotto.">
    <defs>
      <clipPath id="${id}-sopra"><rect x="0" y="0" width="${w}" height="${Math.max(0, yZero).toFixed(1)}"/></clipPath>
      <clipPath id="${id}-sotto"><rect x="0" y="${Math.max(0, yZero).toFixed(1)}" width="${w}" height="${Math.max(0, h - yZero).toFixed(1)}"/></clipPath>
    </defs>
    <g transform="translate(${padL},${PAD.top})">
      ${tick}
      ${area ? `<path class="area pos" d="${area}" clip-path="url(#${id}-sopra)"/>
                <path class="area neg" d="${area}" clip-path="url(#${id}-sotto)"/>` : ''}
      <line class="zero" x1="0" y1="${yZero.toFixed(1)}" x2="${w}" y2="${yZero.toFixed(1)}"/>
      ${punti.length > 1 ? `<path class="line ${segno}" d="${linea}"/>` : ''}

      <text class="axis-x" x="0" y="${h + 16}">${esc(fmtGiorno(punti[0].t))}</text>
      ${punti.length > 1 ? `<text class="axis-x" x="${w}" y="${h + 16}" text-anchor="end">${esc(fmtGiorno(ultimo.t))}</text>` : ''}

      <circle class="end-ring" cx="${x(punti.length - 1).toFixed(1)}" cy="${py(ultimo).toFixed(1)}" r="6"/>
      <circle class="end ${segno}" cx="${x(punti.length - 1).toFixed(1)}" cy="${py(ultimo).toFixed(1)}" r="4"/>
      <text class="end-label ${segno}" x="${(x(punti.length - 1) + 12).toFixed(1)}" y="${(py(ultimo) + 4).toFixed(1)}">${eur(ultimo.cum)}</text>

      <g class="cursor" hidden>
        <line class="crosshair" y1="0" y2="${h}"/>
        <circle class="dot-ring" r="6"/>
        <circle class="dot ${segno}" r="4"/>
      </g>
      <rect class="hit" x="0" y="${-PAD.top}" width="${w}" height="${ALTEZZA}" fill="transparent"/>
    </g>
  </svg>
  <div class="chart-tip" hidden></div>`;

  collegaInterazione(host, punti, { x, py, w, larghezza, padL });
}

/**
 * Crosshair e tooltip. Il punto piu' vicino si trova per distanza orizzontale,
 * cosi' non serve centrare il mouse sul pallino: la zona sensibile e' tutta
 * l'altezza del grafico.
 */
function collegaInterazione(host, punti, { x, py, w, larghezza, padL }) {
  const svg = host.querySelector('svg');
  const cursor = svg.querySelector('.cursor');
  const cross = svg.querySelector('.crosshair');
  const dot = svg.querySelector('.dot');
  const ring = svg.querySelector('.dot-ring');
  const tip = host.querySelector('.chart-tip');
  const hit = svg.querySelector('.hit');
  let attivo = -1;

  const mostra = i => {
    if (i < 0 || i >= punti.length) return nascondi();
    attivo = i;
    const p = punti[i];
    const px = x(i);
    const pyv = py(p);
    cursor.hidden = false;
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    dot.setAttribute('cx', px); dot.setAttribute('cy', pyv);
    ring.setAttribute('cx', px); ring.setAttribute('cy', pyv);
    dot.setAttribute('class', 'dot ' + (p.cum >= 0 ? 'pos' : 'neg'));

    const esito = p.result === 'win' ? 'vinta' : p.result === 'lose' ? 'persa'
      : p.result === 'void' ? 'annullata' : 'conclusa';
    tip.hidden = false;
    tip.innerHTML = `
      <div class="t-when">${esc(fmtGiorno(p.t))} · ${esc(p.league)}</div>
      <div class="t-match">${esc(p.home)} – <b>${esc(p.away)}</b></div>
      <div class="t-row"><span>Esito</span><b>${esito}</b></div>
      <div class="t-row"><span>Questa giocata</span><b class="${p.pl >= 0 ? 'pos' : 'neg'}">${eur(p.pl)}</b></div>
      <div class="t-row"><span>Totale dopo</span><b class="${p.cum >= 0 ? 'pos' : 'neg'}">${eur(p.cum)}</b></div>`;

    // Il tooltip si sposta dall'altra parte quando non ci sta a destra.
    const sinistra = padL + px;
    const largTip = tip.offsetWidth || 190;
    tip.style.left = (sinistra + largTip + 16 > larghezza ? sinistra - largTip - 14 : sinistra + 14) + 'px';
    tip.style.top = Math.max(4, PAD.top + pyv - 30) + 'px';
  };

  const nascondi = () => { attivo = -1; cursor.hidden = true; tip.hidden = true; };

  const daEvento = e => {
    const box = svg.getBoundingClientRect();
    const rel = e.clientX - box.left - padL;
    if (punti.length === 1) return 0;
    return Math.max(0, Math.min(punti.length - 1, Math.round((rel / w) * (punti.length - 1))));
  };

  hit.addEventListener('pointermove', e => mostra(daEvento(e)));
  hit.addEventListener('pointerdown', e => mostra(daEvento(e)));
  hit.addEventListener('pointerleave', nascondi);

  // Da tastiera si ottiene esattamente quello che si ottiene col mouse.
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { mostra(attivo < 0 ? 0 : attivo + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { mostra(attivo < 0 ? punti.length - 1 : attivo - 1); e.preventDefault(); }
    else if (e.key === 'Home') { mostra(0); e.preventDefault(); }
    else if (e.key === 'End') { mostra(punti.length - 1); e.preventDefault(); }
    else if (e.key === 'Escape') nascondi();
  });
  svg.addEventListener('blur', nascondi);
}
