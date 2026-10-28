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

/**
 * Elenco dei mesi "YYYYMM" coperti dall'intervallo, estremi inclusi.
 *
 * Si interroga per mese e non per intervallo di date perche' a meta' settembre
 * 2026 ESPN ha smesso di accettare `dates=AAAAMMGG-AAAAMMGG`, rispondendo 400
 * a qualunque intervallo. Un giorno singolo e un mese intero funzionano ancora,
 * e il mese costa molte meno chiamate: una finestra di 45 giorni sono due o
 * tre mesi invece di quarantasei giorni.
 */
export function mesiCoperti(from, to) {
  const mesi = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const fine = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
  while (d.getTime() <= fine) {
    mesi.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return mesi;
}

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

  // Un mese fallito fa fallire tutto: meglio riprovare al giro dopo che
  // dichiarare "non abbinata" una partita che semplicemente non abbiamo
  // chiesto. Le partite restano in attesa e non si perde nulla.
  const eventi = [];
  for (const mese of mesiCoperti(from, to)) {
    const res = await fetch(`${BASE}/${code}/scoreboard?dates=${mese}`,
      { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ESPN ${code} ${mese}: HTTP ${res.status} ${res.statusText}`);
    eventi.push(...((await res.json()).events ?? []));
  }

  const out = [];
  const dentroFinestra = iso => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  };

  for (const event of eventi) {
    // Il mese restituisce anche giorni fuori dall'intervallo richiesto.
    if (!dentroFinestra(event.date)) continue;
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
