// Logica della strategia, senza dipendenze da Node o dalla rete.
// Tenuta separata apposta: e' la parte che vale la pena testare e modificare
// quando le regole della strategia evolvono.

const MAX_BOOKS_IN_ALERT = 6;

/** Statistiche sulla quota "2" (squadra ospite) di una partita, su tutti i bookmaker. */
export function awayStats(match) {
  const prices = (match.books ?? [])
    .map(b => b.away)
    .filter(p => typeof p === 'number' && p > 0);
  if (!prices.length) return null;
  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: sum / prices.length,
    count: prices.length,
  };
}

/**
 * La partita soddisfa la regola?
 *   'any'     -> almeno un bookmaker quota il 2 <= soglia
 *   'best'    -> anche la quota piu' alta e' <= soglia
 *   'average' -> la media e' <= soglia
 */
export function isTriggered(stats, { threshold, alertMode }) {
  if (!stats) return false;
  switch (alertMode) {
    case 'best':    return stats.max <= threshold;
    case 'average': return stats.avg <= threshold;
    case 'any':
    default:        return stats.min <= threshold;
  }
}

/** Arricchisce ogni partita con statistiche e flag di trigger. Muta e restituisce data. */
export function annotate(data, config) {
  for (const league of data.leagues) {
    for (const match of league.matches) {
      const stats = awayStats(match);
      match.awayStats = stats;
      match.triggered = isTriggered(stats, config);
      match.books.sort((a, b) => a.away - b.away);
    }
  }
  return data;
}

/** Estrae le partite in segnale in forma piatta, pronte per l'alert. */
export function collectTriggered(data, config) {
  const out = [];
  for (const league of data.leagues) {
    for (const match of league.matches) {
      if (!match.triggered) continue;
      let books = match.books.filter(b => b.away <= config.threshold);
      if (!books.length) books = match.books;
      out.push({
        id: match.id,
        league: league.label,
        leagueKey: league.key,
        home: match.home,
        away: match.away,
        commenceTime: match.commenceTime,
        matchingBooks: books.slice(0, MAX_BOOKS_IN_ALERT)
          .map(b => ({ key: b.key, title: b.title, away: b.away })),
        bestAway: match.awayStats.max,
        minAway: match.awayStats.min,
        avgAway: match.awayStats.avg,
      });
    }
  }
  return out;
}

/**
 * Confronta con lo stato precedente per non ri-notificare la stessa partita
 * a ogni giro. Una partita che risale sopra soglia esce dallo stato e potra'
 * quindi ri-allertare se in seguito rientra.
 */
export function diffAgainstState(triggered, previousState) {
  const active = previousState?.active ?? {};
  const nextActive = {};
  const fresh = [];

  for (const a of triggered) {
    const wasActive = Object.prototype.hasOwnProperty.call(active, a.id);
    nextActive[a.id] = {
      triggeredAt: wasActive ? active[a.id].triggeredAt : new Date().toISOString(),
      minAway: a.minAway,
      commenceTime: a.commenceTime,
    };
    if (!wasActive) fresh.push(a);
  }

  return { fresh, nextActive };
}
