// Configurazione centrale del monitor quote.
// Tutti i valori possono essere sovrascritti da variabili d'ambiente
// (utile per cambiare soglia o campionati senza toccare il codice).

export const CONFIG = {
  // Soglia di alert: scatta quando la quota del "2" (squadra ospite) e' <= a questo valore.
  threshold: Number(process.env.ODDS_THRESHOLD ?? 1.85),

  // Come valutare la soglia quando piu' bookmaker quotano la stessa partita:
  //   'any'     -> alert se ALMENO UN bookmaker e' <= soglia (lettura letterale, default)
  //   'best'    -> alert se anche la quota PIU' ALTA e' <= soglia (segnale piu' forte)
  //   'average' -> alert sulla media delle quote
  alertMode: process.env.ALERT_MODE ?? 'any',

  // Campionati monitorati. Le chiavi sono quelle di The Odds API.
  leagues: [
    { key: 'soccer_italy_serie_a',   label: 'Serie A',   country: 'IT' },
    { key: 'soccer_spain_la_liga',   label: 'La Liga',   country: 'ES' },
    { key: 'soccer_france_ligue_one', label: 'Ligue 1',  country: 'FR' },
  ],

  // Regioni bookmaker. Ogni regione in piu' RADDOPPIA il consumo di crediti.
  // 'eu' -> Pinnacle, Betclic, Unibet IT/FR, Codere IT, Betsson, 1xBet, Winamax, William Hill...
  regions: (process.env.ODDS_REGIONS ?? 'eu').split(',').map(s => s.trim()).filter(Boolean),

  // Mercato 1X2 (in The Odds API si chiama 'h2h' e per il calcio include il pareggio).
  markets: 'h2h',

  // Formato quota decimale (europeo).
  oddsFormat: 'decimal',

  // Opzionale: whitelist di bookmaker da mostrare/valutare (chiavi The Odds API).
  // Vuoto = tutti quelli restituiti. Es: 'pinnacle,unibet_it,betclic'
  bookmakerFilter: (process.env.BOOKMAKERS ?? '').split(',').map(s => s.trim()).filter(Boolean),

  // Ignora le partite che iniziano oltre N giorni da adesso (riduce rumore).
  maxDaysAhead: Number(process.env.MAX_DAYS_AHEAD ?? 14),

  // Percorsi di output.
  paths: {
    odds: 'docs/data/odds.json',
    alerts: 'docs/data/alerts.json',
    state: 'docs/data/state.json',
  },
};

export const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
