// Cento Carte - gioco cooperativo 1-100
// Server Node.js + Express + Socket.io

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  shuffledDeck,
  pileTop: pileTopOf,
  allHandsEmpty: allHandsEmptyOf,
  strandedCards: strandedCardsOf,
  maxRound,
} = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ---- Stato in memoria ----
// rooms: { CODE: { code, players: [{id,name,hand:[]}], pile: [], status, hostId, log: [] } }
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente caratteri ambigui
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function pileTop(room) {
  return pileTopOf(room.pile);
}

function allHandsEmpty(room) {
  return allHandsEmptyOf(room.players.map((p) => p.hand));
}

// Carte rimaste bloccate per sempre (valore <= cima pila) in QUALSIASI mano,
// con il nome di chi le possiede: regola severa, un solo blocco finisce la run.
function strandedCards(room) {
  const list = strandedCardsOf(room.players.map((p) => p.hand), room.pile);
  return list.map((s) => ({ name: room.players[s.playerIndex].name, card: s.card }));
}

// Distribuisce `room.round` carte a testa da un mazzo rimescolato da zero
// e riporta lo stato a 'playing'.
function dealRound(room) {
  const deck = shuffledDeck();
  room.players.forEach((p) => {
    p.hand = deck.splice(0, room.round);
  });
  room.pile = [];
  room.status = 'playing';
}

// Vista pubblica dello stato, personalizzata per il destinatario:
// la propria mano è visibile, quelle altrui solo come conteggio.
function stateFor(room, socketId) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    round: room.round,
    bestRound: room.bestRound,
    maxRound: maxRound(room.players.length),
    pileTop: pileTop(room),
    pileCount: room.pile.length,
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

function pushLog(room, text) {
  room.log.push(text);
  if (room.log.length > 50) room.log.shift();
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const code = generateCode();
    const room = {
      code,
      players: [{ id: socket.id, name: (name || 'Giocatore').slice(0, 20), hand: [], connected: true }],
      pile: [],
      status: 'waiting', // waiting | playing | round_complete | campaign_complete | lost
      hostId: socket.id,
      round: 0,
      bestRound: 0,
      log: [],
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    pushLog(room, `${room.players[0].name} ha creato la lobby.`);
    cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    const room = rooms[(code || '').toUpperCase()];
    if (!room) return cb({ ok: false, error: 'Codice lobby non trovato.' });
    if (room.status !== 'waiting') return cb({ ok: false, error: 'Partita già iniziata.' });
    if (room.players.length >= 8) return cb({ ok: false, error: 'Lobby piena.' });

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
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo chi ha creato la lobby può iniziare.' });
    if (room.players.length < 2) return cb && cb({ ok: false, error: 'Servono almeno 2 giocatori.' });

    room.round = 1;
    dealRound(room);
    room.log = [];
    pushLog(room, `La run è iniziata! Round 1: 1 carta a testa. Giocate senza rivelarvi le carte in mano.`);
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('playCard', ({ card }, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (room.status !== 'playing') return cb && cb({ ok: false, error: 'Partita non in corso.' });

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return cb && cb({ ok: false, error: 'Giocatore non trovato.' });

    const idx = player.hand.indexOf(card);
    if (idx === -1) return cb && cb({ ok: false, error: 'Non hai quella carta.' });

    const top = pileTop(room);
    if (card <= top) return cb && cb({ ok: false, error: `Devi giocare una carta più alta di ${top}.` });

    player.hand.splice(idx, 1);
    room.pile.push(card);
    pushLog(room, `${player.name} ha giocato ${card}.`);

    const stranded = strandedCards(room);
    if (stranded.length > 0) {
      // Regola severa: appena una carta resta bloccata per sempre (in
      // qualunque mano), la run finisce immediatamente.
      room.status = 'lost';
      room.bestRound = Math.max(room.bestRound, room.round);
      const list = stranded.map((s) => `${s.card} (${s.name})`).join(', ');
      pushLog(room, `💀 ${player.name} ha giocato ${card} e bloccato per sempre: ${list}. Game over al Round ${room.round}.`);
    } else if (allHandsEmpty(room)) {
      room.bestRound = Math.max(room.bestRound, room.round);
      const top = maxRound(room.players.length);
      if (room.round >= top) {
        room.status = 'campaign_complete';
        pushLog(room, `👑 Avete conquistato il Regno! Tutti i round completati fino al Round ${top}.`);
      } else {
        room.status = 'round_complete';
        pushLog(room, `🏆 Round ${room.round} completato! Pronti per il Round ${room.round + 1}?`);
      }
    }

    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('nextRound', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: "Solo l'host può avviare il round successivo." });
    if (room.status !== 'round_complete') return cb && cb({ ok: false, error: 'Non è il momento di passare al round successivo.' });

    room.round += 1;
    dealRound(room);
    room.log = [];
    pushLog(room, `Round ${room.round}! ${room.round} carte a testa.`);
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('resetGame', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo l\'host può ricominciare.' });
    room.status = 'waiting';
    room.round = 0;
    room.pile = [];
    room.players.forEach((p) => (p.hand = []));
    room.log = [];
    pushLog(room, room.bestRound > 0 ? `Pronti per una nuova run. Record da battere: Round ${room.bestRound}.` : 'Pronti per una nuova run.');
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
    // Rimuove la stanza se tutti disconnessi
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
