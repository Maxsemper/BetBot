// Configurazione centrale del monitor quote.
// Tutti i valori possono essere sovrascritti da variabili d'ambiente
// (utile per cambiare soglia o campionati senza toccare il codice).

// Fuori da Node (browser, test) `process` non esiste: si cade sui default.
const env = globalThis.process?.env ?? {};

export const CONFIG = {
  // Soglia di alert: scatta quando la quota del "2" (squadra ospite) e' <= a questo valore.
  // Si confronta con la MEDIA dei bookmaker: vedi alertMode.
  threshold: Number(env.ODDS_THRESHOLD ?? 1.80),

  // Come valutare la soglia quando piu' bookmaker quotano la stessa partita:
  //   'average' -> alert sulla media dei bookmaker, cioe' sul consenso di mercato (default)
  //   'any'     -> alert se ALMENO UN bookmaker e' <= soglia: piu' rumoroso, basta
  //                un singolo book fuori linea
  //   'best'    -> alert se anche la quota PIU' ALTA e' <= soglia (segnale piu' forte)
  alertMode: env.ALERT_MODE ?? 'average',

  // Campionati monitorati. Le chiavi sono quelle di The Odds API.
  leagues: [
    { key: 'soccer_italy_serie_a',   label: 'Serie A',   country: 'IT' },
    { key: 'soccer_spain_la_liga',   label: 'La Liga',   country: 'ES' },
    { key: 'soccer_france_ligue_one', label: 'Ligue 1',  country: 'FR' },
  ],

  // Regioni bookmaker. Ogni regione in piu' RADDOPPIA il consumo di crediti.
  // 'eu' -> Pinnacle, Betclic, Unibet IT/FR, Codere IT, Betsson, 1xBet, Winamax, William Hill...
  regions: (env.ODDS_REGIONS ?? 'eu').split(',').map(s => s.trim()).filter(Boolean),

  // Mercato 1X2 (in The Odds API si chiama 'h2h' e per il calcio include il pareggio).
  markets: 'h2h',

  // Formato quota decimale (europeo).
  oddsFormat: 'decimal',

  // Opzionale: whitelist di bookmaker da mostrare/valutare (chiavi The Odds API).
  // Vuoto = tutti quelli restituiti. Es: 'pinnacle,unibet_it,betclic'
  bookmakerFilter: (env.BOOKMAKERS ?? '').split(',').map(s => s.trim()).filter(Boolean),

  // Esclude gli exchange (Betfair, Matchbook, Smarkets...): non sono bookmaker
  // e su partite lontane, senza liquidita', mostrano quote prive di senso.
  excludeExchanges: (env.EXCLUDE_EXCHANGES ?? 'true') !== 'false',

  // Scarta le quote troppo distanti dalla mediana del mercato (1.30 = ±30%).
  // Serve a non far scattare un alert per un singolo bookmaker fuori linea.
  // 0 disattiva il filtro.
  maxDeviation: Number(env.MAX_DEVIATION ?? 1.30),

  // Sotto questa variazione percentuale della media, la quota e' "stabile".
  // Serve a non mostrare frecce per oscillazioni da centesimo.
  trendThresholdPct: Number(env.TREND_THRESHOLD_PCT ?? 1),

  // Ignora le partite che iniziano oltre N giorni da adesso (riduce rumore).
  maxDaysAhead: Number(env.MAX_DAYS_AHEAD ?? 14),

  // Percorsi di output.
  paths: {
    odds: 'docs/data/odds.json',
    alerts: 'docs/data/alerts.json',
    state: 'docs/data/state.json',
    history: 'docs/data/history.json',
    results: 'docs/data/results.json',
  },
};

export const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
