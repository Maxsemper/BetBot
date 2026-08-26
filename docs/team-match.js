// Abbinamento dei nomi squadra fra due feed diversi.
//
// Il feed delle quote e quello dei risultati chiamano le squadre in modi diversi
// ("Inter Milan" contro "Internazionale", "Rennes" contro "Stade Rennais").
// Questo modulo e' condiviso fra lo script Node e la pagina Tracker: deve stare
// in docs/ perche' e' l'unica cartella pubblicata da GitHub Pages.

// Parole che non distinguono una squadra dall'altra.
// "Real" NON e' qui dentro: toglierlo confonderebbe Real Madrid, Real Sociedad
// e Real Betis fra loro.
const RUMORE = new Set([
  'fc', 'ac', 'as', 'ca', 'cf', 'ss', 'ssc', 'acf', 'us', 'rc', 'sc', 'cd', 'ud',
  'sd', 'afc', 'bc', 'ogc', 'rcd', 'calcio', 'club', 'de', 'del', 'della', 'di',
  'stade', 'olympique', 'football', 'the',
  // Sigle francesi: "AJ Auxerre" e "Auxerre" sono la stessa squadra.
  'aj', 'sm', 'ea', 'losc', 'esctc',
]);

/**
 * Casi che nessuna normalizzazione puo' risolvere, perche' i due feed usano
 * nomi senza parole in comune. Chiave e valore sono gia' normalizzati.
 * Ogni voce qui e' stata verificata su dati reali dei due feed.
 */
const ALIAS = new Map(Object.entries({
  // Serie A
  'inter milan': 'inter',
  'internazionale': 'inter',
  // Ligue 1 — "Stade Rennais" perde "stade" e resta "rennais"
  'rennais': 'rennes',
  'lyonnais': 'lyon',
  // La Liga
  'deportivo la coruna': 'deportivo',
  'athletic bilbao': 'athletic',
  'athletic': 'athletic',
}));

/** Nome -> elenco di parole significative, minuscole e senza accenti. */
export function tokens(name) {
  const base = String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w && !RUMORE.has(w));

  const alias = ALIAS.get(base.join(' '));
  return alias ? alias.split(' ') : base;
}

/**
 * Due nomi indicano la stessa squadra?
 *
 * Un nome puo' essere piu' corto dell'altro ("Atalanta" / "Atalanta BC"), quindi
 * si accetta che il piu' corto sia contenuto nel piu' lungo — ma solo se ha
 * almeno due parole. Senza questo vincolo "Paris FC", che si riduce a "paris",
 * risulterebbe contenuto in "Paris Saint-Germain": due squadre diverse dello
 * stesso campionato.
 */
export function sameTeam(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;

  const [corto, lungo] = x.length <= y.length ? [x, y] : [y, x];
  if (corto.length === lungo.length) return corto.every((w, i) => w === lungo[i]);
  if (corto.length < 2) return false;
  return corto.every(w => lungo.includes(w));
}

const GIORNO = 24 * 60 * 60 * 1000;

/**
 * Cerca fra i risultati quello corrispondente a una partita.
 *
 * Devono coincidere entrambe le squadre, nel verso giusto, e la data entro un
 * giorno (i fusi orari e i rinvii di poche ore non devono far fallire
 * l'abbinamento). Se i candidati sono piu' di uno la partita si considera
 * NON abbinata: meglio nessun risultato che quello sbagliato.
 *
 * @returns {object|null}
 */
export function findFixture(match, fixtures, toleranceMs = GIORNO) {
  const t = Date.parse(match.commenceTime);
  const candidati = fixtures.filter(f =>
    sameTeam(f.home, match.home) &&
    sameTeam(f.away, match.away) &&
    (!Number.isFinite(t) || Math.abs(Date.parse(f.commenceTime) - t) <= toleranceMs));

  return candidati.length === 1 ? candidati[0] : null;
}

/**
 * Esito della scommessa sul "2" a partire dal punteggio.
 * Vince solo se la squadra ospite vince: pareggio e vittoria interna perdono.
 */
export function outcomeForAway(fixture) {
  if (!fixture || !fixture.completed) return null;
  if (fixture.status === 'postponed' || fixture.status === 'canceled') return 'void';
  const { homeScore: h, awayScore: a } = fixture;
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return a > h ? 'win' : 'lose';
}
