// Quali bookmaker del feed sono italiani.
//
// Serve a due cose: dare la precedenza al loro calendario quando le varianti
// di una partita non concordano sull'orario, e segnalarli in pagina, visto che
// giocando dall'Italia sono gli unici su cui si puo' davvero puntare.
//
// Condiviso fra lo script Node e la pagina, quindi vive in docs/: e' l'unica
// cartella pubblicata da GitHub Pages.

// The Odds API usa il suffisso di nazione nella chiave (codere_it, unibet_it).
// Le voci esplicite coprono i casi che quel suffisso non prenderebbe, se il
// feed dovesse aggiungerne.
const CHIAVI_IT = new Set(['codere_it', 'unibet_it', 'sisal', 'snai', 'eurobet', 'goldbet', 'lottomatica']);

export const isItaliano = key => {
  const k = String(key ?? '').toLowerCase();
  return k.endsWith('_it') || CHIAVI_IT.has(k);
};

/** Almeno un bookmaker italiano fra questi? */
export const haBookmakerItaliano = books =>
  (books ?? []).some(b => isItaliano(b.key));
