// Orchestratore: scarica le quote, applica la regola, invia gli alert,
// scrive i JSON che alimentano la pagina web.
//
// Uso: node scripts/fetch-odds.mjs
// Env: ODDS_API_KEY (obbligatoria), TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (per gli alert)

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CONFIG } from './config.mjs';
import { annotate, collectTriggered, diffAgainstState } from './rules.mjs';
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

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function main() {
  const config = CONFIG;
  console.log(`Monitor quote — provider: ${PROVIDER}`);
  console.log(`Soglia: quota "2" <= ${config.threshold} (modo: ${config.alertMode}) · regioni: ${config.regions.join(',')}`);

  const data = annotate(await fetchOdds(config), config);
  const triggered = collectTriggered(data, config);
  const total = data.leagues.reduce((n, l) => n + l.matches.length, 0);
  console.log(`Partite totali: ${total} · sotto soglia: ${triggered.length}`);

  const state = await readJson(config.paths.state, { active: {} });
  const { fresh, nextActive } = diffAgainstState(triggered, state);
  console.log(`Nuovi segnali da notificare: ${fresh.length}`);

  if (fresh.length) {
    await sendTelegram(buildMessage(fresh, config.threshold, process.env.PAGE_URL ?? ''));
  }

  const history = await readJson(config.paths.alerts, { items: [] });
  const items = [
    ...fresh.map(a => ({ ...a, notifiedAt: new Date().toISOString() })),
    ...history.items,
  ].slice(0, MAX_ALERT_HISTORY);

  data.threshold = config.threshold;
  data.alertMode = config.alertMode;
  data.triggeredCount = triggered.length;

  await writeJson(config.paths.odds, data);
  await writeJson(config.paths.alerts, { updatedAt: new Date().toISOString(), items });
  await writeJson(config.paths.state, { updatedAt: new Date().toISOString(), active: nextActive });

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
