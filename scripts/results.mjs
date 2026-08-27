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

// Finestra di partite concluse conservata per nome squadra invece che per id.
// Serve alle righe aggiunte a mano nel tracker: partite giocate prima che il
// monitor esistesse, o che il feed quote non aveva, non hanno un id nostro e
// possono essere ritrovate solo per nome e data.
const RECENTI_MS = 45 * 24 * 60 * 60 * 1000;

const LEAGUE_LABELS = {
  soccer_italy_serie_a: 'Serie A',
  soccer_spain_la_liga: 'La Liga',
  soccer_france_ligue_one: 'Ligue 1',
};

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
 * Una chiamata per campionato a ogni giro — la fonte e' gratuita e senza
 * chiave, quindi il costo e' solo di rete. La finestra copre insieme le partite
 * da risolvere e le concluse recenti, che finiscono in `recent` per poter
 * essere ritrovate per nome dalle righe aggiunte a mano nel tracker.
 *
 * Se la fonte non risponde, le partite restano in attesa e si riprova al giro
 * dopo: il giro delle quote non deve fallire per questo.
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

  const recent = [];

  // Una chiamata per campionato, con una finestra che copre sia le partite da
  // risolvere sia le concluse recenti da tenere da parte per nome.
  for (const leagueKey of Object.keys(LEAGUE_CODES)) {
    const matches = dueByLeague.get(leagueKey) ?? [];
    const times = matches.map(m => Date.parse(m.commenceTime));
    const from = new Date(Math.min(t - RECENTI_MS, ...times.map(x => x - GIORNO)));
    const to = new Date(Math.max(t + GIORNO, ...times.map(x => x + GIORNO)));

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

    // Le concluse che NON hanno un risultato per id: sono quelle che il feed
    // quote non ha mai visto. Man mano che il monitor accumula storia questa
    // lista si svuota da sola, perche' le nuove partite arrivano con il loro id.
    const perId = Object.values(results);
    const etichetta = LEAGUE_LABELS[leagueKey] ?? leagueKey;
    for (const f of fixtures) {
      if (!f.completed) continue;
      const esito = outcomeForAway(f);
      if (!esito) continue;
      if (findFixture(f, perId)) continue;
      recent.push({
        league: etichetta,
        home: f.home,
        away: f.away,
        commenceTime: f.commenceTime,
        homeScore: Number.isFinite(f.homeScore) ? f.homeScore : null,
        awayScore: Number.isFinite(f.awayScore) ? f.awayScore : null,
        status: f.status,
        outcomeAway: esito,
      });
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
      recent,
      pending,
      unmatched,
    },
    resolved,
    errors,
  };
}
