// Logica del tracker, senza DOM e senza storage: e' la parte che decide quando
// una riga entra, resta o esce, e come si calcolano profitti e statistiche.
// Tenuta separata da tracker.js apposta, cosi' e' testabile.

import { findFixture } from './team-match.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'betbot.tracker.v1';

export const RESULTS = { WIN: 'win', LOSE: 'lose', VOID: 'void' };

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// La media dei bookmaker ha molti decimali: si arrotonda per non salvare code
// inutili in localStorage e nei backup.
const round3 = v => (v === null ? null : Math.round(v * 1000) / 1000);

// Tolleranza sulla data quando si cerca il risultato di una riga scritta a mano.
const TOLLERANZA_MANUALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Una riga con dati inseriti da te non deve mai sparire da sola. */
export function hasUserData(row) {
  return Boolean(row.result) || num(row.stake) !== null
    || num(row.plOverride) !== null || (row.notes ?? '').trim() !== '';
}

/** Una riga e' "bloccata" se l'hai fissata tu, se ha dati tuoi, o se e' storica. */
export function isLocked(row) {
  return Boolean(row.pinned) || Boolean(row.frozen) || hasUserData(row);
}

export function newRow(match, leagueLabel, { source = 'auto', now = new Date() } = {}) {
  return {
    id: match.id,
    league: leagueLabel,
    home: match.home,
    away: match.away,
    commenceTime: match.commenceTime,
    source,
    pinned: source === 'manual',
    frozen: false,
    // Quota proposta: la migliore disponibile al momento del segnale. Resta
    // modificabile, perche' quella che conta e' quella che hai davvero ottenuto.
    odds: num(match.awayStats?.max),
    stake: null,
    result: null,
    // Profitto corretto a mano: quando c'e', sostituisce il calcolo. Vedi profitLoss().
    plOverride: null,
    notes: '',
    // Riferimento di mercato: la quota MEDIA dei bookmaker al momento del
    // segnale. La media dice come prezzava il mercato nel suo complesso; il
    // minimo dipendeva da quale singolo bookmaker era piu' basso in quel
    // momento, ed era un termine di paragone poco solido.
    signalOdds: round3(num(match.awayStats?.avg)),
    signalAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Allinea le righe ai segnali correnti.
 *
 * Regole:
 *  - una riga bloccata (fissata, con tuoi dati, o storica) non viene mai rimossa;
 *  - una riga automatica non bloccata segue i segnali: sparisce se la partita
 *    non e' piu' sotto soglia, ricompare se ci rientra;
 *  - al fischio d'inizio ogni riga viene congelata: da li' in poi e' storia, e
 *    resta anche quando la partita sparisce dal feed delle quote.
 *
 * @returns {{rows: Array, added: Array, removed: Array, frozen: Array}}
 */
export function syncWithSignals(rows, data, now = new Date()) {
  const t = now.getTime();
  const signals = new Map();
  for (const league of data?.leagues ?? []) {
    for (const m of league.matches) {
      if (m.triggered) signals.set(m.id, { match: m, league: league.label });
    }
  }

  const out = [];
  const added = [];
  const removed = [];
  const frozen = [];

  for (const row of rows) {
    const started = Date.parse(row.commenceTime) <= t;

    if (started && !row.frozen) {
      out.push({ ...row, frozen: true, updatedAt: now.toISOString() });
      frozen.push(row);
      continue;
    }

    if (isLocked(row)) {
      // Finche' la partita e' ancora quotata si aggiorna il riferimento di
      // mercato, senza toccare nulla di quello che hai inserito tu.
      const live = signals.get(row.id);
      out.push(live ? { ...row, signalOdds: round3(num(live.match.awayStats?.avg)) ?? row.signalOdds } : row);
      continue;
    }

    if (signals.has(row.id)) {
      const live = signals.get(row.id);
      out.push({
        ...row,
        odds: num(live.match.awayStats?.max) ?? row.odds,
        signalOdds: round3(num(live.match.awayStats?.avg)) ?? row.signalOdds,
      });
    } else {
      removed.push(row);
    }
  }

  const present = new Set(out.map(r => r.id));
  for (const [id, { match, league }] of signals) {
    if (present.has(id)) continue;
    if (Date.parse(match.commenceTime) <= t) continue; // gia' iniziata: non la si aggiunge ora
    const row = newRow(match, league, { now });
    out.push(row);
    added.push(row);
  }

  out.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  return { rows: out, added, removed, frozen };
}

/**
 * Compila da sola l'esito delle partite ormai giocate, leggendo il registro
 * dei risultati prodotto dal job.
 *
 * Non sovrascrive MAI un esito che hai messo tu: se una riga ha gia' un esito,
 * viene lasciata stare. Quelli compilati in automatico restano marcati, cosi'
 * si distinguono a colpo d'occhio e puoi comunque correggerli.
 *
 * @returns {{rows: Array, filled: Array}}
 */
export function applyResults(rows, registry) {
  const results = registry?.results ?? {};
  // Partite concluse senza un id nostro: quelle giocate prima che il monitor
  // esistesse, o che il feed quote non aveva. Sono le uniche che una riga
  // aggiunta a mano puo' sperare di ritrovare, e si cercano per nome e data.
  const recent = registry?.recent ?? [];
  const filled = [];

  const out = rows.map(row => {
    // Sulle righe aggiunte a mano la data la scrivi tu, e puo' essere fuori di
    // qualche ora o di un giorno. La ricerca per nome usa quindi una tolleranza
    // piu' larga di quella del job, dove le date vengono dallo stesso feed e
    // sono precise. Due squadre non si incontrano due volte in tre giorni,
    // quindi allargare non crea ambiguita'.
    const res = results[row.id]
      ?? (recent.length ? findFixture(row, recent, TOLLERANZA_MANUALE_MS) : null);
    if (!res || !res.outcomeAway) return row;

    // Il punteggio si mostra comunque, anche su righe compilate a mano.
    const conPunteggio = {
      ...row,
      score: Number.isFinite(res.homeScore) && Number.isFinite(res.awayScore)
        ? { home: res.homeScore, away: res.awayScore, status: res.status }
        : row.score ?? null,
    };

    if (row.result) return conPunteggio; // esito gia' presente: non si tocca

    filled.push(row);
    return { ...conPunteggio, result: res.outcomeAway, resultAuto: true, frozen: true };
  });

  return { rows: out, filled };
}

/**
 * Profitto o perdita calcolato dalla scommessa, senza correzioni manuali.
 * null se la scommessa non e' ancora conclusa.
 */
export function computedProfitLoss(row) {
  const stake = num(row.stake);
  const odds = num(row.odds);
  if (stake === null || !row.result) return null;
  if (row.result === RESULTS.VOID) return 0;
  if (row.result === RESULTS.LOSE) return -stake;
  if (row.result === RESULTS.WIN) return odds === null ? null : stake * (odds - 1);
  return null;
}

/** Hai corretto tu il profitto di questa riga? */
export const hasPlOverride = row => num(row.plOverride) !== null;

/**
 * Profitto o perdita effettivo, in euro.
 *
 * Se hai inserito un valore a mano vince quello: serve per i casi in cui il
 * calcolo stake x (quota - 1) non descrive quello che e' successo davvero.
 * Il caso tipico e' il cashout: la partita e' vinta, ma hai chiuso prima e
 * hai incassato meno — o hai perso.
 */
export function profitLoss(row) {
  const manuale = num(row.plOverride);
  return manuale !== null ? manuale : computedProfitLoss(row);
}

/** Una riga entra nelle statistiche solo se ci hai messo dei soldi. */
export const isPlayed = row => (num(row.stake) ?? 0) > 0;

export function summarize(rows) {
  const played = rows.filter(isPlayed);
  // Conclusa = c'e' un profitto determinabile. Un P/L inserito a mano rende
  // conclusa la riga anche senza esito: se hai messo una cifra, quei soldi
  // sono reali e devono entrare nei conti.
  const settled = played.filter(r => profitLoss(r) !== null);

  const stake = settled.reduce((s, r) => s + r.stake, 0);
  const pl = settled.reduce((s, r) => s + profitLoss(r), 0);
  const wins = settled.filter(r => r.result === RESULTS.WIN).length;
  const losses = settled.filter(r => r.result === RESULTS.LOSE).length;
  const voids = settled.filter(r => r.result === RESULTS.VOID).length;
  const decided = wins + losses;

  return {
    totali: rows.length,
    giocate: played.length,
    concluse: settled.length,
    inCorso: played.length - settled.length,
    vinte: wins,
    perse: losses,
    annullate: voids,
    stake,
    profitLoss: pl,
    roi: stake > 0 ? (pl / stake) * 100 : null,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    // Solo le righe che una quota ce l'hanno davvero: contare uno zero per
    // quelle senza quota abbasserebbe la media senza motivo.
    quotaMedia: media(settled.map(r => num(r.odds)).filter(q => q !== null)),
    // Quante righe hanno un profitto corretto a mano (tipicamente cashout).
    // Servono a spiegare perche' win rate e P/L possono divergere.
    conPlManuale: settled.filter(hasPlOverride).length,
  };
}

function media(valori) {
  return valori.length ? valori.reduce((a, b) => a + b, 0) / valori.length : null;
}

/**
 * Curva del profitto cumulato: come ci sei arrivato, non solo dove sei.
 *
 * Le scommesse sono ordinate per data della partita, non per quando le hai
 * inserite: la curva deve raccontare la cronologia reale delle giocate.
 * Entrano solo quelle concluse — una scommessa aperta non ha ancora spostato
 * niente, e disegnarla come uno zero falserebbe la linea.
 *
 * @returns {Array<{t, cum, pl, stake, home, away, league, result}>}
 */
export function equityCurve(rows) {
  const concluse = rows
    .filter(r => isPlayed(r) && profitLoss(r) !== null)
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));

  let cum = 0;
  return concluse.map(r => {
    const pl = profitLoss(r);
    cum += pl;
    return {
      t: r.commenceTime,
      cum: Math.round(cum * 100) / 100,
      pl: Math.round(pl * 100) / 100,
      stake: num(r.stake),
      home: r.home,
      away: r.away,
      league: r.league,
      result: r.result ?? null,
    };
  });
}

/** Statistiche separate per campionato, per capire dove la strategia regge. */
export function summarizeByLeague(rows) {
  const byLeague = new Map();
  for (const r of rows) {
    if (!byLeague.has(r.league)) byLeague.set(r.league, []);
    byLeague.get(r.league).push(r);
  }
  return [...byLeague.entries()]
    .map(([league, rs]) => ({ league, ...summarize(rs) }))
    .filter(s => s.giocate > 0)
    // I campionati senza scommesse concluse vanno in fondo: il loro profitto e'
    // zero solo perche' non si sa ancora, e non deve superare uno in perdita.
    .sort((a, b) => (b.concluse > 0) - (a.concluse > 0) || b.profitLoss - a.profitLoss);
}

const CSV_HEADERS = ['Data', 'Campionato', 'Partita', 'Esito', 'Quota', 'Stake', 'Profit/Loss', 'P/L manuale', 'Note'];
const RESULT_LABEL = { win: 'Vinta', lose: 'Persa', void: 'Annullata' };

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Export per Excel. Separatore `;` e virgola decimale: e' quello che si apre
 * con un doppio clic su un Excel con impostazioni italiane, senza procedura
 * di importazione.
 */
export function toCsv(rows) {
  const dec = n => (n == null ? '' : String(n).replace('.', ','));
  const lines = [CSV_HEADERS.join(';')];
  for (const r of rows) {
    const pl = profitLoss(r);
    lines.push([
      new Date(r.commenceTime).toLocaleDateString('it-IT'),
      r.league,
      r.home + ' - ' + r.away,
      RESULT_LABEL[r.result] ?? '',
      dec(num(r.odds)),
      dec(num(r.stake)),
      dec(pl === null ? null : Math.round(pl * 100) / 100),
      // Senza questa colonna, in Excel una riga con cashout sembrerebbe un
      // errore di calcolo: stake x (quota - 1) non torna con il P/L.
      hasPlOverride(r) ? 'si' : '',
      r.notes ?? '',
    ].map(csvCell).join(';'));
  }
  return lines.join('\r\n');
}

/** Valida un backup prima di sovrascrivere quello che c'e' gia'. */
export function parseBackup(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(rows)) throw new Error('Il file non contiene un elenco di partite.');
  return rows.map(r => {
    if (!r || typeof r.id !== 'string' || typeof r.home !== 'string' || typeof r.away !== 'string') {
      throw new Error('Riga non valida nel backup: manca id, home o away.');
    }
    return {
      ...r,
      odds: num(r.odds),
      stake: num(r.stake),
      plOverride: num(r.plOverride),
      notes: typeof r.notes === 'string' ? r.notes : '',
      result: [RESULTS.WIN, RESULTS.LOSE, RESULTS.VOID].includes(r.result) ? r.result : null,
    };
  });
}
