// Storico per partita della quota "2", e calcolo della tendenza.
//
// Non costa crediti API: sono gli stessi dati del giro corrente, confrontati
// con quelli dei giri precedenti. Vive in un file separato da odds.json
// perche' ha un ciclo di vita diverso: si accumula, non si sostituisce.
//
// Formato compatto, il file viene riscritto per intero a ogni giro:
//   { updatedAt, series: { "<matchId>": { k: "<kickoff ISO>", s: [[t, min, avg], ...] } } }
// dove t e' un timestamp Unix in secondi.

// ~12 giorni di rilevazioni a 6 ore: copre la vita utile di una quota pre-match.
const MAX_SAMPLES = 48;

// Quanto dopo il fischio d'inizio si smette di conservare la serie.
const PRUNE_AFTER_KICKOFF_MS = 3 * 60 * 60 * 1000;

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Aggiunge al registro la rilevazione corrente di ogni partita e scarta
 * le serie delle partite ormai iniziate.
 *
 * @param {object} previous contenuto di history.json (o null al primo giro)
 * @param {object} data     dataset gia' annotato da rules.annotate()
 * @param {Date}   now
 */
export function appendSamples(previous, data, now = new Date()) {
  // Copia in profondita': la funzione non deve mutare cio' che riceve, altrimenti
  // il registro precedente cambia sotto i piedi di chi lo sta ancora leggendo.
  const series = {};
  for (const [id, e] of Object.entries(previous?.series ?? {})) {
    series[id] = { k: e.k, s: (e.s ?? []).map(sample => sample.slice()) };
  }

  const t = Math.floor(now.getTime() / 1000);
  const seen = new Set();

  for (const league of data.leagues) {
    for (const match of league.matches) {
      const stats = match.awayStats;
      if (!stats) continue;
      seen.add(match.id);

      const entry = series[match.id] ?? { k: match.commenceTime, s: [] };
      const last = entry.s[entry.s.length - 1];

      // Due giri ravvicinati con quote identiche non aggiungono informazione:
      // si aggiorna il timestamp invece di allungare la serie.
      if (last && last[1] === round(stats.min, 2) && last[2] === round(stats.avg)) {
        last[0] = t;
      } else {
        entry.s.push([t, round(stats.min, 2), round(stats.avg)]);
        if (entry.s.length > MAX_SAMPLES) entry.s = entry.s.slice(-MAX_SAMPLES);
      }

      entry.k = match.commenceTime;
      series[match.id] = entry;
    }
  }

  // Pulizia: via le partite iniziate, e quelle sparite dal feed da tempo.
  const cutoff = now.getTime() - PRUNE_AFTER_KICKOFF_MS;
  for (const [id, entry] of Object.entries(series)) {
    const kickoff = Date.parse(entry.k ?? 0);
    if (Number.isFinite(kickoff) && kickoff < cutoff) delete series[id];
    else if (!seen.has(id) && !Number.isFinite(kickoff)) delete series[id];
  }

  return { updatedAt: now.toISOString(), series };
}

/**
 * Tendenza di una serie: confronto tra l'ultima rilevazione e la precedente.
 *
 * Si usa la MEDIA dei bookmaker, non il minimo: il minimo dipende da quale
 * singolo bookmaker e' piu' basso in quel momento e salta senza che il mercato
 * si sia mosso davvero. La media e' il consenso.
 *
 * @param {{s: Array}} entry
 * @param {number} pct soglia in % sotto la quale si considera stabile
 */
export function computeTrend(entry, pct = 1) {
  const s = entry?.s;
  if (!Array.isArray(s) || s.length < 2) return null;

  const [, , avgNow] = s[s.length - 1];
  const [tPrev, , avgPrev] = s[s.length - 2];
  const [tOpen, , avgOpen] = s[0];
  if (!avgPrev || !avgOpen) return null;

  const deltaPct = ((avgNow - avgPrev) / avgPrev) * 100;

  return {
    // 'down' = quota in discesa = squadra ospite piu' favorita
    direction: deltaPct <= -pct ? 'down' : deltaPct >= pct ? 'up' : 'flat',
    delta: round(avgNow - avgPrev),
    deltaPct: round(deltaPct, 2),
    fromOpen: round(avgNow - avgOpen),
    fromOpenPct: round(((avgNow - avgOpen) / avgOpen) * 100, 2),
    open: avgOpen,
    openedAt: new Date(tOpen * 1000).toISOString(),
    previousAt: new Date(tPrev * 1000).toISOString(),
    samples: s.length,
    // Ultime rilevazioni della media, per lo sparkline in pagina.
    spark: s.slice(-12).map(x => x[2]),
  };
}

/** Attacca `match.trend` a ogni partita del dataset. */
export function attachTrends(data, history, pct = 1) {
  for (const league of data.leagues) {
    for (const match of league.matches) {
      match.trend = computeTrend(history.series[match.id], pct);
    }
  }
  return data;
}
