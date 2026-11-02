# BetBot — monitor quote 1X2

Monitor delle quote 1X2 (Serie A, La Liga, Ligue 1): avvisa quando la quota della squadra
ospite (il "2") scende sotto soglia (default 1.80, media di mercato). Gira da solo su
GitHub Actions ogni 6 ore e pubblica le pagine su GitHub Pages. Dettagli completi: README.md.

## Struttura
- `.github/workflows/monitor.yml` — cron ogni 6h: esegue `scripts/fetch-odds.mjs` e committa `docs/data/`
- `scripts/config.mjs` — soglia, campionati, regioni, modo di alert (average / any / best)
- `scripts/providers/the-odds-api.mjs` — unico punto che parla con il feed quote
- `scripts/rules.mjs` — logica della strategia (pura, testata)
- `scripts/history.mjs`, `scripts/results.mjs`, `scripts/results/espn.mjs` — storico e risultati
- `scripts/alerts/telegram.mjs` — messaggio di alert
- `docs/` — pagine statiche: `index.html` (segnali), `tracker.html` (registro giocate)
- `docs/data/*.json` — dati scritti dal workflow: NON modificarli a mano

## Comandi
- Test (Node 24 installato): `node tests/run-node.mjs` — tutti; `node tests/run-node.mjs rules` — uno solo
- Un giro in locale richiede `ODDS_API_KEY` nell'ambiente: di norma non serve, si usa
  "Run workflow" da GitHub (workflow_dispatch)

## Regole
- Il repository è PUBBLICO (github.com/Maxsemper/BetBot): mai committare chiavi, token o dati personali.
- I dati del tracker (giocate, stake) stanno nel localStorage del browser, non nel repo: è voluto.
- The Odds API piano gratuito: 500 crediti/mese, 3 per giro. Non aumentare la frequenza
  del cron o i campionati senza ricalcolare i crediti.
- Dopo una modifica a `scripts/` o `docs/*.js` esegui i test prima di committare.
- Commit in italiano, stile `fix: ...` / `feat: ...`.
