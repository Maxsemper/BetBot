// Logica della strategia, senza dipendenze da Node o dalla rete.
// Tenuta separata apposta: e' la parte che vale la pena testare e modificare
// quando le regole della strategia evolvono.

const MAX_BOOKS_IN_ALERT = 6;

// Gli exchange non sono bookmaker: su partite lontane il book e' vuoto e
// mostrano prezzi privi di significato (1.06 sul "2" di una partita equilibrata).
// Vanno esclusi dal calcolo, altrimenti generano quasi solo falsi allarmi.
export const EXCHANGE_KEYS = new Set([
  'betfair_ex_eu', 'betfair_ex_uk', 'betfair_ex_au', 'betfair_ex_row',
  'matchbook', 'smarkets', 'betdaq',
]);

function median(sorted) {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * Marca i bookmaker da escludere dal calcolo, senza rimuoverli:
 * restano nei dati (e nella pagina) con il motivo dell'esclusione.
 *
 *   'invalid'  quota assente o non valida
 *   'exchange' e' un exchange, non un bookmaker
 *   'outlier'  quota troppo distante dal consenso del mercato
 */
export function markExcluded(books, config) {
  const excludeExchanges = config.excludeExchanges !== false;
  const maxDeviation = config.maxDeviation ?? 0;

  for (const b of books) {
    if (typeof b.away !== 'number' || !(b.away > 0)) b.excluded = 'invalid';
    else if (excludeExchanges && EXCHANGE_KEYS.has(b.key)) b.excluded = 'exchange';
    else b.excluded = null;
  }

  // L'outlier si misura sulla mediana dei bookmaker rimasti: serve un campione
  // minimo, altrimenti due quote discordanti si escluderebbero a vicenda.
  const kept = books.filter(b => !b.excluded);
  if (maxDeviation > 1 && kept.length >= 4) {
    const med = median(kept.map(b => b.away).sort((a, b) => a - b));
    for (const b of kept) {
      const ratio = b.away / med;
      if (ratio > maxDeviation || ratio < 1 / maxDeviation) b.excluded = 'outlier';
    }
  }

  return books;
}

/** Bookmaker che concorrono al calcolo. */
export const includedBooks = match => (match.books ?? [])
  .filter(b => !b.excluded && typeof b.away === 'number' && b.away > 0);

/** Statistiche sulla quota "2" (squadra ospite), sui soli bookmaker inclusi. */
export function awayStats(match) {
  const prices = includedBooks(match).map(b => b.away);
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

/** Arricchisce ogni partita con esclusioni, statistiche e flag di trigger. */
export function annotate(data, config) {
  for (const league of data.leagues) {
    for (const match of league.matches) {
      markExcluded(match.books, config);
      match.awayStats = awayStats(match);
      match.triggered = isTriggered(match.awayStats, config);
      // Inclusi prima, per quota crescente; gli esclusi in fondo.
      match.books.sort((a, b) =>
        (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0) || a.away - b.away);
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
      const usable = includedBooks(match);
      let books = usable.filter(b => b.away <= config.threshold);
      if (!books.length) books = usable;
      out.push({
        id: match.id,
        league: league.label,
        leagueKey: league.key,
        home: match.home,
        away: match.away,
        commenceTime: match.commenceTime,
        matchingBooks: books.slice(0, MAX_BOOKS_IN_ALERT)
          .map(b => ({ key: b.key, title: b.title, away: b.away })),
        booksUnderThreshold: usable.filter(b => b.away <= config.threshold).length,
        bookCount: usable.length,
        bestAway: match.awayStats.max,
        minAway: match.awayStats.min,
        avgAway: match.awayStats.avg,
        trend: match.trend ?? null,
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
