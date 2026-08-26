// Registro dei risultati: tiene traccia delle partite viste nel feed quote e,
// quando sono finite, ne recupera il punteggio da una fonte gratuita.
//
// Il risultato viene salvato con lo STESSO id usato in odds.json, cosi' la
// pagina Tracker non deve riabbinare nulla per nome: cerca per id e basta.
// L'abbinamento per nome avviene una volta sola, qui, fra due feed diversi.

import { findFixture, outcomeForAway } from '../docs/team-match.js';
import { fetchFixtures, LEAGUE_CODES, NAME } from './results/espn.mjs';

export { NAME };

// Quanto aspettare dopo il fischio d'inizio prima di cercare il risultato.
// 90 minuti piu' intervallo e recupero: sotto le 2h e mezza si troverebbe
// una partita ancora in corso.
const DOPO_FISCHIO_MS = 2.5 * 60 * 60 * 1000;

// Dopo quanto si smette di cercare il risultato di una partita mai trovata.
const RESA_MS = 10 * 24 * 60 * 60 * 1000;

// Per quanto si conservano i risultati risolti.
const CONSERVA_MS = 180 * 24 * 60 * 60 * 1000;

const GIORNO = 24 * 60 * 60 * 1000;

/** Registra nel pending ogni partita vista nel feed, per poterla ritrovare dopo. */
function trackPending(pending, data) {
  for (const league of data.leagues) {
    if (!LEAGUE_CODES[league.key]) continue;
    for (const m of league.matches) {
      pending[m.id] = {
        leagueKey: league.key,
        league: league.label,
        home: m.home,
        away: m.away,
        commenceTime: m.commenceTime,
      };
    }
  }
  return pending;
}

/**
 * Aggiorna il registro dei risultati.
 *
 * Interroga la fonte solo per i campionati che hanno partite finite e ancora
 * senza punteggio: nei giri in cui non c'e' niente da risolvere non fa
 * nessuna chiamata di rete.
 */
export async function updateResults(previous, data, now = new Date(), deps = {}) {
  const fetchLeague = deps.fetchFixtures ?? fetchFixtures;
  const t = now.getTime();

  const results = { ...(previous?.results ?? {}) };
  const pending = trackPending({ ...(previous?.pending ?? {}) }, data);
  const unmatched = [];
  const errors = [];
  let resolved = 0;

  // Partite finite da abbastanza tempo e non ancora risolte, raggruppate
  // per campionato: una sola chiamata per campionato.
  const dueByLeague = new Map();
  for (const [id, p] of Object.entries(pending)) {
    if (results[id]) { delete pending[id]; continue; }
    const kickoff = Date.parse(p.commenceTime);
    if (!Number.isFinite(kickoff) || t - kickoff < DOPO_FISCHIO_MS) continue;
    if (t - kickoff > RESA_MS) { delete pending[id]; continue; }
    if (!dueByLeague.has(p.leagueKey)) dueByLeague.set(p.leagueKey, []);
    dueByLeague.get(p.leagueKey).push({ id, ...p });
  }

  for (const [leagueKey, matches] of dueByLeague) {
    const times = matches.map(m => Date.parse(m.commenceTime));
    const from = new Date(Math.min(...times) - GIORNO);
    const to = new Date(Math.max(...times) + GIORNO);

    let fixtures;
    try {
      fixtures = await fetchLeague(leagueKey, from, to);
    } catch (err) {
      // Una fonte risultati non raggiungibile non deve compromettere il giro
      // delle quote: le partite restano in pending e si riprovera' dopo.
      errors.push(`${leagueKey}: ${err.message}`);
      continue;
    }

    for (const m of matches) {
      const fixture = findFixture(m, fixtures);
      if (!fixture) {
        unmatched.push(`${m.league}: ${m.home} - ${m.away} (${m.commenceTime.slice(0, 10)})`);
        continue;
      }
      if (!fixture.completed) continue; // ancora in corso: si riprova al prossimo giro

      results[m.id] = {
        league: m.league,
        home: m.home,
        away: m.away,
        commenceTime: m.commenceTime,
        homeScore: Number.isFinite(fixture.homeScore) ? fixture.homeScore : null,
        awayScore: Number.isFinite(fixture.awayScore) ? fixture.awayScore : null,
        status: fixture.status,
        // Esito della scommessa sul "2": e' l'unica cosa che serve al tracker.
        outcomeAway: outcomeForAway(fixture),
        resolvedAt: now.toISOString(),
      };
      delete pending[m.id];
      resolved++;
    }
  }

  for (const [id, r] of Object.entries(results)) {
    if (t - Date.parse(r.commenceTime) > CONSERVA_MS) delete results[id];
  }

  return {
    registry: {
      updatedAt: now.toISOString(),
      source: NAME,
      results,
      pending,
      unmatched,
    },
    resolved,
    errors,
  };
}
