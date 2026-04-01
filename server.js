const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3100 });

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
  
  players.forEach(p => { 
    playerHands[p.id] = deck.splice(0, 5);
    console.log(`${p.name} получил карты:`, playerHands[p.id]);
  });
  
  gameState = {
    started: true,
    deck: deck,
    currentRoundCard: CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)],
    currentPlayerIndex: 0,
    players: players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      hand: playerHands[p.id], 
      bulletChamber: null, 
      alive: true 
    }))
  };
  
  console.log('Карта раунда:', gameState.currentRoundCard);
  console.log('Порядок ходов:', gameState.players.map(p => p.name));
  
  broadcastGameState();
  return true;
}

function broadcastGameState() {
  const stateForClients = {
    started: gameState.started,
    deck: gameState.deck,
    currentRoundCard: gameState.currentRoundCard,
    currentPlayerIndex: gameState.currentPlayerIndex,
    players: gameState.players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      hand: p.hand ? p.hand.length : 0,
      alive: p.alive 
    }))
  };
  
  players.forEach(p => {
    const playerData = gameState.players.find(gp => gp.id === p.id);
    const privateState = { 
      ...stateForClients, 
      myHand: playerData && playerData.hand ? playerData.hand : [] 
    };
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'gameState', data: privateState }));
    }
  });
}

function broadcastPlayersList() {
  const playerList = players.map(p => ({ id: p.id, name: p.name }));
  players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'playersList', data: playerList }));
    }
  });
}

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substr(2, 8);
  const playerName = `Игрок ${players.length + 1}`;
  
  players.push({ id: playerId, ws, name: playerName });
  
  console.log(`✅ ${playerName} (${playerId}) подключился`);
  console.log(`Всего игроков: ${players.length}`);
  
  // Отправляем новому игроку его ID и список всех игроков
  ws.send(JSON.stringify({ 
    type: 'init', 
    data: { 
      id: playerId, 
      players: players.map(p => ({ id: p.id, name: p.name }))
    } 
  }));
  
  // Отправляем обновлённый список всем
  broadcastPlayersList();
  
  ws.on('message', (message) => {
    try {
      const { type, data } = JSON.parse(message);
      console.log(`📨 Получено от ${playerId}: ${type}`);
      
      if (type === 'setName') {
        const player = players.find(p => p.id === playerId);
        if (player) {
          const oldName = player.name;
          player.name = data.name;
          console.log(`📝 Игрок ${oldName} сменил имя на ${data.name}`);
          broadcastPlayersList();
        }
      } 
      else if (type === 'startGame') {
        console.log(`🎮 ${playerId} пытается начать игру`);
        const success = startGame();
        if (!success) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            data: { message: 'Нужно минимум 2 игрока для начала игры!' }
          }));
        }
      } 
      else if (type === 'playCards') {
        if (gameState.started) {
          // Переход хода к следующему игроку
          gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
          console.log(`🎴 Ход перешёл к ${gameState.players[gameState.currentPlayerIndex].name}`);
          broadcastGameState();
        }
      } 
      else if (type === 'challenge') {
        if (gameState.started) {
          console.log(`🔍 Игрок ${playerId} оспорил предыдущего`);
          // Здесь будет логика проверки блефа
          broadcastGameState();const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3100 });

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
  
  players.forEach(p => { 
    playerHands[p.id] = deck.splice(0, 5);
    console.log(`${p.name} получил карты:`, playerHands[p.id]);
  });
  
  gameState = {
    started: true,
    deck: deck,
    currentRoundCard: CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)],
    currentPlayerIndex: 0,
    players: players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      hand: playerHands[p.id], 
      bulletChamber: null, 
      alive: true 
    }))
  };
  
  console.log('Карта раунда:', gameState.currentRoundCard);
  console.log('Порядок ходов:', gameState.players.map(p => p.name));
  
  broadcastGameState();
  return true;
}

function broadcastGameState() {
  const stateForClients = {
    started: gameState.started,
    deck: gameState.deck,
    currentRoundCard: gameState.currentRoundCard,
    currentPlayerIndex: gameState.currentPlayerIndex,
    players: gameState.players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      hand: p.hand ? p.hand.length : 0,
      alive: p.alive 
    }))
  };
  
  players.forEach(p => {
    const playerData = gameState.players.find(gp => gp.id === p.id);
    const privateState = { 
      ...stateForClients, 
      myHand: playerData && playerData.hand ? playerData.hand : [] 
    };
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'gameState', data: privateState }));
    }
  });
}

function broadcastPlayersList() {
  const playerList = players.map(p => ({ id: p.id, name: p.name }));
  players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'playersList', data: playerList }));
    }
  });
}

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substr(2, 8);
  const playerName = `Игрок ${players.length + 1}`;
  
  players.push({ id: playerId, ws, name: playerName });
  
  console.log(`✅ ${playerName} (${playerId}) подключился`);
  console.log(`Всего игроков: ${players.length}`);
  
  // Отправляем новому игроку его ID и список всех игроков
  ws.send(JSON.stringify({ 
    type: 'init', 
    data: { 
      id: playerId, 
      players: players.map(p => ({ id: p.id, name: p.name }))
    } 
  }));
  
  // Отправляем обновлённый список всем
  broadcastPlayersList();
  
  ws.on('message', (message) => {
    try {
      const { type, data } = JSON.parse(message);
      console.log(`📨 Получено от ${playerId}: ${type}`);
      
      if (type === 'setName') {
        const player = players.find(p => p.id === playerId);
        if (player) {
          const oldName = player.name;
          player.name = data.name;
          console.log(`📝 Игрок ${oldName} сменил имя на ${data.name}`);
          broadcastPlayersList();
        }
      } 
      else if (type === 'startGame') {
        console.log(`🎮 ${playerId} пытается начать игру`);
        const success = startGame();
        if (!success) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            data: { message: 'Нужно минимум 2 игрока для начала игры!' }
          }));
        }
      } 
      else if (type === 'playCards') {
        if (gameState.started) {
          // Переход хода к следующему игроку
          gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
          console.log(`🎴 Ход перешёл к ${gameState.players[gameState.currentPlayerIndex].name}`);
          broadcastGameState();
        }
      } 
      else if (type === 'challenge') {
        if (gameState.started) {
          console.log(`🔍 Игрок ${playerId} оспорил предыдущего`);
          // Здесь будет логика проверки блефа
          broadcastGameState();
        }
      }
    } catch (e) {
      console.error('Ошибка обработки сообщения:', e);
    }
  });
  
  ws.on('close', () => {
    const disconnectedPlayer = players.find(p => p.id === playerId);
    if (disconnectedPlayer) {
      console.log(`❌ ${disconnectedPlayer.name} (${playerId}) отключился`);
    }
    players = players.filter(p => p.id !== playerId);
    
    // Если игра началась и игрок отключился - игра останавливается
    if (gameState.started) {
      gameState.started = false;
      console.log('🛑 Игра остановлена из-за отключения игрока');
    }
    
    broadcastPlayersList();
    console.log(`Осталось игроков: ${players.length}`);
  });
});

console.log('🚀 Сервер запущен на ws://localhost:3100');
console.log('Ожидание подключения игроков...');
        }
      }
    } catch (e) {
      console.error('Ошибка обработки сообщения:', e);
    }
  });
  
  ws.on('close', () => {
    const disconnectedPlayer = players.find(p => p.id === playerId);
    if (disconnectedPlayer) {
      console.log(`❌ ${disconnectedPlayer.name} (${playerId}) отключился`);
    }
    players = players.filter(p => p.id !== playerId);
    
    // Если игра началась и игрок отключился - игра останавливается
    if (gameState.started) {
      gameState.started = false;
      console.log('🛑 Игра остановлена из-за отключения игрока');
    }
    
    broadcastPlayersList();
    console.log(`Осталось игроков: ${players.length}`);
  });
});

console.log('🚀 Сервер запущен на ws://localhost:3100');
console.log('Ожидание подключения игроков...');