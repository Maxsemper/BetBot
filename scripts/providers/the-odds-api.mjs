// Provider: The Odds API (https://the-odds-api.com)
//
// Questo file e' l'UNICO punto che parla con la sorgente delle quote.
// Per passare a un altro feed (es. un provider a pagamento con bet365)
// basta creare un file gemello che esporti la stessa funzione fetchOdds()
// con lo stesso formato di ritorno, e cambiare l'import in fetch-odds.mjs.

import { ODDS_API_BASE } from '../config.mjs';

export const NAME = 'the-odds-api';

/**
 * Normalizza le tre quote 1X2 di un bookmaker.
 * The Odds API restituisce gli outcome per nome squadra; il pareggio e' "Draw".
 */
function parse1x2(market, homeTeam, awayTeam) {
  const out = { home: null, draw: null, away: null };
  for (const o of market?.outcomes ?? []) {
    const price = typeof o.price === 'number' ? o.price : null;
    if (o.name === homeTeam) out.home = price;
    else if (o.name === awayTeam) out.away = price;
    else out.draw = price; // "Draw"
  }
  return out;
}

async function fetchLeague(league, config, apiKey) {
  const url = new URL(`${ODDS_API_BASE}/sports/${league.key}/odds`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', config.regions.join(','));
  url.searchParams.set('markets', config.markets);
  url.searchParams.set('oddsFormat', config.oddsFormat);
  if (config.bookmakerFilter.length) {
    url.searchParams.set('bookmakers', config.bookmakerFilter.join(','));
  }

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const quota = {
    remaining: res.headers.get('x-requests-remaining'),
    used: res.headers.get('x-requests-used'),
    lastCost: res.headers.get('x-requests-last'),
  };

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[${league.label}] HTTP ${res.status} ${res.statusText} - ${body.slice(0, 300)}`);
  }

  const events = await res.json();
  const cutoff = Date.now() + config.maxDaysAhead * 24 * 60 * 60 * 1000;

  const matches = events
    .filter(ev => {
      const t = Date.parse(ev.commence_time);
      return Number.isFinite(t) && t > Date.now() && t <= cutoff;
    })
    .map(ev => ({
      id: ev.id,
      commenceTime: ev.commence_time,
      home: ev.home_team,
      away: ev.away_team,
      books: (ev.bookmakers ?? [])
        .map(bk => {
          const h2h = (bk.markets ?? []).find(m => m.key === 'h2h');
          if (!h2h) return null;
          const odds = parse1x2(h2h, ev.home_team, ev.away_team);
          if (odds.away == null) return null; // senza il "2" il record non ci serve
          return { key: bk.key, title: bk.title, lastUpdate: bk.last_update, ...odds };
        })
        .filter(Boolean)
        .sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .filter(m => m.books.length > 0)
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));

  return { matches, quota };
}

/**
 * @returns {Promise<{provider:string, fetchedAt:string, quota:object, leagues:Array, errors:Array}>}
 */
export async function fetchOdds(config) {
  const apiKey = config.apiKey ?? globalThis.process?.env?.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error('ODDS_API_KEY non impostata. Aggiungila come secret del repository.');
  }

  const leagues = [];
  const errors = [];
  let quota = { remaining: null, used: null, lastCost: null };

  // Sequenziale: i crediti si consumano uno alla volta e l'ordine aiuta i log.
  for (const league of config.leagues) {
    try {
      const { matches, quota: q } = await fetchLeague(league, config, apiKey);
      leagues.push({ ...league, matches });
      quota = q;
      console.log(`  ${league.label}: ${matches.length} partite (crediti rimasti: ${q.remaining ?? '?'})`);
    } catch (err) {
      errors.push(`${league.label}: ${err.message}`);
      leagues.push({ ...league, matches: [] });
      console.error(`  ${league.label}: ERRORE - ${err.message}`);
    }
  }

  return {
    provider: NAME,
    fetchedAt: new Date().toISOString(),
    quota,
    leagues,
    errors,
  };
}
