// Invio alert via bot Telegram.
// Richiede due secret: TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.

const API = 'https://api.telegram.org';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatKickoff(iso) {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Tendenza della quota rispetto al giro precedente, in coda alla riga di
 * riepilogo. Stringa vuota se la partita e' appena comparsa nel feed e non
 * c'e' ancora un termine di paragone.
 */
function formatTrend(trend) {
  if (!trend) return '';
  const arrow = { down: '▼', up: '▲', flat: '=' }[trend.direction];
  const sign = trend.delta > 0 ? '+' : '';
  const move = trend.direction === 'flat' ? 'stabile' : `${sign}${trend.delta.toFixed(2)}`;
  return ` · ${arrow} ${move} (da ${trend.open.toFixed(2)})`;
}

/**
 * Costruisce il messaggio per un gruppo di alert.
 * @param {Array} alerts elementi prodotti da collectTriggered()
 * @param {number} threshold
 */
export function buildMessage(alerts, threshold, pageUrl) {
  const head = `<b>⚽ Quota "2" ≤ ${threshold}</b>
${alerts.length} ${alerts.length === 1 ? "segnale rilevato" : "segnali rilevati"}
`;

  const body = alerts.map(a => {
    const books = a.matchingBooks
      .map(b => `    • ${escapeHtml(b.title)}: <b>${b.away.toFixed(2)}</b>`)
      .join('\n');
    return [
      ``,
      `<b>${escapeHtml(a.league)}</b> — ${formatKickoff(a.commenceTime)}`,
      `${escapeHtml(a.home)} - <b>${escapeHtml(a.away)}</b>`,
      `  Quota 2 (${escapeHtml(a.away)}):`,
      books,
      `  <i>migliore: ${a.bestAway.toFixed(2)} · media: ${a.avgAway.toFixed(2)}${formatTrend(a.trend)}</i>`,
    ].join('\n');
  }).join('\n');

  const foot = pageUrl ? `\n\n<a href="${pageUrl}">Apri il monitor</a>` : '';
  return head + body + foot;
}

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('  Telegram non configurato (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID mancanti): alert non inviato.');
    return false;
  }

  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`  Telegram HTTP ${res.status}: ${body.slice(0, 300)}`);
    return false;
  }
  console.log('  Alert Telegram inviato.');
  return true;
}
