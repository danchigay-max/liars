// client.js
let ws = null;
let playerId = null;
let gameState = null;
let selectedCards = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Клиент инициализирован');
    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
        joinBtn.addEventListener('click', handleJoin);
    }
});

function handleJoin() {
    const nameInput = document.getElementById('playerName');
    const name = nameInput?.value?.trim() || `Игрок_${Math.floor(Math.random() * 1000)}`;
    
    // Динамический WebSocket URL — работает на localhost и на сервере
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log(`🔗 Подключение к ${wsUrl} как "${name}"`);
    
    try {
        ws = new WebSocket(wsUrl);
    } catch (e) {
        console.error('❌ Ошибка создания WebSocket:', e);
        alert('Не удалось подключиться к серверу');
        return;
    }
    
    ws.onopen = () => {
        console.log('✅ WebSocket подключён');
        ws.send(JSON.stringify({ type: 'setName', data: { name } }));
        
        const login = document.getElementById('login');
        const game = document.getElementById('game');
        if (login) login.style.display = 'none';
        if (game) {
            game.style.display = 'block';
            game.innerHTML = '<p style="font-size:20px">🔄 Загрузка игры...</p>';
        }
    };
    
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            // console.log('📨', msg.type);
            
            switch (msg.type) {
                case 'init':
                    playerId = msg.data?.id;
                    if (msg.data?.players) updatePlayersList(msg.data.players);
                    break;
                case 'gameState':
                    gameState = msg.data;
                    renderGame();
                    break;
                case 'playersList':
                    updatePlayersList(msg.data);
                    break;
                case 'error':
                    console.warn('⚠️', msg.data?.message);
                    if (msg.data?.message) alert('⚠️ ' + msg.data.message);
                    break;
            }
        } catch (e) {
            console.error('❌ Ошибка обработки сообщения:', e);
        }
    };
    
    ws.onerror = (err) => {
        console.error('❌ WebSocket ошибка:', err);
        alert('Ошибка соединения с сервером! Проверьте консоль (F12)');
    };
    
    ws.onclose = (event) => {
        console.log('🔌 Отключено:', event.code, event.reason || '');
        if (!event.wasClean && document.visibilityState === 'visible') {
            alert('Соединение потеряно! Обновите страницу.');
        }
    };
}

function renderGame() {
    if (!gameState) return;
    
    const gameInfo = document.getElementById('gameInfo');
    const myHand = document.getElementById('myHand');
    const actions = document.getElementById('actions');
    
    if (!gameInfo || !myHand || !actions) return;
    
    // === Экран ожидания ===
    if (!gameState.started) {
        gameInfo.innerHTML = `
            <h3>🎲 Ожидание игроков...</h3>
            <p>За столом: <strong>${gameState.players?.length || 0}</strong></p>
            <p style="color:#ffd966">Нужно минимум 2 игрока</p>
            <button id="startGameBtn" style="
                background:#4caf50;color:white;font-size:20px;
                padding:12px 30px;border:none;border-radius:25px;
                cursor:pointer;margin-top:15px;font-weight:bold">
                🚀 НАЧАТЬ ИГРУ
            </button>`;
        
        const btn = document.getElementById('startGameBtn');
        if (btn) {
            btn.onclick = () => {
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'startGame', data: {} }));
                } else {
                    alert('Нет соединения с сервером!');
                }
            };
        }
        
        myHand.innerHTML = '<h4>📖 Игра ещё не началась</h4>';
        actions.innerHTML = '';
        return;
    }
    
    // === Активная игра ===
    const currentPlayer = gameState.players?.[gameState.currentPlayerIndex];
    const isMyTurn = currentPlayer?.id === playerId;
    
    gameInfo.innerHTML = `
        <h3>🎲 Раунд: <span style="color:#ffd966">${gameState.currentRoundCard || '???'}</span></h3>
        <p>🔫 Ход: <strong>${currentPlayer?.name || '...'}</strong> ${isMyTurn ? '✅ <span style="color:#4caf50">(ВЫ)</span>' : ''}</p>
        <p>📦 Карт в колоде: <strong>${gameState.deck?.length || 0}</strong></p>`;
    
    // === Рука игрока ===
    if (gameState.myHand?.length > 0) {
        myHand.innerHTML = `<h4>📖 Ваши карты (${gameState.myHand.length})</h4>`;
        gameState.myHand.forEach((card, idx) => {
            const el = document.createElement('div');
            el.className = 'card';
            if (selectedCards.includes(idx)) {
                el.style.background = '#5a3e2b';
                el.style.borderColor = '#ff6b6b';
            }
            
            el.textContent = { 'A': 'A ♠️', 'K': 'K ♥️', 'Q': 'Q ♦️', 'JOKER': '🃏' }[card] || card;
            
            if (isMyTurn) {
                el.style.cursor = 'pointer';
                el.onclick = () => toggleCard(idx);
            } else {
                el.style.opacity = '0.6';
                el.style.cursor = 'not-allowed';
            }
            myHand.appendChild(el);
        });
    } else {
        myHand.innerHTML = '<h4>📖 У вас нет карт</h4>';
    }
    
    // === Кнопки действий ===
    if (isMyTurn) {
        actions.innerHTML = `
            <button id="playBtn" style="background:#2196f3;color:white;font-size:18px;
                padding:12px 25px;border:none;border-radius:20px;cursor:pointer;margin:5px">
                🎴 Сыграть (${selectedCards.length})
            </button>
            <button id="passBtn" style="background:#757575;color:white;font-size:16px;
                padding:10px 20px;border:none;border-radius:20px;cursor:pointer;margin:5px">
                ⏭ Пропустить
            </button>`;
        
        document.getElementById('playBtn').onclick = () => {
            if (selectedCards.length === 0) return alert('Выберите карту!');
            ws?.send(JSON.stringify({ 
                type: 'playCards', 
                data: { cardCount: selectedCards.length, isBluff: false } 
            }));
            selectedCards = [];
            renderGame();
        };
        
        document.getElementById('passBtn').onclick = () => {
            ws?.send(JSON.stringify({ type: 'playCards', data: { cardCount: 0 } }));
        };
    } else {
        actions.innerHTML = `
            <button id="challengeBtn" style="background:#f44336;color:white;font-size:18px;
                padding:12px 25px;border:none;border-radius:20px;cursor:pointer;margin:5px">
                🔍 ОСПОРИТЬ
            </button>
            <p style="color:#ffaa66;margin-top:10px">⏳ Ждём ход ${currentPlayer?.name || '...'}</p>`;
        
        document.getElementById('challengeBtn').onclick = () => {
            if (confirm('Оспорить предыдущего игрока?')) {
                ws?.send(JSON.stringify({ type: 'challenge', data: {} }));
            }
        };
    }
}

function toggleCard(idx) {
    const i = selectedCards.indexOf(idx);
    i > -1 ? selectedCards.splice(i, 1) : selectedCards.push(idx);
    renderGame();
}

function updatePlayersList(players) {
    const container = document.getElementById('players');
    if (!container) return;
    
    container.innerHTML = '<h3>🎭 За столом:</h3>';
    
    if (!players?.length) {
        container.innerHTML += '<p style="color:#888">Пока никого...</p>';
        return;
    }
    
    players.forEach(p => {
        const div = document.createElement('div');
        div.textContent = `${p.name} ${p.id === playerId ? '(вы)' : ''}`;
        div.style.padding = '8px 15px';
        div.style.margin = '5px';
        div.style.background = p.id === playerId ? '#2c4a3e' : '#0b0e14';
        div.style.borderRadius = '10px';
        div.style.border = p.id === playerId ? '2px solid #4caf50' : '1px solid #ffd966';
        container.appendChild(div);
    });
}

// Корректное закрытие при уходе со страницы
window.addEventListener('beforeunload', () => {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Page unload');
    }
});