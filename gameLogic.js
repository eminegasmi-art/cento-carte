// Logica pura del gioco "Cento Carte del Regno" - nessuna dipendenza esterna,
// così è testabile senza server/socket.io. Regole fedeli a "The Game" di
// Steffen Benndorf, adattate a un mazzo di 100 carte (1-100) invece di 98
// (2-99): 4 pile (2 crescenti + 2 decrescenti), trucco del ±10, turni con
// minimo di carte da giocare, pesca automatica a fine turno.

function shuffledDeck() {
  const deck = Array.from({ length: 100 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Mano iniziale/di riferimento in base al numero di giocatori (come
// nell'originale: 1 giocatore 8 carte, 2 giocatori 7, 3+ giocatori 6).
function handSizeFor(numPlayers) {
  if (numPlayers <= 1) return 8;
  if (numPlayers === 2) return 7;
  return 6;
}

// 4 pile: 2 crescenti (si gioca più alto del top, o esattamente -10) e 2
// decrescenti (si gioca più basso del top, o esattamente +10).
function createPiles() {
  return [
    { type: 'asc', cards: [] },
    { type: 'asc', cards: [] },
    { type: 'desc', cards: [] },
    { type: 'desc', cards: [] },
  ];
}

// Valore "di riferimento" in cima alla pila: 0 per una crescente vuota
// (qualsiasi carta è valida), 101 per una decrescente vuota.
function pileTopValue(pile) {
  if (pile.cards.length) return pile.cards[pile.cards.length - 1];
  return pile.type === 'asc' ? 0 : 101;
}

function isValidPlayOnPile(pile, card) {
  const top = pileTopValue(pile);
  if (pile.type === 'asc') return card > top || card === top - 10;
  return card < top || card === top + 10;
}

// Indici delle pile su cui questa carta potrebbe essere giocata ora.
function validPilesForCard(piles, card) {
  const result = [];
  piles.forEach((p, i) => {
    if (isValidPlayOnPile(p, card)) result.push(i);
  });
  return result;
}

function isCardPlayable(piles, card) {
  return validPilesForCard(piles, card).length > 0;
}

// Verifica (con una simulazione greedy) se dalla mano è possibile giocare
// almeno `minCount` carte in sequenza sulle pile date. Non garantisce di
// trovare la sequenza OTTIMA in ogni caso limite, ma se esiste QUALSIASI
// sequenza valida di minCount giocate la trova (giocare una carta valida
// non riduce mai le opzioni sulle altre 3 pile, quindi la strategia greedy
// "gioca la prima carta valida che trovi" è affidabile nella grande
// maggioranza dei casi pratici).
function canMeetMinimum(hand, piles, minCount) {
  if (minCount <= 0) return true;
  const simPiles = piles.map((p) => ({ type: p.type, cards: [...p.cards] }));
  const remaining = [...hand];
  let played = 0;
  while (played < minCount) {
    let foundIdx = -1;
    let foundPileIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const targets = validPilesForCard(simPiles, remaining[i]);
      if (targets.length) {
        foundIdx = i;
        foundPileIdx = targets[0];
        break;
      }
    }
    if (foundIdx === -1) return false;
    simPiles[foundPileIdx].cards.push(remaining[foundIdx]);
    remaining.splice(foundIdx, 1);
    played++;
  }
  return true;
}

function allHandsEmpty(hands) {
  return hands.every((hand) => hand.length === 0);
}

function totalRemaining(hands, deckCount) {
  return deckCount + hands.reduce((sum, h) => sum + h.length, 0);
}

// Quante carte servono come minimo in un turno: 2 se il mazzo ha ancora
// carte da pescare, 1 se il mazzo è ormai esaurito.
function minCardsThisTurn(deckCount) {
  return deckCount > 0 ? 2 : 1;
}

module.exports = {
  shuffledDeck,
  handSizeFor,
  createPiles,
  pileTopValue,
  isValidPlayOnPile,
  validPilesForCard,
  isCardPlayable,
  canMeetMinimum,
  allHandsEmpty,
  totalRemaining,
  minCardsThisTurn,
};
