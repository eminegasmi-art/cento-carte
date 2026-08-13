// Logica pura del gioco "Cento Carte" - nessuna dipendenza esterna,
// così è testabile senza server/socket.io.

function shuffledDeck() {
  const deck = Array.from({ length: 100 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealHands(numPlayers, handSize = 5, deck = shuffledDeck()) {
  const hands = [];
  for (let i = 0; i < numPlayers; i++) {
    hands.push(deck.splice(0, handSize));
  }
  return hands;
}

function pileTop(pile) {
  return pile.length ? pile[pile.length - 1] : 0;
}

function isValidPlay(pile, card) {
  return card > pileTop(pile);
}

function anyPlayableCard(hands, pile) {
  const top = pileTop(pile);
  return hands.some((hand) => hand.some((c) => c > top));
}

function allHandsEmpty(hands) {
  return hands.every((hand) => hand.length === 0);
}

// ---------------------------------------------------------------------
// Round crescenti: si parte con 1 carta a testa, poi 2, poi 3... Regola
// severa scelta per il gioco: appena una carta resta bloccata per sempre
// (valore <= cima pila, in QUALSIASI mano) la run finisce subito, anche se
// altre carte sarebbero ancora giocabili altrove.
// ---------------------------------------------------------------------

// Elenco delle carte rimaste bloccate per sempre dopo l'ultima giocata,
// con l'indice del giocatore a cui appartengono (per messaggi tipo
// "la carta 3 di Marco è rimasta bloccata").
function strandedCards(hands, pile) {
  const top = pileTop(pile);
  const result = [];
  hands.forEach((hand, playerIndex) => {
    hand.forEach((card) => {
      if (card <= top) result.push({ playerIndex, card });
    });
  });
  return result;
}

function hasStrandedCard(hands, pile) {
  return strandedCards(hands, pile).length > 0;
}

// Con N giocatori, il round R richiede R*N carte: il mazzo da 100 regge al
// massimo floor(100/N) round (rimescolato da zero ad ogni round).
function maxRound(numPlayers) {
  return Math.max(1, Math.floor(100 / Math.max(1, numPlayers)));
}

// ---------------------------------------------------------------------
// Sessione/riconnessione: un giocatore ha un socket "id" (cambia ad ogni
// riconnessione: standby del telefono, cambio rete, refresh) e un "token"
// persistente (generato dal client, salvato in localStorage) che resta
// stabile. Queste funzioni pure permettono di far rientrare un giocatore
// nella stessa partita associando il suo nuovo id al token già noto.
// ---------------------------------------------------------------------

// Trova il giocatore con questo token e gli assegna il nuovo id di socket,
// segnandolo di nuovo come connesso. Se era l'host, aggiorna anche
// room.hostId (usato solo per la UI: la corona, il confronto lato client).
// Ritorna il player aggiornato, o null se il token non appartiene a nessuno.
function reassignPlayerId(room, token, newId) {
  if (!token) return null;
  const player = room.players.find((p) => p.token === token);
  if (!player) return null;
  player.id = newId;
  player.connected = true;
  if (room.hostToken && room.hostToken === token) {
    room.hostId = newId;
  }
  return player;
}

// Un giocatore può agire come host solo se il suo token corrisponde a
// quello salvato alla creazione della stanza (stabile anche se l'host si
// riconnette e il suo socket id cambia).
function isHostToken(room, token) {
  return !!token && room.hostToken === token;
}

module.exports = {
  shuffledDeck, dealHands, pileTop, isValidPlay, anyPlayableCard, allHandsEmpty,
  reassignPlayerId, isHostToken,
  strandedCards, hasStrandedCard, maxRound,
};
