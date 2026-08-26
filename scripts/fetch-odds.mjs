// Orchestratore: scarica le quote, applica la regola, invia gli alert,
// scrive i JSON che alimentano la pagina web.
//
// Uso: node scripts/fetch-odds.mjs
// Env: ODDS_API_KEY (obbligatoria), TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (per gli alert)

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CONFIG } from './config.mjs';
import { annotate, collectTriggered, diffAgainstState } from './rules.mjs';
import { appendSamples, attachTrends } from './history.mjs';
import { updateResults } from './results.mjs';
// >>> Per cambiare sorgente quote, sostituisci solo questa riga. <<<
import { fetchOdds, NAME as PROVIDER } from './providers/the-odds-api.mjs';
import { sendTelegram, buildMessage } from './alerts/telegram.mjs';

const MAX_ALERT_HISTORY = 200;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * `pretty` solo per i file piccoli che ha senso leggere in un diff.
 * odds.json viene riscritto per intero a ogni giro (4 volte al giorno): indentarlo
 * aggiungerebbe ~100 KB per commit alla cronologia del repository, senza vantaggi.
 */
async function writeJson(path, value, { pretty = true } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const json = pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value);
  await writeFile(path, json, 'utf8');
}

async function main() {
  const config = CONFIG;
  console.log(`Monitor quote — provider: ${PROVIDER}`);
  console.log(`Soglia: quota "2" <= ${config.threshold} (modo: ${config.alertMode}) · regioni: ${config.regions.join(',')}`);

  const data = annotate(await fetchOdds(config), config);

  // Il trend va calcolato prima di raccogliere i segnali, cosi' finisce anche
  // nel messaggio di alert ("in discesa da 1.78").
  const history = appendSamples(await readJson(config.paths.history, null), data);
  attachTrends(data, history, config.trendThresholdPct);

  const triggered = collectTriggered(data, config);
  const total = data.leagues.reduce((n, l) => n + l.matches.length, 0);
  console.log(`Partite totali: ${total} · sotto soglia: ${triggered.length}`);

  const state = await readJson(config.paths.state, { active: {} });
  const { fresh, nextActive } = diffAgainstState(triggered, state);
  console.log(`Nuovi segnali da notificare: ${fresh.length}`);

  if (fresh.length) {
    await sendTelegram(buildMessage(fresh, config.threshold, process.env.PAGE_URL ?? ''));
  }

  // Risultati delle partite ormai giocate. Fonte gratuita e separata da quella
  // delle quote: non consuma crediti. Un suo guasto non deve far fallire il giro.
  const { registry, resolved, errors: resultErrors } = await updateResults(
    await readJson(config.paths.results, null), data);
  console.log(`Risultati: ${resolved} nuovi · ${Object.keys(registry.pending).length} in attesa`
    + (registry.unmatched.length ? ` · ${registry.unmatched.length} non abbinate` : ''));
  for (const u of registry.unmatched) console.warn(`  non abbinata: ${u}`);
  for (const e of resultErrors) console.warn(`  fonte risultati non raggiungibile — ${e}`);

  const alertHistory = await readJson(config.paths.alerts, { items: [] });
  const items = [
    ...fresh.map(a => ({ ...a, notifiedAt: new Date().toISOString() })),
    ...alertHistory.items,
  ].slice(0, MAX_ALERT_HISTORY);

  data.threshold = config.threshold;
  data.alertMode = config.alertMode;
  data.triggeredCount = triggered.length;

  await writeJson(config.paths.odds, data, { pretty: false });
  await writeJson(config.paths.alerts, { updatedAt: new Date().toISOString(), items });
  await writeJson(config.paths.state, { updatedAt: new Date().toISOString(), active: nextActive });
  await writeJson(config.paths.history, history, { pretty: false });
  await writeJson(config.paths.results, registry, { pretty: false });

  if (data.errors.length) {
    console.error(`Completato con ${data.errors.length} errore/i:\n - ${data.errors.join('\n - ')}`);
    process.exitCode = 1;
  } else {
    console.log('Completato.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
