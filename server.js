// server.js
// Point d'entrée : sert le frontend statique et gère toutes les connexions
// temps réel via Socket.IO. Un seul processus Node gère toutes les parties
// (chacune identifiée par son code de salon), ce qui suffit largement pour
// un usage entre amis. Voir le README pour les pistes de mise à l'échelle.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const Room = require('./Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

const rooms = new Map(); // code -> Room
const ROOM_CLEANUP_INTERVAL = 5 * 60 * 1000;
const ROOM_MAX_IDLE = 30 * 60 * 1000;

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // pas de "I"/"O" pour éviter la confusion

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Nettoie les salons abandonnés (plus personne connecté depuis longtemps).
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.isEmpty() && now - room.createdAt > ROOM_MAX_IDLE) {
      rooms.delete(code);
    }
  }
}, ROOM_CLEANUP_INTERVAL);

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentToken = null;

  const sendError = (message) => socket.emit('error_message', { message });

  socket.on('create_room', ({ pseudo } = {}) => {
    try {
      const code = generateCode();
      const room = new Room(code, io);
      const token = makeToken();
      room.addPlayer(pseudo, token, socket.id);
      rooms.set(code, room);
      currentRoomCode = code;
      currentToken = token;
      socket.join(code);
      socket.emit('joined_room', { code, token });
      room.broadcastState();
    } catch (err) {
      sendError(err.message);
    }
  });

  socket.on('join_room', ({ pseudo, code } = {}) => {
    try {
      const room = rooms.get((code || '').toUpperCase());
      if (!room) throw new Error('Aucune partie ne correspond à ce code.');
      const token = makeToken();
      room.addPlayer(pseudo, token, socket.id);
      currentRoomCode = room.code;
      currentToken = token;
      socket.join(room.code);
      socket.emit('joined_room', { code: room.code, token });
      room.broadcastState();
    } catch (err) {
      sendError(err.message);
    }
  });

  socket.on('rejoin', ({ code, token } = {}) => {
    try {
      const room = rooms.get((code || '').toUpperCase());
      if (!room) throw new Error("Cette partie n'existe plus.");
      room.rejoin(token, socket.id);
      currentRoomCode = room.code;
      currentToken = token;
      socket.join(room.code);
      socket.emit('joined_room', { code: room.code, token });
      room.broadcastState();
    } catch (err) {
      sendError(err.message);
    }
  });

  // Petite fabrique pour éviter de répéter "récupérer le salon + try/catch"
  // sur chaque action de jeu.
  function withRoom(fn) {
    return (payload) => {
      const room = rooms.get(currentRoomCode);
      if (!room || !currentToken) return;
      try {
        fn(room, payload || {});
      } catch (err) {
        sendError(err.message);
      }
    };
  }

  socket.on('toggle_ready', withRoom((room) => room.toggleReady(currentToken)));
  socket.on('update_settings', withRoom((room, { settings }) => room.updateSettings(currentToken, settings)));
  socket.on('start_game', withRoom((room) => room.startGame(currentToken)));
  socket.on('voyante_action', withRoom((room, { targetToken }) => room.submitVoyanteAction(currentToken, targetToken)));
  socket.on('wolf_action', withRoom((room, { targetToken }) => room.submitWolfVote(currentToken, targetToken)));
  socket.on('sorciere_action', withRoom((room, payload) => room.submitSorciereAction(currentToken, payload)));
  socket.on('cast_vote', withRoom((room, { targetToken }) => room.submitVote(currentToken, targetToken)));
  socket.on('hunter_shot', withRoom((room, { targetToken }) => room.submitHunterShot(currentToken, targetToken)));
  socket.on('host_advance', withRoom((room) => room.hostAdvance(currentToken)));
  socket.on('request_replay', withRoom((room) => room.requestReplay(currentToken)));

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoomCode);
    if (room && currentToken) room.handleDisconnect(currentToken);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Loup-Garou en écoute sur le port ${PORT}`);
});
