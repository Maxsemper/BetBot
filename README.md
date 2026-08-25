# Monitor Quote — Serie A / La Liga / Ligue 1

Monitora le quote **1X2** dei tre campionati e avvisa su **Telegram** quando la quota
della **squadra ospite (il "2")** scende a **≤ 1.85**.

Gira su **GitHub Actions ogni 6 ore** (nessuna installazione sul PC) e pubblica una
pagina di consultazione su **GitHub Pages**.

---

## Cosa sapere prima di iniziare

**bet365 ed Eurobet non espongono API pubbliche.** bet365 blocca attivamente lo
scraping; Eurobet non ha un feed documentato. Questo progetto parte quindi con
[The Odds API](https://the-odds-api.com), che copre i tre campionati e il mercato 1X2
con i bookmaker della regione europea (Pinnacle, Betclic, Unibet IT/FR, Codere IT,
Betsson, 1xBet, Winamax, William Hill…).

Il provider è isolato in `scripts/providers/`: per passare a un feed a pagamento con le
quote bet365 reali basta scrivere un file gemello e cambiare una riga di import in
`scripts/fetch-odds.mjs`. Vedi [Cambiare sorgente quote](#cambiare-sorgente-quote).

**Consumo crediti.** Il piano gratuito dà 500 crediti/mese. Un giro costa 3 crediti
(1 per campionato, regione `eu`, mercato `h2h`). A 6 ore → ~360/mese, dentro il piano
gratuito. A 3 ore → ~744/mese, serve un piano a pagamento.

---

## Attivazione (una volta sola)

### 1. Chiave The Odds API
Registrati su <https://the-odds-api.com/#get-access> e copia la API key.

### 2. Bot Telegram
1. Su Telegram scrivi a **@BotFather** → `/newbot` → scegli nome e username.
   Ricevi un token tipo `123456789:AAE...`.
2. Apri una chat con il tuo bot e mandagli un messaggio qualsiasi (serve a sbloccarlo).
3. Recupera il tuo chat id aprendo nel browser:
   `https://api.telegram.org/bot<IL_TUO_TOKEN>/getUpdates`
   e cerca `"chat":{"id":123456789`. Quel numero è il `TELEGRAM_CHAT_ID`.

### 3. Repository GitHub
```bash
git init
git add .
git commit -m "feat: monitor quote 1X2 con alert sulla squadra ospite"
git branch -M main
git remote add origin https://github.com/<tuo-utente>/<tuo-repo>.git
git push -u origin main
```

### 4. Secret
Nel repo: **Settings → Secrets and variables → Actions → New repository secret**.
Aggiungi tre secret:

| Nome | Valore |
| --- | --- |
| `ODDS_API_KEY` | la chiave The Odds API |
| `TELEGRAM_BOT_TOKEN` | il token di BotFather |
| `TELEGRAM_CHAT_ID` | il tuo chat id numerico |

### 5. GitHub Pages
**Settings → Pages → Source: Deploy from a branch → Branch: `main`, cartella `/docs`.**
La pagina sarà su `https://<tuo-utente>.github.io/<tuo-repo>/`.

### 6. Primo avvio
**Actions → Monitor quote → Run workflow.** Da lì in poi parte da solo ogni 6 ore.

> GitHub disattiva i workflow schedulati nei repository senza attività per 60 giorni.
> Il job fa commit a ogni aggiornamento, quindi in pratica resta sempre attivo.

---

## Come funziona

```
.github/workflows/monitor.yml   cron ogni 6h -> esegue lo script -> committa i dati
scripts/config.mjs              soglia, campionati, regioni, modo di alert
scripts/providers/*.mjs         l'unico punto che parla con il feed quote
scripts/rules.mjs               la logica della strategia (pura, testabile)
scripts/alerts/telegram.mjs     costruzione e invio del messaggio
scripts/fetch-odds.mjs          orchestratore
docs/                           la pagina web (GitHub Pages)
docs/data/*.json                output del job: quote, storico alert, stato dedup
tests/rules.test.html           test della logica, si aprono nel browser
```

Ogni giro: scarica le quote → calcola min/max/media del "2" per ogni partita →
segna quelle sotto soglia → notifica **solo le novità** rispetto al giro precedente
(niente messaggi ripetuti ogni 6 ore per la stessa partita) → riscrive i JSON.

Una partita che risale sopra soglia esce dallo stato: se in seguito ci rientra,
riceverai un nuovo alert.

---

## Configurazione

Si cambia tutto da `scripts/config.mjs` o via variabili d'ambiente nel workflow.

| Variabile | Default | Significato |
| --- | --- | --- |
| `ODDS_THRESHOLD` | `1.85` | soglia sulla quota "2" (inclusiva) |
| `ALERT_MODE` | `any` | `any` = basta un bookmaker sotto soglia · `best` = anche la quota più alta è sotto soglia · `average` = media sotto soglia |
| `ODDS_REGIONS` | `eu` | regioni bookmaker; **ogni regione in più raddoppia il consumo di crediti** |
| `BOOKMAKERS` | *(vuoto)* | whitelist di bookmaker, es. `pinnacle,unibet_it,betclic` |
| `MAX_DAYS_AHEAD` | `14` | ignora le partite oltre N giorni |

**Cambiare frequenza:** modifica il `cron` in `.github/workflows/monitor.yml`.
`0 */3 * * *` = ogni 3 ore (ricorda il costo in crediti).

**Modo di alert consigliato:** `any` è la lettura letterale della regola ma è il più
rumoroso — basta un singolo bookmaker fuori linea. `best` segnala solo quando *tutto*
il mercato prezza l'ospite sotto 1.85, ed è il segnale più solido.

---

## Cambiare sorgente quote

1. Crea `scripts/providers/mio-feed.mjs` che esporta `NAME` e
   `async function fetchOdds(config)`.
2. Deve restituire:

```js
{
  provider: 'mio-feed',
  fetchedAt: '2026-08-25T12:00:00Z',
  quota: { remaining: null, used: null, lastCost: null },
  errors: [],
  leagues: [{
    key: 'soccer_italy_serie_a', label: 'Serie A', country: 'IT',
    matches: [{
      id: 'univoco', commenceTime: '2026-08-29T18:45:00Z',
      home: 'Lecce', away: 'Inter',
      books: [{ key: 'bet365', title: 'bet365', home: 6.1, draw: 4.2, away: 1.62 }]
    }]
  }]
}
```

3. In `scripts/fetch-odds.mjs` cambia la riga marcata `>>> Per cambiare sorgente <<<`.

Il resto — regola, dedup, alert, pagina — continua a funzionare senza modifiche.

Feed con quote bet365 reali (a pagamento): [odds-api.io](https://odds-api.io/sportsbooks/bet365),
[TheStatsAPI](https://www.thestatsapi.com/odds-api/bet365), [SharpAPI](https://sharpapi.io/sportsbooks/bet365-odds-api).

---

## Test

Aprire `tests/rules.test.html` **da un server HTTP** (i moduli ES non si caricano da
`file://`). Il più semplice, senza installare nulla, con PowerShell:

```bash
powershell -NoProfile -Command "$l=[Net.HttpListener]::new();$l.Prefixes.Add('http://localhost:8080/');$l.Start();Write-Host 'http://localhost:8080/tests/rules.test.html';while($l.IsListening){$c=$l.GetContext();$p=Join-Path (Get-Location) $c.Request.Url.AbsolutePath.TrimStart('/');if(Test-Path -LiteralPath $p -PathType Leaf){$b=[IO.File]::ReadAllBytes($p);$e=[IO.Path]::GetExtension($p);$c.Response.ContentType=@{'.html'='text/html';'.js'='text/javascript';'.mjs'='text/javascript';'.css'='text/css';'.json'='application/json'}[$e];$c.Response.OutputStream.Write($b,0,$b.Length)}else{$c.Response.StatusCode=404};$c.Response.Close()}"
```

Poi apri <http://localhost:8080/tests/rules.test.html> (la pagina in
<http://localhost:8080/docs/>).

---

## Avvertenze

Le quote mostrate provengono da un aggregatore e possono differire da quelle del
bookmaker al momento della giocata: verifica sempre sul sito prima di puntare.
Nessuna scommessa viene piazzata automaticamente — questo strumento osserva e basta.
