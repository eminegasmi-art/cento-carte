// Cento Carte del Regno - gioco cooperativo ispirato a "The Game" (Steffen Benndorf)
// Server Node.js + Express + Socket.io

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  shuffledDeck,
  handSizeFor,
  createPiles,
  pileTopValue,
  isValidPlayOnPile,
  validPilesForCard,
  canMeetMinimum,
  allHandsEmpty,
  totalRemaining,
  minCardsThisTurn,
} = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ---- Stato in memoria ----
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente caratteri ambigui
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function currentPlayer(room) {
  const id = room.turnOrder[room.turnIndex];
  return room.players.find((p) => p.id === id);
}

// Passa il turno al prossimo giocatore CONNESSO con almeno una carta in
// mano (chi ha finito le carte salta il turno, come nell'originale).
function advanceTurn(room) {
  const n = room.turnOrder.length;
  for (let i = 0; i < n; i++) {
    room.turnIndex = (room.turnIndex + 1) % n;
    const p = currentPlayer(room);
    if (p && p.hand.length > 0) return;
  }
}

function pushLog(room, text) {
  room.log.push(text);
  if (room.log.length > 50) room.log.shift();
}

// Vista pubblica dello stato, personalizzata per il destinatario: la
// propria mano è visibile, quelle altrui solo come conteggio.
function stateFor(room, socketId) {
  const cur = room.status === 'playing' ? currentPlayer(room) : null;
  return {
    code: room.code,
    status: room.status, // waiting | playing | won | lost
    hostId: room.hostId,
    handSize: room.players.length ? handSizeFor(room.players.length) : 0,
    deckCount: room.deck ? room.deck.length : 0,
    minThisTurn: room.deck ? minCardsThisTurn(room.deck.length) : 2,
    cardsPlayedThisTurn: room.cardsPlayedThisTurn || 0,
    currentTurnId: cur ? cur.id : null,
    remaining: room.status === 'lost' || room.status === 'won'
      ? totalRemaining(room.players.map((p) => p.hand), room.deck ? room.deck.length : 0)
      : null,
    bestRemaining: room.bestRemaining,
    piles: (room.piles || createPiles()).map((p) => ({ type: p.type, top: pileTopValue(p), count: p.cards.length })),
    log: room.log.slice(-8),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      // Niente ordinamento: le carte arrivano nell'ordine di distribuzione
      // (già casuale). Il client le lascia riordinare a piacere in mano.
      hand: p.id === socketId ? [...p.hand] : undefined,
      connected: p.connected,
    })),
  };
}

function broadcastState(room) {
  for (const p of room.players) {
    io.to(p.id).emit('state', stateFor(room, p.id));
  }
}

// Controlla se il giocatore di turno può ancora rispettare il minimo
// richiesto: se no, la partita finisce lì (regola originale).
function checkStuck(room) {
  const min = minCardsThisTurn(room.deck.length);
  const player = currentPlayer(room);
  if (!player) return;
  const need = Math.min(min, player.hand.length);
  if (player.hand.length < min && room.deck.length === 0 && allHandsEmpty(room.players.map((p) => p.hand))) {
    return; // caso limite: nessuna carta da nessuna parte, sarà comunque 'won' se tutto vuoto
  }
  if (!canMeetMinimum(player.hand, room.piles, need)) {
    room.status = 'lost';
    const remaining = totalRemaining(room.players.map((p) => p.hand), room.deck.length);
    room.bestRemaining = room.bestRemaining == null ? remaining : Math.min(room.bestRemaining, remaining);
    pushLog(room, `💀 ${player.name} non può più giocare il minimo richiesto (${need}). Game over: ${remaining} carte rimaste non giocate.`);
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const code = generateCode();
    const room = {
      code,
      players: [{ id: socket.id, name: (name || 'Giocatore').slice(0, 20), hand: [], connected: true }],
      piles: createPiles(),
      deck: [],
      turnOrder: [],
      turnIndex: 0,
      cardsPlayedThisTurn: 0,
      status: 'waiting',
      hostId: socket.id,
      bestRemaining: null,
      log: [],
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    pushLog(room, `${room.players[0].name} ha fondato la lobby.`);
    cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    const room = rooms[(code || '').toUpperCase()];
    if (!room) return cb({ ok: false, error: 'Codice lobby non trovato.' });
    if (room.status !== 'waiting') return cb({ ok: false, error: 'Partita già iniziata.' });
    if (room.players.length >= 5) return cb({ ok: false, error: 'Lobby piena (massimo 5 giocatori).' });

    room.players.push({ id: socket.id, name: (name || 'Giocatore').slice(0, 20), hand: [], connected: true });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    pushLog(room, `${name} è entrato nella lobby.`);
    cb({ ok: true, code: room.code });
    broadcastState(room);
  });

  socket.on('startGame', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo chi ha fondato la lobby può iniziare.' });
    if (room.players.length < 2) return cb && cb({ ok: false, error: 'Servono almeno 2 giocatori.' });

    const handSize = handSizeFor(room.players.length);
    const deck = shuffledDeck();
    room.players.forEach((p) => {
      p.hand = deck.splice(0, handSize);
    });
    room.deck = deck;
    room.piles = createPiles();
    room.turnOrder = room.players.map((p) => p.id);
    room.turnIndex = 0;
    room.cardsPlayedThisTurn = 0;
    room.status = 'playing';
    room.log = [];
    pushLog(room, `La partita è iniziata! Ognuno ha ${handSize} carte. Tocca a ${room.players[0].name}.`);
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('playCard', ({ card, pileIndex }, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (room.status !== 'playing') return cb && cb({ ok: false, error: 'Partita non in corso.' });

    const cur = currentPlayer(room);
    if (!cur || cur.id !== socket.id) return cb && cb({ ok: false, error: 'Non è il tuo turno.' });

    const idx = cur.hand.indexOf(card);
    if (idx === -1) return cb && cb({ ok: false, error: 'Non hai quella carta.' });

    const pile = room.piles[pileIndex];
    if (!pile) return cb && cb({ ok: false, error: 'Pila non valida.' });
    if (!isValidPlayOnPile(pile, card)) {
      const top = pileTopValue(pile);
      return cb && cb({ ok: false, error: `Il ${card} non è valido su questa pila (in cima c'è ${top}).` });
    }

    cur.hand.splice(idx, 1);
    pile.cards.push(card);
    room.cardsPlayedThisTurn += 1;
    pushLog(room, `${cur.name} ha giocato ${card} su una pila ${pile.type === 'asc' ? 'crescente ⬆️' : 'decrescente ⬇️'}.`);

    if (room.deck.length === 0 && allHandsEmpty(room.players.map((p) => p.hand))) {
      room.status = 'won';
      room.bestRemaining = 0;
      pushLog(room, '👑 Avete piazzato tutte le 100 carte! Vittoria leggendaria.');
    }

    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('endTurn', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (room.status !== 'playing') return cb && cb({ ok: false, error: 'Partita non in corso.' });

    const cur = currentPlayer(room);
    if (!cur || cur.id !== socket.id) return cb && cb({ ok: false, error: 'Non è il tuo turno.' });

    const min = minCardsThisTurn(room.deck.length);
    const required = Math.min(min, cur.hand.length + room.cardsPlayedThisTurn); // se aveva meno carte del minimo, basta svuotare la mano
    if (room.cardsPlayedThisTurn < required) {
      return cb && cb({ ok: false, error: `Devi giocare almeno ${required} cart${required === 1 ? 'a' : 'e'} prima di finire il turno.` });
    }

    // Pesca automatica fino a tornare alla mano di riferimento (limitata dal mazzo residuo)
    const handSize = handSizeFor(room.players.length);
    while (cur.hand.length < handSize && room.deck.length > 0) {
      cur.hand.push(room.deck.pop());
    }

    if (room.deck.length === 0 && allHandsEmpty(room.players.map((p) => p.hand))) {
      room.status = 'won';
      room.bestRemaining = 0;
      pushLog(room, '👑 Avete piazzato tutte le 100 carte! Vittoria leggendaria.');
      cb && cb({ ok: true });
      broadcastState(room);
      return;
    }

    room.cardsPlayedThisTurn = 0;
    advanceTurn(room);
    const next = currentPlayer(room);
    pushLog(room, `Tocca a ${next.name}.`);
    checkStuck(room);

    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('resetGame', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo l\'host può ricominciare.' });
    room.status = 'waiting';
    room.piles = createPiles();
    room.deck = [];
    room.turnOrder = [];
    room.turnIndex = 0;
    room.cardsPlayedThisTurn = 0;
    room.players.forEach((p) => (p.hand = []));
    room.log = [];
    pushLog(room, room.bestRemaining != null ? `Pronti per una nuova partita. Miglior risultato: ${room.bestRemaining} carte rimaste.` : 'Pronti per una nuova partita.');
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.connected = false;
      pushLog(room, `${player.name} si è disconnesso.`);
    }
    if (room.players.every((p) => !p.connected)) {
      delete rooms[code];
      return;
    }
    broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
