import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 3000;

// Safe plain-text string sanitizer to protect against injection and prototype attacks
function toSafeString(val, maxLength = 3000) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.slice(0, maxLength);
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val).slice(0, maxLength);
  } catch {
    return '';
  }
}

// Default Application State Generator
function getDefaultGameState() {
  return {
    currentView: 'opening', // opening, players, v1, v2, v2_answers, v2_board, v3, v3_answers, v4, vqphu, vqphu_answers, scoreboard
    graphicsVisible: true,
    playerVisibility: [false, false, false, false],
    viewGraphics: {
      opening: true,
      players: true,
      v1: false,
      v2: true,
      v2_answers: true,
      v2_board: true,
      v3: false,
      v3_answers: true,
      v4: true,
      vqphu: true,
      vqphu_answers: true,
      scoreboard: true
    },
    viewTimers: {
      v2: true,
      v4: true
    },
    matchName: "THỬ THÁCH 2026 - LƯỢT X(BẢNG Y)",
    playerNames: ["Người 1", "Người 2", "Người 3", "Người 4"],
    playerScores: [50, 50, 50, 50],
    scoreOption: "reset",
    v2BellLog: [],
    v4BellLog: [],

    playerInteraction: {
      answer: { open: false, round: null, startTime: 0, duration: 15 },
      bell: { open: false, round: null, startTime: 0, duration: 15, v2Rung: [false, false, false, false], v4Rung: [false, false, false, false], v4Winner: null, v4Locked: false },
      star: { open: false, chosen: [false, false, false, false], soundPlayed: false }
    },

    v1State: {
      currentPlayer: null,
      questionIndex: [0, 0, 0, 0],
      qText: "",
      qHint: "",
      time: 60,
      startTime: 0,
      duration: 60,
      isRunning: false,
      isEnded: false,
      isTimerRunning: false,
      timeColor: "blue"
    },

    v2State: {
      questions: Array.from({ length: 8 }, (_, i) => ({ question: `Câu ${i + 1}`, answer: '', boardRaw: '', used: false })),
      board: new Array(30).fill(' '),
      revealed: new Array(30).fill(false),
      redCells: [],
      selectedQuestionIndex: null,
      answers: ["", "", "", ""],
      playerColors: ['blue', 'blue', 'blue', 'blue'],
      qText: "",
      qHint: "",
      time: 15,
      startTime: 0,
      duration: 15,
      isRunning: false,
      isTimerRunning: false,
      percent: 0
    },

    v3State: {
      current: 0,
      questionsData: [],
      qText: "",
      hints: ["", "", ""],
      revealedHints: [false, false, false],
      answers: [
        { name: 'Người 1', ans: '', time: '' },
        { name: 'Người 2', ans: '', time: '' },
        { name: 'Người 3', ans: '', time: '' },
        { name: 'Người 4', ans: '', time: '' }
      ],
      time: 30,
      startTime: 0,
      duration: 30,
      isRunning: false,
      isTimerRunning: false,
      timerBg: "blue"
    },

    v4State: {
      index: -1,
      questions: [],
      qText: "",
      qHint: "",
      time: 15,
      startTime: 0,
      duration: 15,
      isRunning: false,
      isPaused: false,
      isTimerRunning: false,
      playerColors: ['blue', 'blue', 'blue', 'blue'],
      bracketState: [0, 0, 0, 0],
      counters: [0, 0, 0, 0],
      percent: 0
    },

    vqphuState: {
      index: 0,
      question: "",
      events: ["", "", "", "", "", "", "", ""],
      revealed: false,
      time: 20,
      startTime: 0,
      duration: 20,
      isRunning: false,
      isTimerRunning: false,
      numPlayers: 4,
      answers: [],
      timerBg: "blue"
    }
  };
}

// Room store: { [roomId]: { roomId, passwords: ['1111', '2222', '3333', '4444'], gameState: ... } }
const rooms = {};

function getOrCreateRoom(roomId, passwords) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      roomId: roomId,
      passwords: passwords || ['1111', '2222', '3333', '4444'],
      gameState: getDefaultGameState()
    };
  } else if (passwords && Array.isArray(passwords)) {
    rooms[roomId].passwords = passwords;
  }
  return rooms[roomId];
}

// Pre-initialize default demo room 123456
getOrCreateRoom('123456', ['1111', '2222', '3333', '4444']);

// ==========================================
// Asymmetric & Hybrid Encryption Utilities
// Protects question & answer data from being
// read via F12 -> Network -> Socket -> Messages
// ==========================================

function spkiToPem(spkiBase64) {
  if (spkiBase64.includes('-----BEGIN PUBLIC KEY-----')) {
    return spkiBase64;
  }
  const clean = spkiBase64.replace(/\s+/g, '');
  const formatted = clean.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${formatted}\n-----END PUBLIC KEY-----`;
}

function encryptPayloadForClient(payload, clientPublicKeySpki) {
  if (!clientPublicKeySpki) return payload;
  try {
    const pemKey = spkiToPem(clientPublicKeySpki);
    const jsonStr = JSON.stringify(payload);

    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    const encryptedAesKey = crypto.publicEncrypt(
      {
        key: pemKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      aesKey
    ).toString('base64');

    return {
      __asymEnc: true,
      encKey: encryptedAesKey,
      iv: iv.toString('base64'),
      tag: authTag,
      data: encrypted
    };
  } catch (err) {
    console.error('[Crypto] Encryption error:', err.message);
    return payload;
  }
}

/**
 * Strips unrevealed upcoming questions and answers so they are never leaked to Player/Viewer
 */
function sanitizeGameStateForClient(state, role, playerIndex) {
  if (!state) return state;
  try {
    const clean = JSON.parse(JSON.stringify(state));

    // V2: strip question text, answer, and boardRaw from questions array
    if (clean.v2State && Array.isArray(clean.v2State.questions)) {
      clean.v2State.questions = clean.v2State.questions.map(q => ({
        used: !!q.used
      }));
    }

    // V3: strip questionsData array
    if (clean.v3State) {
      clean.v3State.questionsData = [];
    }

    // V4: strip questions array
    if (clean.v4State) {
      clean.v4State.questions = [];
    }

    return clean;
  } catch (e) {
    return state;
  }
}

/**
 * Emits event to a specific socket, applying sanitization and asymmetric encryption for Player and Viewer
 */
function emitToSocket(socket, eventName, data) {
  let payload = data;
  if (socket.role === 'player' || socket.role === 'viewer') {
    if (eventName === 'initState' || eventName === 'stateUpdated') {
      payload = sanitizeGameStateForClient(data, socket.role, socket.playerIndex);
    }
    if (socket.publicKey) {
      payload = encryptPayloadForClient(payload, socket.publicKey);
    }
  }
  socket.emit(eventName, payload);
}

/**
 * Emits event to all sockets in a room with per-socket encryption
 */
function emitToRoom(roomId, eventName, data) {
  if (!roomId) return;
  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets) {
    io.to(roomId).emit(eventName, data);
    return;
  }

  for (const socketId of roomSockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    emitToSocket(s, eventName, data);
  }
}

// Middleware & Static Files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(['/index.html', '/index'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(['/Controller.html', '/Controller', '/controller'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Controller.html'));
});

app.get(['/Viewer.html', '/Viewer', '/viewer'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Viewer.html'));
});

app.get(['/Player1.html', '/Player1', '/player1'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player1.html'));
});

app.get(['/Player2.html', '/Player2', '/player2'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player2.html'));
});

app.get(['/Player3.html', '/Player3', '/player3'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player3.html'));
});

app.get(['/Player4.html', '/Player4', '/player4'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player4.html'));
});

app.get(['/Host.html', '/Host', '/host'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Host.html'));
});

// Socket.IO Real-time Connection
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Create room from Controller
  socket.on('createRoom', (data, callback) => {
    const { roomId, passwords } = data || {};
    const safeRoomId = toSafeString(roomId, 100).trim();
    if (!safeRoomId) {
      if (typeof callback === 'function') callback({ success: false, message: 'Thiếu mã phòng' });
      return;
    }
    const safePasswords = Array.isArray(passwords) 
      ? passwords.map(p => toSafeString(p, 50)) 
      : passwords;
    const room = getOrCreateRoom(safeRoomId, safePasswords);
    socket.roomId = safeRoomId;
    socket.role = 'controller';
    socket.join(safeRoomId);
    console.log(`[Room Created] Room: ${safeRoomId}, Passwords:`, room.passwords);
    if (typeof callback === 'function') {
      callback({ success: true, roomId: safeRoomId, passwords: room.passwords, gameState: room.gameState });
    }
    emitToRoom(safeRoomId, 'initState', room.gameState);
  });

  // Verify login credentials from index.html
  socket.on('verifyLogin', (data, callback) => {
    const { roomId, auth, playerPos } = data || {};
    const safeRoomId = toSafeString(roomId, 100).trim();
    const safeAuth = toSafeString(auth, 100);
    const room = rooms[safeRoomId];
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, message: 'Mã phòng không tồn tại! Hãy chắc chắn mã phòng đã được tạo ở Controller.' });
      return;
    }
    const idx = (playerPos || 1) - 1;
    const expectedPass = room.passwords ? room.passwords[idx] : null;
    if (expectedPass && safeAuth === expectedPass) {
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, message: 'Mật khẩu không chính xác cho vị trí này!' });
    }
  });

  // Join room (supports asymmetric public key exchange)
  socket.on('joinRoom', (data, callback) => {
    const { roomId, auth, role, playerIndex, publicKey } = data || {};
    const safeRoomId = toSafeString(roomId, 100).trim();
    const safeAuth = toSafeString(auth, 100);
    const safeRole = toSafeString(role, 30);
    if (!safeRoomId) {
      if (typeof callback === 'function') callback({ success: false, message: 'Thiếu mã phòng trên URL' });
      return;
    }
    const room = getOrCreateRoom(safeRoomId);
    if (safeRole === 'player') {
      const pIdx = typeof playerIndex === 'number' ? playerIndex : 0;
      const expectedPass = room.passwords[pIdx];
      if (expectedPass && safeAuth !== expectedPass) {
        if (typeof callback === 'function') callback({ success: false, message: 'Mật khẩu truy cập không đúng' });
        socket.emit('authError', { message: 'Mật khẩu truy cập không đúng' });
        return;
      }
    }

    socket.roomId = safeRoomId;
    socket.role = safeRole || 'guest';
    socket.playerIndex = typeof playerIndex === 'number' ? playerIndex : 0;
    if (publicKey) {
      socket.publicKey = toSafeString(publicKey, 10000);
    }
    socket.join(safeRoomId);
    console.log(`[Socket Joined] ${socket.id} -> Room: ${safeRoomId} (Role: ${socket.role}, AsymKey: ${!!socket.publicKey})`);

    if (typeof callback === 'function') {
      let cbState = room.gameState;
      if (socket.role === 'player' || socket.role === 'viewer') {
        cbState = sanitizeGameStateForClient(cbState, socket.role, socket.playerIndex);
        if (socket.publicKey) {
          cbState = encryptPayloadForClient(cbState, socket.publicKey);
        }
      }
      callback({
        success: true,
        gameState: cbState,
        passwords: (socket.role === 'controller' || socket.role === 'host' ? room.passwords : undefined)
      });
    }

    emitToSocket(socket, 'initState', room.gameState);
  });

  // Time synchronization
  socket.on('syncTime', (clientSentTime, callback) => {
    if (typeof callback === 'function') {
      callback({ clientSentTime, serverTime: Date.now() });
    }
  });

  // Controller requests view change
  socket.on('changeView', (viewName) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.gameState.currentView = viewName;
    emitToRoom(roomId, 'viewChanged', viewName);
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  // Toggle graphic visibility
  socket.on('toggleGraphic', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (typeof data === 'boolean') {
      room.gameState.graphicsVisible = data;
    } else if (data && data.view) {
      room.gameState.viewGraphics[data.view] = data.visible;
    }
    emitToRoom(roomId, 'graphicToggled', room.gameState.viewGraphics);
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  // Toggle timer visibility
  socket.on('toggleTimer', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (data && data.view) {
      if (!room.gameState.viewTimers) room.gameState.viewTimers = { v2: true, v4: true };
      room.gameState.viewTimers[data.view] = data.visible;
      if (data.view === 'v2' && room.gameState.v2State) room.gameState.v2State.showTimer = data.visible;
      if (data.view === 'v4' && room.gameState.v4State) room.gameState.v4State.showTimer = data.visible;
    }
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  // Set Match Name
  socket.on('setMatchName', (name) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const safeName = toSafeString(name, 200);
    room.gameState.matchName = safeName;
    emitToRoom(roomId, 'matchNameUpdated', safeName);
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  // Full state update from Controller
  socket.on('updateState', (partialState) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.gameState = { ...room.gameState, ...partialState };
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  // Player interaction events
  socket.on('playerSubmitAnswer', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    const safeText = toSafeString(data ? data.text : '', 500);
    const safeRound = toSafeString(data ? data.round : '', 50);
    const safeTime = toSafeString(data ? data.time : '', 20);
    const pIdx = typeof (data && data.playerIndex) === 'number' ? data.playerIndex : 0;
    
    console.log(`[Player Answer][Room ${roomId}] P${pIdx + 1} (${safeRound}): ${safeText} [${safeTime}s]`);
    const pName = (gs.playerNames && gs.playerNames[pIdx]) ? gs.playerNames[pIdx] : `Thí sinh ${pIdx + 1}`;
    
    const cleanData = {
      playerIndex: pIdx,
      round: safeRound,
      text: safeText,
      time: safeTime
    };

    if (safeRound === 'v2') {
      if (!gs.v2State.answers || !Array.isArray(gs.v2State.answers)) {
        gs.v2State.answers = [];
      }
      gs.v2State.answers[pIdx] = { name: pName, ans: safeText, time: safeTime };
    } else if (safeRound === 'v3') {
      if (!gs.v3State.answers) gs.v3State.answers = [];
      gs.v3State.answers[pIdx] = { name: pName, ans: safeText, time: safeTime };
    } else if (safeRound === 'vqphu' || safeRound === 'vqphu_answers') {
      if (!gs.vqphuState.answers) gs.vqphuState.answers = [];
      gs.vqphuState.answers[pIdx] = { name: pName, ans: safeText, time: safeTime, playerIndex: pIdx };
    }
    emitToRoom(roomId, 'playerAnswerReceived', cleanData);
    emitToRoom(roomId, 'stateUpdated', gs);
  });

  socket.on('playerRingBell', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    console.log(`[Player Bell][Room ${roomId}] P${data.playerIndex + 1} (${data.round}) at ${data.time}s`);
    const pName = gs.playerNames[data.playerIndex] || `Thí sinh ${data.playerIndex + 1}`;
    const logItem = { playerIndex: data.playerIndex, name: pName, time: data.time };

    const isV4 = data.round && String(data.round).startsWith('v4');
    if (!isV4) {
      if (!gs.v2BellLog) gs.v2BellLog = [];
      if (!gs.v2BellLog.some(b => b.playerIndex === data.playerIndex)) {
        gs.v2BellLog.push(logItem);
      }
    } else {
      if (!gs.v4BellLog) gs.v4BellLog = [];
      if (!gs.v4BellLog.some(b => b.playerIndex === data.playerIndex)) {
        gs.v4BellLog.push(logItem);
      }
    }
    emitToRoom(roomId, 'playerBellTriggered', data);
    emitToRoom(roomId, 'stateUpdated', gs);
  });

  socket.on('playerChooseStar', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    if (gs.playerInteraction && gs.playerInteraction.star) {
      if (!gs.playerInteraction.star.chosen) {
        gs.playerInteraction.star.chosen = [false, false, false, false];
      }
      gs.playerInteraction.star.chosen[data.playerIndex] = true;
    }
    emitToRoom(roomId, 'playerStarTriggered', data);
    emitToRoom(roomId, 'stateUpdated', gs);
  });

  socket.on('closeQuestion', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    emitToRoom(roomId, 'questionClosed', data);
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  socket.on('resetBell', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    const round = data ? data.round : 'v2';
    if (round === 'v2') {
      gs.v2BellLog = [];
    } else if (round === 'v4') {
      gs.v4BellLog = [];
    }
    emitToRoom(roomId, 'bellReset', data);
    emitToRoom(roomId, 'stateUpdated', gs);
  });

  socket.on('resetStar', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    if (gs.playerInteraction && gs.playerInteraction.star) {
      gs.playerInteraction.star.chosen = [false, false, false, false];
    }
    emitToRoom(roomId, 'starReset');
    emitToRoom(roomId, 'stateUpdated', gs);
  });

  // Controller interaction controls
  socket.on('setPlayerInteraction', (interactionData) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.gameState.playerInteraction = { ...room.gameState.playerInteraction, ...interactionData };
    emitToRoom(roomId, 'playerInteractionUpdated', room.gameState.playerInteraction);
    emitToRoom(roomId, 'stateUpdated', room.gameState);
  });

  // Sound triggers
  socket.on('playSound', (soundData) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    io.to(roomId).emit('playAudio', soundData);
  });

  socket.on('pauseSound', (soundName) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    io.to(roomId).emit('pauseAudio', soundName);
  });

  socket.on('stopSound', (soundName) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    io.to(roomId).emit('stopAudio', soundName);
  });

  socket.on('stopAllSounds', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    io.to(roomId).emit('stopAllAudio');
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Controller: http://localhost:${PORT}/Controller.html`);
  console.log(`Viewer:     http://localhost:${PORT}/Viewer.html`);
  console.log(`=================================`);
});
