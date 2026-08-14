// Logica pura del gioco "Cento Carte del Regno" - versione "Sincronia
// silenziosa" (ispirata a "The Mind" di Wolfgang Warsch). Nessuna
// dipendenza esterna, testabile con "node test.js".
//
// Regole in breve:
// - 100 carte (1-100). Ogni livello si mescola tutto da capo e si danno
//   "livello" carte a testa (livello 1 = 1 carta, livello 2 = 2 carte, ...).
// - NESSUN turno: chiunque può giocare in qualsiasi momento la propria
//   carta sulla pila comune (che sale sempre, si parte da 0).
// - NESSUNA comunicazione di alcun tipo sulle carte in mano: ci si
//   sincronizza solo osservando quante carte hanno gli altri e la cima
//   della pila.
// - Se qualcuno gioca una carta mentre esiste ancora, in una mano
//   qualsiasi (anche la propria), una carta più bassa: è un errore, si
//   perde una vita, e tutte le carte più basse ancora in mano vengono
//   scartate automaticamente (altrimenti resterebbero bloccate per
//   sempre, dato che la pila sale solo).
// - Si supera il livello quando tutte le mani sono vuote. Livello massimo
//   raggiunto = vittoria. Vite a zero = game over immediato.

function shuffledDeck() {
  const deck = Array.from({ length: 100 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Livello massimo raggiungibile: limitato dal mazzo (livello*giocatori
// entro 100) MA anche tappato a 10, per tenere le partite rapide come
// richiesto (altrimenti con 2 giocatori si arriverebbe al livello 50, una
// partita lunghissima).
function maxLevel(numPlayers) {
  const deckLimit = Math.floor(100 / Math.max(1, numPlayers));
  return Math.max(1, Math.min(10, deckLimit));
}

// Vite di squadra per l'intera run: un po' di più con più giocatori (più
// persone, più probabilità statistica di sfasarsi).
function livesForGame(numPlayers) {
  return Math.max(2, numPlayers + 1);
}

// Distribuisce le mani per un livello: mescola sempre da zero e dà
// `level` carte a ciascuno dei `numPlayers` giocatori.
function dealLevel(numPlayers, level) {
  const deck = shuffledDeck();
  const hands = [];
  for (let i = 0; i < numPlayers; i++) hands.push(deck.splice(0, level));
  return hands;
}

// Una giocata è un errore se: la carta è già "superata" dalla cima della
// pila, OPPURE esiste da qualche parte (in qualsiasi mano) una carta più
// bassa che quindi andava giocata prima.
function isMistakePlay(pileTop, hands, card) {
  if (card <= pileTop) return true;
  return hands.some((hand) => hand.some((c) => c < card));
}

function allHandsEmpty(hands) {
  return hands.every((hand) => hand.length === 0);
}

function totalCardsInLevel(numPlayers, level) {
  return numPlayers * level;
}

module.exports = {
  shuffledDeck,
  maxLevel,
  livesForGame,
  dealLevel,
  isMistakePlay,
  allHandsEmpty,
  totalCardsInLevel,
};
