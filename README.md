# BetBot — Monitor quote e tracker, Serie A / La Liga / Ligue 1

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
scripts/history.mjs             storico per partita e calcolo salita/discesa
scripts/results.mjs             registro dei risultati delle partite giocate
scripts/results/espn.mjs        fonte risultati gratuita, senza chiave
docs/team-match.js              abbinamento nomi squadra fra i due feed
scripts/alerts/telegram.mjs     costruzione e invio del messaggio
scripts/fetch-odds.mjs          orchestratore
docs/index.html                 pagina Segnali: partite e quote sotto soglia
docs/tracker.html + tracker*.js pagina Tracker: registro reale delle giocate
docs/data/*.json                output del job: quote, storico alert, stato dedup
tests/*.test.html               test della logica, si aprono nel browser
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
| `EXCLUDE_EXCHANGES` | `true` | esclude Betfair, Matchbook, Smarkets dal calcolo — vedi sotto |
| `MAX_DEVIATION` | `1.30` | scarta le quote oltre ±30% dalla mediana; `0` disattiva |
| `TREND_THRESHOLD_PCT` | `1` | sotto questa variazione % la quota è "stabile" |
| `MAX_DAYS_AHEAD` | `14` | ignora le partite oltre N giorni |

### Perché gli exchange sono esclusi

Non è una scelta di gusto: al primo giro con dati reali, su 12 partite segnalate
**8 erano falsi allarmi**, tutti generati da Betfair. Esempi veri:

```
AS Roma - Atalanta   Betfair: 2 = 1.06   (gli altri 22 bookmaker: ~3.10)
Genoa   - Como       Betfair: 1 = 1.10, X = 1.08, 2 = 1.32
```

Tre quote sotto 1.35 sulla stessa partita sono impossibili in un mercato vero: su
partite lontane il book dell'exchange è vuoto e i prezzi esposti non hanno
significato. Gli exchange non sono bookmaker — sono un mercato tra utenti, con
commissioni e liquidità propri — e vanno tenuti fuori dal segnale.

Il filtro `MAX_DEVIATION` copre il caso residuo: un singolo bookmaker fuori linea
rispetto alla mediana del mercato non deve far scattare un alert da solo.

I bookmaker esclusi **restano visibili nella pagina**, in grigio e con il motivo:
sono utili da vedere, non da usare per decidere.

**Modo di alert consigliato:** `any` è la lettura letterale della regola ma è il più
rumoroso — basta un singolo bookmaker fuori linea. `best` segnala solo quando *tutto*
il mercato prezza l'ospite sotto 1.85, ed è il segnale più solido.

**Cambiare frequenza:** modifica il `cron` in `.github/workflows/monitor.yml`.
Attenzione al costo: ogni giro consuma 3 crediti (1 per campionato) a prescindere
da quante partite ci sono.

| Frequenza | Giri/giorno | Crediti/mese | Piano gratuito (500) |
| --- | --- | --- | --- |
| ogni 6h (attuale) | 4 | ~365 | ✅ |
| ogni 4h | 6 | ~548 | ❌ |
| ogni 3h | 8 | ~730 | ❌ |
| ogni ora | 24 | ~2190 | ❌ |

Sui tre campionati, **6 ore è il massimo che il piano gratuito consente**.

---

## Tendenza della quota

Ogni partita mostra se la quota del "2" sta **scendendo** (▼ verde: squadra ospite
sempre più favorita, il verso che interessa alla strategia), **salendo** (▲ rosso) o
è stabile, con uno sparkline dell'andamento recente. Il dettaglio completo —
variazione dal giro precedente, variazione dalla prima rilevazione, numero di
rilevazioni — è nel tooltip della freccia.

**Non costa crediti API:** sono gli stessi dati del giro corrente, confrontati con
quelli conservati in `docs/data/history.json`. La risoluzione è però quella del cron:
a 6 ore si vede la deriva di fondo, non i movimenti nelle ore prima del fischio
d'inizio, che sono i più bruschi.

Due scelte che vale la pena conoscere:

- Il confronto usa la **media** dei bookmaker, non il minimo. Il minimo dipende da
  quale singolo bookmaker è più basso in quel momento e salta anche quando il mercato
  non si è mosso; la media è il consenso.
- Lo sparkline ha la **scala ancorata** a un minimo del 4% del valore. Senza,
  si autoscalerebbe sul proprio intervallo e un'oscillazione da centesimo
  sembrerebbe un crollo.

La prima rilevazione di una partita mostra `nuova`: serve un secondo giro perché
ci sia un termine di paragone.

---

## Tracker

Seconda pagina (`tracker.html`): il registro reale delle giocate, con cui costruire
lo storico dell'andamento della strategia. Per ogni riga: partita, esito
(vinta / persa / annullata), quota, stake, profit/loss in euro (calcolato ma
correggibile a mano), note.
In cima il riepilogo — P/L, ROI, win rate, stake totale, quota media — e sotto lo
stesso riepilogo diviso per campionato.

### Come entrano ed escono le partite

Le partite sotto soglia entrano **da sole**, e finché non le tocchi restano libere
di uscire: se la quota risale sopra 1.85 la riga sparisce, se ci ridiscende torna.

Una riga si **blocca** — e non si muove più — in tre casi:

| | |
| --- | --- |
| 📌 la fissi tu | col pulsante nella prima colonna |
| dati inseriti | appena scrivi stake, esito o una nota, la riga si fissa da sola |
| 🔒 partita iniziata | al fischio d'inizio diventa storia e resta per sempre |

Il secondo caso è la garanzia che conta: **una riga in cui hai messo dei soldi non
può sparire perché il mercato si è mosso.**

Su una riga bloccata la quota che hai inserito non viene mai sovrascritta — è quella
che hai davvero ottenuto dal bookmaker, e può differire da qualsiasi quota del feed.
Il riferimento di mercato (`segnale 1.46`) continua invece ad aggiornarsi, così vedi
se hai preso una quota migliore o peggiore del mercato.

Puoi aggiungere partite a mano con **+ Aggiungi partita**, anche di campionati o
incontri che il monitor non ha segnalato.

### Il P/L si può correggere a mano (cashout)

Di norma il profitto è calcolato: `stake × (quota − 1)` se vinta, `−stake` se persa.
Ma il calcolo non descrive tutto — il caso tipico è il **cashout**: la partita finisce
vinta, ma tu hai chiuso prima e hai incassato meno, o hai perso.

Il campo **P/L** è quindi scrivibile. Quando lo compili:

- il valore che hai messo **sostituisce il calcolo** in tutti i conteggi;
- la cella si marca `man.` e il segnaposto continua a mostrarti quanto avrebbe reso;
- **svuotando il campo si torna al calcolo automatico**.

Conseguenza da tenere presente, perché è voluta ma sorprende: **win rate e P/L
possono divergere**. Una partita segnata `Vinta` con P/L `−4.50` conta come vinta nel
win rate e come perdita nel profitto. È il comportamento corretto per uno storico
reale — puoi avere il 70% di vincite e un bilancio negativo — e la pagina lo dichiara
con una nota sotto le statistiche quando ci sono righe corrette a mano.

Nell'export CSV c'è una colonna **P/L manuale**: senza, in Excel una riga con cashout
sembrerebbe un errore di calcolo.

### Gli esiti si compilano da soli

Quando una partita finisce, il job ne recupera il punteggio e la pagina compila
`Vinta` / `Persa` senza che tu debba fare niente. La riga mostra il risultato
(`1–2`) e l'etichetta `auto`; il profitto si calcola di conseguenza.

**Non consuma crediti di The Odds API.** La fonte è l'API pubblica di ESPN, che non
richiede chiave: `scripts/results/espn.mjs`. Il job la interroga solo per i
campionati che hanno partite finite e ancora senza punteggio — nei giri in cui non
c'è niente da risolvere non fa nessuna chiamata.

Due garanzie:

- **Un esito che hai messo tu non viene mai sovrascritto.** Se correggi un esito
  automatico, l'etichetta `auto` sparisce: da quel momento è un dato tuo.
- **In caso di dubbio non indovina.** Se la partita non viene abbinata con certezza,
  resta senza esito e la compili a mano.

Il pareggio conta come **persa**: la scommessa è sul "2", non sul "doppia chance".

#### L'abbinamento dei nomi

I due feed chiamano le squadre in modo diverso, e questo è il punto delicato:

```
The Odds API                     ESPN
Inter Milan                      Internazionale
Rennes                           Stade Rennais
Real Racing Club de Santander    Racing Santander
Auxerre                          AJ Auxerre
```

`docs/team-match.js` normalizza (accenti, trattini, sigle come `AC`/`AJ`/`LOSC`) e
usa una piccola tabella di alias per i casi senza parole in comune. Sulle 42 partite
attualmente nel feed abbina 42 su 42.

La regola più importante è quella che evita i **falsi abbinamenti**: un nome ridotto
a una sola parola deve coincidere esattamente, mai essere "contenuto" nell'altro.
Senza questo vincolo `Paris FC` risulterebbe contenuto in `Paris Saint-Germain` —
due squadre diverse dello stesso campionato. `Real` non è fra le parole ignorate,
altrimenti Real Madrid, Real Sociedad e Real Betis si confonderebbero fra loro.

Se una partita non viene abbinata, il job la segnala nei log (`non abbinata: …`) e la
tiene in attesa per dieci giorni: è così che ci si accorge di un alias mancante.

### Dove finiscono i dati

**Nel tuo browser, e da nessun'altra parte.** Il repository è pubblico: stake e
profitti non devono finirci, quindi il tracker usa `localStorage` e non invia nulla
a GitHub né altrove.

Il rovescio della medaglia: **svuotare i dati del sito cancella lo storico**, e i dati
non si sincronizzano tra PC e telefono. Per questo ci sono:

- **Backup** — scarica un JSON con tutto; **Ripristina** lo rilegge (validandolo:
  un file malformato viene rifiutato invece di corrompere lo storico).
- **Esporta CSV** — per Excel, con `;` e virgola decimale, così si apre con un doppio
  clic senza procedura di importazione.

Se un giorno vorrai lo storico sincronizzato tra dispositivi, servirà un repository
privato o un backend: non si può fare restando su una pagina statica pubblica.

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

105 test in tutto: `tests/rules.test.html` (37, segnale e tendenza),
`tests/tracker.test.html` (45, tracker) e `tests/results.test.html` (23, risultati
e abbinamento nomi). Vanno aperti **da un server HTTP** (i moduli ES non si caricano da
`file://`). Il più semplice, senza installare nulla, con PowerShell:

```bash
powershell -NoProfile -Command "$l=[Net.HttpListener]::new();$l.Prefixes.Add('http://localhost:8080/');$l.Start();Write-Host 'http://localhost:8080/tests/rules.test.html';while($l.IsListening){$c=$l.GetContext();$p=Join-Path (Get-Location) $c.Request.Url.AbsolutePath.TrimStart('/');if(Test-Path -LiteralPath $p -PathType Leaf){$b=[IO.File]::ReadAllBytes($p);$e=[IO.Path]::GetExtension($p);$c.Response.ContentType=@{'.html'='text/html';'.js'='text/javascript';'.mjs'='text/javascript';'.css'='text/css';'.json'='application/json'}[$e];$c.Response.OutputStream.Write($b,0,$b.Length)}else{$c.Response.StatusCode=404};$c.Response.Close()}"
```

Poi apri <http://localhost:8080/tests/rules.test.html> e
<http://localhost:8080/tests/tracker.test.html> (le pagine sono in
<http://localhost:8080/docs/>).

---

## Avvertenze

Le quote mostrate provengono da un aggregatore e possono differire da quelle del
bookmaker al momento della giocata: verifica sempre sul sito prima di puntare.
Nessuna scommessa viene piazzata automaticamente — questo strumento osserva e basta.
