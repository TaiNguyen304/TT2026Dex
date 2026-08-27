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

// Default Application State
let gameState = {
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

  // Player interaction state
  playerInteraction: {
    answer: {
      open: false,
      round: null, // 'v2' | 'v3'
      startTime: 0,
      duration: 15
    },
    bell: {
      open: false,
      round: null, // 'v2' | 'v4'
      startTime: 0,
      duration: 15,
      v2Rung: [false, false, false, false],
      v4Rung: [false, false, false, false],
      v4Winner: null,
      v4Locked: false
    },
    star: {
      open: false,
      chosen: [false, false, false, false],
      soundPlayed: false
    }
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
    bracketState: [0, 0, 0, 0], // 0: normal, 1: (name), 2: (name) + (score)
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

// Middleware & Static Files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Controller.html'));
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

// Socket.IO Real-time Connection
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('initState', gameState);

  // Time synchronization with Server
  socket.on('syncTime', (clientSentTime, callback) => {
    if (typeof callback === 'function') {
      callback({ clientSentTime, serverTime: Date.now() });
    }
  });

  // Controller requests view change
  socket.on('changeView', (viewName) => {
    gameState.currentView = viewName;
    io.emit('viewChanged', viewName);
    io.emit('stateUpdated', gameState);
  });

  // Toggle graphic visibility
  socket.on('toggleGraphic', (data) => {
    if (typeof data === 'boolean') {
      gameState.graphicsVisible = data;
    } else if (data && data.view) {
      gameState.viewGraphics[data.view] = data.visible;
    }
    io.emit('graphicToggled', gameState.viewGraphics);
    io.emit('stateUpdated', gameState);
  });

  // Full state update from Controller
  socket.on('updateState', (partialState) => {
    gameState = { ...gameState, ...partialState };
    io.emit('stateUpdated', gameState);
  });

  // Player interaction events
  socket.on('playerSubmitAnswer', (data) => {
    console.log(`[Player Answer] P${data.playerIndex + 1} (${data.round}): ${data.text} [${data.time}s]`);
    if (data.round === 'v2') {
      if (!gameState.v2State.answers) gameState.v2State.answers = ["", "", "", ""];
      gameState.v2State.answers[data.playerIndex] = data.text;
    } else if (data.round === 'v3') {
      if (!gameState.v3State.answers) gameState.v3State.answers = [];
      const pName = gameState.playerNames[data.playerIndex] || `Người ${data.playerIndex + 1}`;
      gameState.v3State.answers[data.playerIndex] = {
        name: pName,
        ans: data.text,
        time: data.time
      };
    } else if (data.round === 'vqphu' || data.round === 'vqphu_answers') {
      if (!gameState.vqphuState.answers) gameState.vqphuState.answers = [];
      const pName = gameState.playerNames[data.playerIndex] || `Thí sinh ${data.playerIndex + 1}`;
      const existingIdx = gameState.vqphuState.answers.findIndex(a => a.playerIndex === data.playerIndex || a.name === pName);
      const ansObj = {
        name: pName,
        ans: data.text,
        time: data.time,
        playerIndex: data.playerIndex
      };
      if (existingIdx >= 0) {
        gameState.vqphuState.answers[existingIdx] = ansObj;
      } else {
        gameState.vqphuState.answers.push(ansObj);
      }
    }
    io.emit('playerAnswerReceived', data);
    io.emit('stateUpdated', gameState);
  });

  socket.on('playerRingBell', (data) => {
    console.log(`[Player Bell] P${data.playerIndex + 1} (${data.round}) at ${data.time}s`);
    io.emit('playerBellTriggered', data);
  });

  socket.on('playerChooseStar', (data) => {
    console.log(`[Player Star] P${data.playerIndex + 1}`);
    io.emit('playerStarTriggered', data);
  });

  // Controller interaction controls
  socket.on('setPlayerInteraction', (interactionData) => {
    gameState.playerInteraction = { ...gameState.playerInteraction, ...interactionData };
    io.emit('playerInteractionUpdated', gameState.playerInteraction);
    io.emit('stateUpdated', gameState);
  });

  // Sound triggers (Controller triggers, Server broadcasts to Viewer)
  socket.on('playSound', (soundData) => {
    // soundData can be string "Dung V1.mp3" or object { name: "Dung V1.mp3", loop: false, volume: 1, seekTime: 0 }
    io.emit('playAudio', soundData);
  });

  socket.on('pauseSound', (soundName) => {
    io.emit('pauseAudio', soundName);
  });

  socket.on('stopSound', (soundName) => {
    io.emit('stopAudio', soundName);
  });

  socket.on('stopAllSounds', () => {
    io.emit('stopAllAudio');
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
