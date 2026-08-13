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

  v1State: {
    currentPlayer: null,
    questionIndex: [0, 0, 0, 0],
    qText: "",
    qHint: "",
    time: 45,
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
    isTimerRunning: false,
    timerBg: "blue"
  },

  v4State: {
    index: -1,
    questions: [],
    qText: "",
    qHint: "",
    time: 15,
    isTimerRunning: false,
    isPaused: false,
    playerColors: ['blue', 'blue', 'blue', 'blue'],
    bracketState: [0, 0, 0, 0], // 0: normal, 1: (name), 2: (name) + (score)
    percent: 0
  },

  vqphuState: {
    index: 0,
    question: "",
    events: ["", "", "", "", "", "", "", ""],
    revealed: false,
    time: 20,
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

// Socket.IO Real-time Connection
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('initState', gameState);

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

  // Sound triggers (Controller triggers, Server broadcasts to Viewer)
  socket.on('playSound', (soundData) => {
    // soundData can be string "Dung V1.mp3" or object { name: "Dung V1.mp3", loop: false, volume: 1 }
    io.emit('playAudio', soundData);
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
