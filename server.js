// Cento Carte del Regno - "Sincronia silenziosa" (stile "The Mind")
// Server Node.js + Express + Socket.io

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  maxLevel,
  livesForGame,
  dealLevel,
  isMistakePlay,
  allHandsEmpty,
  totalCardsInLevel,
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

function pushLog(room, text) {
  room.log.push(text);
  if (room.log.length > 50) room.log.shift();
}

function stateFor(room, socketId) {
  return {
    code: room.code,
    status: room.status, // waiting | playing | level_complete | won | lost
    hostId: room.hostId,
    level: room.level,
    maxLevel: room.maxLevelVal,
    lives: room.lives,
    pileTop: room.pileTop,
    playedCount: room.playedCount,
    totalThisLevel: room.players.length ? totalCardsInLevel(room.players.length, room.level) : 0,
    bestLevel: room.bestLevel,
    log: room.log.slice(-8),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
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

function startLevel(room) {
  const numPlayers = room.players.length;
  const hands = dealLevel(numPlayers, room.level);
  room.players.forEach((p, i) => { p.hand = hands[i]; });
  room.pileTop = 0;
  room.playedCount = 0;
  room.status = 'playing';
  pushLog(room, `Livello ${room.level}: ${room.level} cart${room.level === 1 ? 'a' : 'e'} a testa. Zero parole sulle carte in mano: sincronizzatevi in silenzio!`);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const code = generateCode();
    const room = {
      code,
      players: [{ id: socket.id, name: (name || 'Giocatore').slice(0, 20), hand: [], connected: true }],
      level: 1,
      maxLevelVal: 0,
      lives: 0,
      pileTop: 0,
      playedCount: 0,
      status: 'waiting',
      hostId: socket.id,
      bestLevel: null,
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
    if (room.players.length >= 6) return cb({ ok: false, error: 'Lobby piena (massimo 6 giocatori).' });

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

    const numPlayers = room.players.length;
    room.maxLevelVal = maxLevel(numPlayers);
    room.lives = livesForGame(numPlayers);
    room.level = 1;
    room.log = [];
    startLevel(room);
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('playCard', ({ card }, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (room.status !== 'playing') return cb && cb({ ok: false, error: 'Partita non in corso.' });

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return cb && cb({ ok: false, error: 'Non fai parte di questa partita.' });
    const idx = player.hand.indexOf(card);
    if (idx === -1) return cb && cb({ ok: false, error: 'Non hai quella carta.' });

    const allHands = room.players.map((p) => p.hand);
    const mistake = isMistakePlay(room.pileTop, allHands, card);

    player.hand.splice(idx, 1);
    room.playedCount += 1;

    if (mistake) {
      room.lives -= 1;
      const discarded = [];
      room.players.forEach((p) => {
        const keep = [];
        p.hand.forEach((c) => {
          if (c < card) discarded.push(`${c} (${p.name})`);
          else keep.push(c);
        });
        room.playedCount += p.hand.length - keep.length;
        p.hand = keep;
      });
      room.pileTop = card;
      const detail = discarded.length ? ` Scartate anche le carte rimaste indietro: ${discarded.join(', ')}.` : '';
      pushLog(room, `💥 ${player.name} ha giocato il ${card} troppo presto: persa una vita (rimaste: ${room.lives}).${detail}`);
    } else {
      room.pileTop = card;
      pushLog(room, `${player.name} ha giocato ${card}. La sequenza è arrivata a ${card}.`);
    }

    if (room.lives <= 0) {
      room.status = 'lost';
      pushLog(room, `💀 Vite finite. Game over al livello ${room.level}.`);
    } else if (allHandsEmpty(room.players.map((p) => p.hand))) {
      if (room.level >= room.maxLevelVal) {
        room.status = 'won';
        room.bestLevel = room.maxLevelVal;
        pushLog(room, `👑 Livello massimo (${room.maxLevelVal}) completato! Sincronia perfetta, gloria al Regno.`);
      } else {
        room.status = 'level_complete';
        room.bestLevel = room.bestLevel == null ? room.level : Math.max(room.bestLevel, room.level);
        pushLog(room, `🏆 Livello ${room.level} superato con ${room.lives} vit${room.lives === 1 ? 'a' : 'e'} rimast${room.lives === 1 ? 'a' : 'e'}!`);
      }
    }

    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('nextLevel', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false, error: 'Lobby non trovata.' });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: "Solo l'host può avviare il prossimo livello." });
    if (room.status !== 'level_complete') return cb && cb({ ok: false, error: 'Nessun livello da avviare ora.' });
    room.level += 1;
    startLevel(room);
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('resetGame', (_data, cb) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return cb && cb({ ok: false });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: "Solo l'host può ricominciare." });
    room.status = 'waiting';
    room.level = 1;
    room.lives = 0;
    room.pileTop = 0;
    room.playedCount = 0;
    room.players.forEach((p) => (p.hand = []));
    room.log = [];
    pushLog(room, room.bestLevel != null ? `Pronti per una nuova partita. Miglior livello raggiunto finora: ${room.bestLevel}.` : 'Pronti per una nuova partita.');
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
