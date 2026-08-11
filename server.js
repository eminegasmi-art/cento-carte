// Cento Carte - gioco cooperativo 1-100
// Server Node.js + Express + Socket.io

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { shuffledDeck, pileTop: pileTopOf, anyPlayableCard: anyPlayableCardOf, allHandsEmpty: allHandsEmptyOf } = require('./gameLogic');

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

// Un giocatore è "bloccato" se non ha nessuna carta più alta della cima della pila
function anyPlayableCard(room) {
  return anyPlayableCardOf(room.players.map((p) => p.hand), room.pile);
}

function allHandsEmpty(room) {
  return allHandsEmptyOf(room.players.map((p) => p.hand));
}

// Vista pubblica dello stato, personalizzata per il destinatario:
// la propria mano è visibile, quelle altrui solo come conteggio.
function stateFor(room, socketId) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    pileTop: pileTop(room),
    pileCount: room.pile.length,
    log: room.log.slice(-8),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      hand: p.id === socketId ? [...p.hand].sort((a, b) => a - b) : undefined,
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
      status: 'waiting', // waiting | playing | won | lost
      hostId: socket.id,
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

    const deck = shuffledDeck();
    room.players.forEach((p) => {
      p.hand = deck.splice(0, 5);
    });
    room.pile = [];
    room.status = 'playing';
    room.log = [];
    pushLog(room, 'La partita è iniziata! Buona fortuna, giocate senza rivelarvi le carte in mano.');
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

    if (allHandsEmpty(room)) {
      room.status = 'won';
      pushLog(room, '🎉 Tutte le carte piazzate! Avete vinto insieme.');
    } else if (!anyPlayableCard(room)) {
      room.status = 'lost';
      pushLog(room, '💀 Nessuno ha più una carta giocabile. Partita persa.');
    }

    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('resetGame', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: 'Solo l\'host può ricominciare.' });
    room.status = 'waiting';
    room.pile = [];
    room.players.forEach((p) => (p.hand = []));
    room.log = [];
    pushLog(room, 'Pronti per una nuova partita.');
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
