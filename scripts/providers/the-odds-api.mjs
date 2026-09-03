// Provider: The Odds API (https://the-odds-api.com)
//
// Questo file e' l'UNICO punto che parla con la sorgente delle quote.
// Per passare a un altro feed (es. un provider a pagamento con bet365)
// basta creare un file gemello che esporti la stessa funzione fetchOdds()
// con lo stesso formato di ritorno, e cambiare l'import in fetch-odds.mjs.

import { ODDS_API_BASE } from '../config.mjs';
import { sameTeam } from '../../docs/team-match.js';

export const NAME = 'the-odds-api';

// Due eventi cosi' vicini con le stesse squadre sono la stessa partita: due
// squadre non si incontrano davvero due volte in tre giorni.
const SCARTO_DOPPIONI_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Unisce gli eventi che descrivono la stessa partita.
 *
 * Quando i bookmaker non concordano sull'orario, il feed restituisce due
 * eventi distinti con id diversi e i bookmaker spartiti in gruppi disgiunti:
 * Torino - AS Roma compariva due volte, il 13 settembre con 4 bookmaker e il
 * 14 con 12. Lasciarli separati significa due segnali per la stessa partita,
 * due alert, due righe nel tracker, e due medie calcolate ognuna su meta'
 * mercato.
 *
 * Id e orario vengono dalla variante con piu' bookmaker: confrontando quattro
 * casi con una fonte calendario indipendente, la maggioranza aveva sempre
 * l'orario giusto. E' anche la scelta piu' stabile, perche' quando il feed si
 * corregge da solo e' la variante che sopravvive, quindi l'id non cambia.
 */
export function unisciDoppioni(matches) {
  const gruppi = [];
  for (const m of matches) {
    const gruppo = gruppi.find(g =>
      sameTeam(g[0].home, m.home) && sameTeam(g[0].away, m.away) &&
      g.some(x => Math.abs(Date.parse(x.commenceTime) - Date.parse(m.commenceTime)) <= SCARTO_DOPPIONI_MS));
    if (gruppo) gruppo.push(m);
    else gruppi.push([m]);
  }
  return gruppi.map(fondiGruppo);
}

function fondiGruppo(gruppo) {
  if (gruppo.length === 1) return gruppo[0];

  const principale = gruppo.slice().sort((a, b) =>
    b.books.length - a.books.length || (a.id < b.id ? -1 : 1))[0];

  // Unione dei bookmaker: se lo stesso compare in piu' varianti vince la
  // quotazione piu' recente.
  const perChiave = new Map();
  for (const m of gruppo) {
    for (const libro of m.books) {
      const gia = perChiave.get(libro.key);
      if (!gia || (libro.lastUpdate ?? '') > (gia.lastUpdate ?? '')) perChiave.set(libro.key, libro);
    }
  }

  return {
    ...principale,
    books: [...perChiave.values()].sort((a, b) => a.title.localeCompare(b.title)),
    variantiUnite: gruppo.length,
  };
}

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
    .filter(m => m.books.length > 0);

  const uniti = unisciDoppioni(matches)
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));

  const doppioni = matches.length - uniti.length;
  return { matches: uniti, quota, doppioni };
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
      const { matches, quota: q, doppioni } = await fetchLeague(league, config, apiKey);
      leagues.push({ ...league, matches });
      quota = q;
      console.log(`  ${league.label}: ${matches.length} partite`
        + (doppioni ? ` (${doppioni} doppioni di calendario uniti)` : '')
        + ` · crediti rimasti: ${q.remaining ?? '?'}`);
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
