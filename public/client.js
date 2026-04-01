let ws, playerId;
let gameState = null;
let selectedCards = [];

window.onload = () => {
    console.log('Клиент загружен');
    
    document.getElementById('joinBtn').onclick = () => {
        const name = document.getElementById('playerName').value.trim() || "Без имени";
        console.log('Подключение с именем:', name);
        
        ws = new WebSocket('ws://localhost:8080');
        
        ws.onopen = () => {
            console.log('WebSocket подключён');
            ws.send(JSON.stringify({ type: 'setName', data: { name } }));
            document.getElementById('login').style.display = 'none';
            document.getElementById('game').style.display = 'block';
        };
        
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            console.log('Получено сообщение:', msg.type, msg.data);
            
            if (msg.type === 'init') {
                playerId = msg.data.id;
                updatePlayersList(msg.data.players);
            } 
            else if (msg.type === 'gameState') {
                gameState = msg.data;
                console.log('gameState обновлён, started =', gameState.started);
                renderGame();
            } 
            else if (msg.type === 'playersList') {
                updatePlayersList(msg.data);
            }
            else if (msg.type === 'error') {
                alert(msg.data.message);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
            alert('Ошибка подключения к серверу!');
        };
        
        ws.onclose = () => {
            console.log('WebSocket отключён');
            alert('Соединение с сервером потеряно!');
        };
    };
};

function renderGame() {
    if (!gameState) {
        console.log('gameState нет');
        return;
    }
    
    console.log('Рендер игры, started:', gameState.started);
    
    const gameInfo = document.getElementById('gameInfo');
    
    // ВСЕГДА показываем кнопку начала игры, если игра не началась
    if (!gameState.started) {
        gameInfo.innerHTML = `
            <h3>🎲 Ожидание начала игры...</h3>
            <p>За столом ${gameState.players?.length || 0} игроков. Нужно минимум 2.</p>
            <button id="startGameBtn" style="background: #4caf50; font-size: 24px; padding: 15px 40px; margin-top: 20px;">🚀 НАЧАТЬ ИГРУ</button>
        `;
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                console.log('Нажата кнопка старта игры');
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'startGame', data: {} }));
                } else {
                    console.log('WebSocket не подключён');
                    alert('Нет соединения с сервером!');
                }
            };
        }
        
        document.getElementById('myHand').innerHTML = '<h4>📖 Игра ещё не началась</h4>';
        document.getElementById('actions').innerHTML = '';
        return;
    }
    
    // Игра началась
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = currentPlayer && currentPlayer.id === playerId;
    
    gameInfo.innerHTML = `
        <h3>🎲 Раунд: кладём ${gameState.currentRoundCard}</h3>
        <p>🔫 Ход игрока: <strong>${currentPlayer?.name || '...'}</strong> ${isMyTurn ? '(ВАШ ХОД!)' : ''}</p>
        <p>📊 Карт в колоде: ${gameState.deck?.length || 0}</p>
    `;
    
    // Отображаем руку игрока
    const handDiv = document.getElementById('myHand');
    if (gameState.myHand && gameState.myHand.length > 0) {
        handDiv.innerHTML = `<h4>📖 Ваши карты (${gameState.myHand.length})</h4>`;
        gameState.myHand.forEach((card, idx) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            if (selectedCards.includes(idx)) cardEl.style.background = '#5a3e2b';
            if (card === 'A') cardEl.innerText = 'A ♠️';
            else if (card === 'K') cardEl.innerText = 'K ♥️';
            else if (card === 'Q') cardEl.innerText = 'Q ♦️';
            else if (card === 'JOKER') cardEl.innerText = '🃏 JOKER';
            else cardEl.innerText = card;
            
            if (isMyTurn) {
                cardEl.style.cursor = 'pointer';
                cardEl.onclick = () => toggleCard(idx);
            } else {
                cardEl.style.opacity = '0.7';
                cardEl.onclick = null;
            }
            handDiv.appendChild(cardEl);
        });
    } else {
        handDiv.innerHTML = '<h4>📖 У вас нет карт</h4>';
    }
    
    // Кнопки действий
    const actionsDiv = document.getElementById('actions');
    if (isMyTurn) {
        actionsDiv.innerHTML = `
            <button id="playBtn">🎴 Сыграть выбранные (${selectedCards.length})</button>
        `;
        document.getElementById('playBtn').onclick = () => {
            if (selectedCards.length === 0) {
                alert('Выберите карты!');
                return;
            }
            console.log('Сыграно карт:', selectedCards.length);
            ws.send(JSON.stringify({ type: 'playCards', data: { cardCount: selectedCards.length, isBluff: false } }));
            selectedCards = [];
            renderGame();
        };
    } else {
        actionsDiv.innerHTML = `
            <button id="challengeBtn">🔍 Оспорить предыдущего</button>
            <p style="color: #ffaa66;">⏳ Ожидание хода ${currentPlayer?.name}</p>
        `;
        const challengeBtn = document.getElementById('challengeBtn');
        if (challengeBtn) {
            challengeBtn.onclick = () => {
                ws.send(JSON.stringify({ type: 'challenge', data: {} }));
            };
        }
    }
}

function toggleCard(idx) {
    if (selectedCards.includes(idx)) {
        selectedCards = selectedCards.filter(i => i !== idx);
    } else {
        selectedCards.push(idx);
    }
    renderGame();
}

function updatePlayersList(players) {
    const container = document.getElementById('players');
    container.innerHTML = '<h3>🎭 За столом:</h3>';
    players.forEach(p => {
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.margin = '5px';
        div.style.background = p.id === playerId ? '#2c4a3e' : '#0b0e14';
        div.style.borderRadius = '10px';
        div.innerText = `${p.name} ${p.id === playerId ? '(вы)' : ''}`;
        container.appendChild(div);
    });
}

// Принудительный запрос состояния игры каждые 3 секунды (для отладки)
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && (!gameState || !gameState.started)) {
        console.log('Запрашиваю состояние игры...');
        ws.send(JSON.stringify({ type: 'getState', data: {} }));
    }
}, 3000);