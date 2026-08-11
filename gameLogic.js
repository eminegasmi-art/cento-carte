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

module.exports = { shuffledDeck, dealHands, pileTop, isValidPlay, anyPlayableCard, allHandsEmpty };
