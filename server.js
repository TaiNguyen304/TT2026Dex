import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

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
    matchName: "THỬ THÁCH 2026 - LƯỢT X(BẢNG Y)",
    playerNames: ["Người 1", "Người 2", "Người 3", "Người 4"],
    playerScores: [30, 30, 30, 30],
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
      time: 45,
      startTime: 0,
      duration: 45,
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
    if (!roomId) {
      if (typeof callback === 'function') callback({ success: false, message: 'Thiếu mã phòng' });
      return;
    }
    const room = getOrCreateRoom(roomId, passwords);
    socket.roomId = roomId;
    socket.join(roomId);
    console.log(`[Room Created] Room: ${roomId}, Passwords:`, room.passwords);
    if (typeof callback === 'function') {
      callback({ success: true, roomId, passwords: room.passwords, gameState: room.gameState });
    }
    io.to(roomId).emit('initState', room.gameState);
  });

  // Verify login credentials from index.html
  socket.on('verifyLogin', (data, callback) => {
    const { roomId, auth, playerPos } = data || {};
    const room = rooms[roomId];
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, message: 'Mã phòng không tồn tại! Hãy chắc chắn mã phòng đã được tạo ở Controller.' });
      return;
    }
    const idx = (playerPos || 1) - 1;
    const expectedPass = room.passwords ? room.passwords[idx] : null;
    if (expectedPass && auth === expectedPass) {
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, message: 'Mật khẩu không chính xác cho vị trí này!' });
    }
  });

  // Join room
  socket.on('joinRoom', (data, callback) => {
    const { roomId, auth, role, playerIndex } = data || {};
    if (!roomId) {
      if (typeof callback === 'function') callback({ success: false, message: 'Thiếu mã phòng trên URL' });
      return;
    }
    const room = getOrCreateRoom(roomId);
    if (role === 'player') {
      const pIdx = typeof playerIndex === 'number' ? playerIndex : 0;
      const expectedPass = room.passwords[pIdx];
      if (expectedPass && auth !== expectedPass) {
        if (typeof callback === 'function') callback({ success: false, message: 'Mật khẩu truy cập không đúng' });
        socket.emit('authError', { message: 'Mật khẩu truy cập không đúng' });
        return;
      }
    }

    socket.roomId = roomId;
    socket.join(roomId);
    console.log(`[Socket Joined] ${socket.id} -> Room: ${roomId} (Role: ${role || 'guest'})`);

    if (typeof callback === 'function') {
      callback({ success: true, gameState: room.gameState, passwords: room.passwords });
    }
    socket.emit('initState', room.gameState);
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
    io.to(roomId).emit('viewChanged', viewName);
    io.to(roomId).emit('stateUpdated', room.gameState);
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
    io.to(roomId).emit('graphicToggled', room.gameState.viewGraphics);
    io.to(roomId).emit('stateUpdated', room.gameState);
  });

  // Full state update from Controller
  socket.on('updateState', (partialState) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.gameState = { ...room.gameState, ...partialState };
    io.to(roomId).emit('stateUpdated', room.gameState);
  });

  // Player interaction events
  socket.on('playerSubmitAnswer', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    console.log(`[Player Answer][Room ${roomId}] P${data.playerIndex + 1} (${data.round}): ${data.text} [${data.time}s]`);
    const pName = gs.playerNames[data.playerIndex] || `Thí sinh ${data.playerIndex + 1}`;
    if (data.round === 'v2') {
      if (!gs.v2State.answers || !Array.isArray(gs.v2State.answers)) {
        gs.v2State.answers = [];
      }
      gs.v2State.answers[data.playerIndex] = { name: pName, ans: data.text, time: data.time };
    } else if (data.round === 'v3') {
      if (!gs.v3State.answers) gs.v3State.answers = [];
      gs.v3State.answers[data.playerIndex] = { name: pName, ans: data.text, time: data.time };
    } else if (data.round === 'vqphu' || data.round === 'vqphu_answers') {
      if (!gs.vqphuState.answers) gs.vqphuState.answers = [];
      gs.vqphuState.answers[data.playerIndex] = { name: pName, ans: data.text, time: data.time, playerIndex: data.playerIndex };
    }
    io.to(roomId).emit('playerAnswerReceived', data);
    io.to(roomId).emit('stateUpdated', gs);
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
    io.to(roomId).emit('playerBellTriggered', data);
    io.to(roomId).emit('stateUpdated', gs);
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
    io.to(roomId).emit('playerStarTriggered', data);
    io.to(roomId).emit('stateUpdated', gs);
  });

  socket.on('closeQuestion', (data) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    io.to(roomId).emit('questionClosed', data);
    io.to(roomId).emit('stateUpdated', room.gameState);
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
    io.to(roomId).emit('bellReset', data);
    io.to(roomId).emit('stateUpdated', gs);
  });

  socket.on('resetStar', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const gs = room.gameState;
    if (gs.playerInteraction && gs.playerInteraction.star) {
      gs.playerInteraction.star.chosen = [false, false, false, false];
    }
    io.to(roomId).emit('starReset');
    io.to(roomId).emit('stateUpdated', gs);
  });

  // Controller interaction controls
  socket.on('setPlayerInteraction', (interactionData) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.gameState.playerInteraction = { ...room.gameState.playerInteraction, ...interactionData };
    io.to(roomId).emit('playerInteractionUpdated', room.gameState.playerInteraction);
    io.to(roomId).emit('stateUpdated', room.gameState);
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
