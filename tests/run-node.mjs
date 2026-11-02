// Esegue i test tests/*.test.html con Node, senza browser.
// Uso: node tests/run-node.mjs            (tutti)
//      node tests/run-node.mjs rules      (solo quelli il cui nome contiene "rules")
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const qui = dirname(fileURLToPath(import.meta.url));
const radice = pathToFileURL(join(qui, '..') + '/').href;
const filtro = process.argv[2] || '';
const tmp = mkdtempSync(join(tmpdir(), 'betbot-test-'));
let falliti = 0;

// Le pagine di test scrivono il risultato in <pre id="out">: lo stampo a terminale.
let uscita = '';
globalThis.document = { getElementById: () => ({ set textContent(v) { uscita = v; } }) };
const memoria = new Map();
globalThis.localStorage ??= {
  getItem: k => (memoria.has(k) ? memoria.get(k) : null), setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: k => memoria.delete(k), clear: () => memoria.clear(),
};

for (const file of readdirSync(qui).filter(f => f.endsWith('.test.html') && f.includes(filtro)).sort()) {
  const html = readFileSync(join(qui, file), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) { console.log(`${file}: nessuno script di test`); continue; }
  const codice = m[1].replace(/(from\s+['"])\.\.\//g, `$1${radice}`).replace(/(import\(\s*['"])\.\.\//g, `$1${radice}`);
  const modulo = join(tmp, file.replace('.html', '.mjs'));
  writeFileSync(modulo, codice);
  uscita = '';
  try {
    await import(pathToFileURL(modulo).href);
    await new Promise(r => setTimeout(r, 50)); // eventuali test asincroni
  } catch (e) {
    uscita = `ERRORE durante l'esecuzione: ${e.stack || e}`;
  }
  const ko = /TEST FALLITI|ERRORE/.test(uscita) || !uscita;
  if (ko) falliti++;
  const righe = uscita.split('\n');
  console.log(`\n=== ${file}: ${righe[righe.length - 1] || 'nessun risultato'}`);
  for (const r of righe) if (r.startsWith('FAIL') || r.startsWith('ERRORE') || r.startsWith('        ')) console.log(r);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(falliti ? 1 : 0);
