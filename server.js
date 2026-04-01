// server.js
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3100;

// === HTTP-сервер для раздачи статики ===
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? 'index.html' : req.url.slice(1);
    
    // Защита от выхода за пределы директории
    if (filePath.includes('..')) {
        res.writeHead(403);
        res.end('Доступ запрещён');
        return;
    }
    
    filePath = path.join(__dirname, filePath);
    
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
    };
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>404 — Файл не найден</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
            res.end(content, 'utf-8');
        }
    });
});

// === WebSocket-сервер поверх HTTP ===
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
    console.log('=== 🎮 НАЧАЛО ИГРЫ ===');
    if (players.length < 2) {
        console.log('❌ Недостаточно игроков! Нужно минимум 2');
        return false;
    }
    
    const deck = createDeck();
    const playerHands = {};
    
    players.forEach(p => {
        playerHands[p.id] = deck.splice(0, 5);
        console.log(`🃏 ${p.name} получил:`, playerHands[p.id]);
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
    
    console.log('🎯 Карта раунда:', gameState.currentRoundCard);
    broadcastGameState();
    return true;
}

function broadcastGameState() {
    const publicState = {
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
            ...publicState,
            myHand: playerData?.hand || []
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
    const newPlayer = { id: playerId, ws, name: playerName };
    
    players.push(newPlayer);
    console.log(`✅ ${playerName} (${playerId}) подключился. Всего: ${players.length}`);
    
    // Приветственное сообщение
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            id: playerId,
            players: players.map(p => ({ id: p.id, name: p.name }))
        }
    }));
    
    broadcastPlayersList();
    
    ws.on('message', (message) => {
        try {
            const { type, data } = JSON.parse(message);
            console.log(`📨 ${type} от ${playerId}`);
            
            if (type === 'setName' && data?.name) {
                const player = players.find(p => p.id === playerId);
                if (player) {
                    player.name = data.name;
                    broadcastPlayersList();
                }
            }
            else if (type === 'startGame') {
                if (!startGame()) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        data: { message: 'Нужно минимум 2 игрока!' }
                    }));
                }
            }
            else if (type === 'playCards' && gameState.started) {
                gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
                broadcastGameState();
            }
            else if (type === 'challenge' && gameState.started) {
                console.log(`🔍 ${playerId} оспорил ход`);
                broadcastGameState();
            }
        } catch (e) {
            console.error('❌ Ошибка парсинга:', e);
        }
    });
    
    ws.on('close', () => {
        const idx = players.findIndex(p => p.id === playerId);
        if (idx !== -1) {
            const disconnected = players[idx];
            console.log(`❌ ${disconnected.name} отключился`);
            players.splice(idx, 1);
            
            if (gameState.started) {
                gameState.started = false;
                console.log('🛑 Игра остановлена');
            }
            broadcastPlayersList();
        }
    });
    
    ws.on('error', (err) => {
        console.error(`⚠️ Ошибка WebSocket ${playerId}:`, err.message);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен:`);
    console.log(`   🌐 HTTP: http://localhost:${PORT}`);
    console.log(`   🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`   🌍 Внешний доступ: http://89.125.84.243:${PORT}`);
});

// Обработка завершения процесса
process.on('SIGINT', () => {
    console.log('\n👋 Завершение работы...');
    wss.close();
    server.close();
    process.exit(0);
});