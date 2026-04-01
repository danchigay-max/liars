const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Создаём HTTP сервер для раздачи статических файлов
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.jpg':
            contentType = 'image/jpg';
            break;
    }
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// WebSocket сервер
const wss = new WebSocket.Server({ server });

let players = [];
let gameState = {
  started: false,
  deck: [],
  currentRoundCard: null,
  currentPlayerIndex: 0,
  players: []
};

const CARD_VALUES = ['A', 'K', 'Q'];
const DECK_CONFIG = { A: 6, K: 6, Q: 6, JOKER: 2 };

function createDeck() {
  let deck = [];
  for (let i = 0; i < DECK_CONFIG.A; i++) deck.push('A');
  for (let i = 0; i < DECK_CONFIG.K; i++) deck.push('K');
  for (let i = 0; i < DECK_CONFIG.Q; i++) deck.push('Q');
  for (let i = 0; i < DECK_CONFIG.JOKER; i++) deck.push('JOKER');
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function startGame() {
  console.log('=== НАЧАЛО ИГРЫ ===');
  console.log('Игроков за столом:', players.length);
  
  if (players.length < 2) {
    console.log('Недостаточно игроков! Нужно минимум 2');
    return false;
  }
  
  const deck = createDeck();
  const playerHands = {};
  
  players.forEach(function(p) { 
    playerHands[p.id] = deck.splice(0, 5);
    console.log(p.name + ' получил карты');
  });
  
  gameState = {
    started: true,
    deck: deck,
    currentRoundCard: CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)],
    currentPlayerIndex: 0,
    players: players.map(function(p) { 
      return { 
        id: p.id, 
        name: p.name, 
        hand: playerHands[p.id], 
        bulletChamber: null, 
        alive: true 
      };
    })
  };
  
  console.log('Карта раунда:', gameState.currentRoundCard);
  console.log('Порядок ходов:', gameState.players.map(function(p) { return p.name; }));
  
  broadcastGameState();
  return true;
}

function broadcastGameState() {
  var stateForClients = {
    started: gameState.started,
    deck: gameState.deck ? gameState.deck.length : 0,
    currentRoundCard: gameState.currentRoundCard,
    currentPlayerIndex: gameState.currentPlayerIndex,
    players: gameState.players.map(function(p) { 
      return { 
        id: p.id, 
        name: p.name, 
        hand: p.hand ? p.hand.length : 0,
        alive: p.alive 
      };
    })
  };
  
  players.forEach(function(p) {
    var playerData = null;
    for (var i = 0; i < gameState.players.length; i++) {
      if (gameState.players[i].id === p.id) {
        playerData = gameState.players[i];
        break;
      }
    }
    var privateState = JSON.parse(JSON.stringify(stateForClients));
    privateState.myHand = playerData && playerData.hand ? playerData.hand : [];
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'gameState', data: privateState }));
    }
  });
}

function broadcastPlayersList() {
  var playerList = players.map(function(p) { return { id: p.id, name: p.name }; });
  players.forEach(function(p) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'playersList', data: playerList }));
    }
  });
}

wss.on('connection', function(ws) {
  var playerId = Math.random().toString(36).substr(2, 8);
  var playerName = 'Игрок ' + (players.length + 1);
  
  players.push({ id: playerId, ws: ws, name: playerName });
  
  console.log('✅ ' + playerName + ' (' + playerId + ') подключился');
  console.log('Всего игроков:', players.length);
  
  ws.send(JSON.stringify({ 
    type: 'init', 
    data: { 
      id: playerId, 
      players: players.map(function(p) { return { id: p.id, name: p.name }; })
    } 
  }));
  
  broadcastPlayersList();
  
  ws.on('message', function(message) {
    try {
      var parsed = JSON.parse(message);
      var type = parsed.type;
      var data = parsed.data;
      console.log('📨 Получено: ' + type + ' от ' + playerId);
      
      if (type === 'setName') {
        for (var i = 0; i < players.length; i++) {
          if (players[i].id === playerId) {
            players[i].name = data.name;
            break;
          }
        }
        console.log('📝 Игрок сменил имя на ' + data.name);
        broadcastPlayersList();
      } 
      else if (type === 'startGame') {
        console.log('🎮 Запрос на начало игры от ' + playerId);
        startGame();
      } 
      else if (type === 'playCards') {
        if (gameState.started) {
          gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
          console.log('🎴 Ход перешёл к ' + gameState.players[gameState.currentPlayerIndex].name);
          broadcastGameState();
        }
      } 
      else if (type === 'challenge') {
        if (gameState.started) {
          console.log('🔍 Игрок ' + playerId + ' оспорил предыдущего');
          broadcastGameState();
        }
      }
    } catch (e) {
      console.error('Ошибка:', e);
    }
  });
  
  ws.on('close', function() {
    var disconnectedPlayer = null;
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === playerId) {
        disconnectedPlayer = players[i];
        players.splice(i, 1);
        break;
      }
    }
    if (disconnectedPlayer) {
      console.log('❌ ' + disconnectedPlayer.name + ' отключился');
    }
    
    if (gameState.started) {
      gameState.started = false;
      console.log('🛑 Игра остановлена');
    }
    
    broadcastPlayersList();
    console.log('Осталось игроков:', players.length);
  });
});

// Запуск сервера
var PORT = 3100;
server.listen(PORT, '0.0.0.0', function() {
  console.log('🚀 Сервер запущен на http://0.0.0.0:' + PORT);
  console.log('📡 WebSocket: ws://0.0.0.0:' + PORT);
  console.log('Ожидание подключения игроков...');
});