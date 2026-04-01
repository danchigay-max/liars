const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3100;

// HTTP-сервер для раздачи статики
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? 'index.html' : req.url.slice(1);
    filePath = path.join(__dirname, filePath);
    
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript'
    };
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
            res.end(content, 'utf-8');
        }
    });
});

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
    if (players.length < 2) {
        console.log('Недостаточно игроков!');
        return false;
    }
    
    const deck = createDeck();
    const playerHands = {};
    
    players.forEach(p => {
        playerHands[p.id] = deck.splice(0, 5);
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
            alive: true
        }))
    };
    
    broadcastGameState();
    return true;
}

function broadcastGameState() {
    const publicState = {
        started: gameState.started,
        currentRoundCard: gameState.currentRoundCard,
        currentPlayerIndex: gameState.currentPlayerIndex,
        players: gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            hand: p.hand ? p.hand.length : 0
        }))
    };
    
    players.forEach(p => {
        const playerData = gameState.players.find(gp => gp.id === p.id);
        const privateState = { ...publicState, myHand: playerData?.hand || [] };
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
    
    console.log(`✅ ${playerName} подключился`);
    
    ws.send(JSON.stringify({
        type: 'init',
        data: { id: playerId, players: players.map(p => ({ id: p.id, name: p.name })) }
    }));
    
    broadcastPlayersList();
    
    ws.on('message', (message) => {
        try {
            const { type, data } = JSON.parse(message);
            
            if (type === 'setName') {
                const player = players.find(p => p.id === playerId);
                if (player) {
                    player.name = data.name;
                    broadcastPlayersList();
                }
            } else if (type === 'startGame') {
                if (!startGame()) {
                    ws.send(JSON.stringify({ type: 'error', data: { message: 'Нужно минимум 2 игрока!' } }));
                }
            } else if (type === 'playCards' && gameState.started) {
                gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
                broadcastGameState();
            } else if (type === 'challenge' && gameState.started) {
                broadcastGameState();
            }
        } catch (e) {
            console.error('Ошибка:', e);
        }
    });
    
    ws.on('close', () => {
        players = players.filter(p => p.id !== playerId);
        if (gameState.started) gameState.started = false;
        broadcastPlayersList();
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});