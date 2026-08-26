// Provider risultati: API pubblica di ESPN.
//
// Non richiede chiave e non consuma crediti di The Odds API: e' un endpoint
// aperto, lo stesso che alimenta le pagine dei risultati di espn.com.
//
// Non e' pero' documentato come API pubblica, quindi va trattato come una
// dipendenza che puo' cambiare senza preavviso: ogni errore qui non deve mai
// far fallire il giro delle quote, che e' la funzione principale.

export const NAME = 'espn';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

/** Chiavi campionato di The Odds API -> codici ESPN. */
export const LEAGUE_CODES = {
  soccer_italy_serie_a: 'ita.1',
  soccer_spain_la_liga: 'esp.1',
  soccer_france_ligue_one: 'fra.1',
};

const yyyymmdd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Stato ESPN -> stato nostro. */
function readStatus(type) {
  const name = type?.name ?? '';
  if (name === 'STATUS_POSTPONED') return 'postponed';
  if (name === 'STATUS_CANCELED' || name === 'STATUS_ABANDONED') return 'canceled';
  if (type?.completed) return 'full_time';
  return 'scheduled';
}

/**
 * Scarica le partite di un campionato in un intervallo di date.
 * @returns {Promise<Array<{commenceTime,home,away,homeScore,awayScore,status,completed}>>}
 */
export async function fetchFixtures(leagueKey, from, to) {
  const code = LEAGUE_CODES[leagueKey];
  if (!code) throw new Error(`Campionato senza codice ESPN: ${leagueKey}`);

  const url = `${BASE}/${code}/scoreboard?dates=${yyyymmdd(from)}-${yyyymmdd(to)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN ${code}: HTTP ${res.status} ${res.statusText}`);

  const json = await res.json();
  const out = [];

  for (const event of json.events ?? []) {
    const comp = event.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === 'home');
    const away = comp?.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const status = readStatus(event.status?.type);
    out.push({
      commenceTime: event.date,
      home: home.team?.displayName ?? '',
      away: away.team?.displayName ?? '',
      homeScore: Number.parseInt(home.score, 10),
      awayScore: Number.parseInt(away.score, 10),
      status,
      // Una partita rinviata o annullata e' "conclusa" nel senso che non ha
      // piu' senso aspettarne il punteggio.
      completed: status === 'full_time' || status === 'postponed' || status === 'canceled',
    });
  }
  return out;
}
