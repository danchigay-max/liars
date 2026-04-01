// client.js — Клиентская часть игры "Колода Лжеца"

let ws = null;
let playerId = null;
let gameState = null;
let selectedCards = [];

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Клиент загружен');
    
    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
        joinBtn.onclick = handleJoin;
    }
});

function handleJoin() {
    const nameInput = document.getElementById('playerName');
    const name = nameInput?.value?.trim() || `Игрок_${Math.floor(Math.random() * 1000)}`;
    
    console.log('🔗 Подключение с именем:', name);
    
    // Динамический WebSocket URL (работает и на localhost, и на удалённом сервере)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
        ws = new WebSocket(wsUrl);
    } catch (e) {
        console.error('❌ Ошибка создания WebSocket:', e);
        alert('Не удалось подключиться к серверу. Проверьте адрес.');
        return;
    }
    
    ws.onopen = () => {
        console.log('✅ WebSocket подключён');
        // Отправляем имя игрока серверу
        ws.send(JSON.stringify({ 
            type: 'setName', 
            data: { name: name } 
        }));
        
        // Переключаем интерфейс
        const loginEl = document.getElementById('login');
        const gameEl = document.getElementById('game');
        if (loginEl) loginEl.style.display = 'none';
        if (gameEl) gameEl.style.display = 'block';
    };
    
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log('📨 Получено:', msg.type, msg.data);
            
            switch (msg.type) {
                case 'init':
                    playerId = msg.data.id;
                    if (msg.data.players) {
                        updatePlayersList(msg.data.players);
                    }
                    break;
                    
                case 'gameState':
                    gameState = msg.data;
                    console.log('🔄 gameState обновлён, started =', gameState?.started);
                    renderGame();
                    break;
                    
                case 'playersList':
                    updatePlayersList(msg.data);
                    break;
                    
                case 'error':
                    console.warn('⚠️ Ошибка от сервера:', msg.data?.message);
                    if (msg.data?.message) {
                        alert('⚠️ ' + msg.data.message);
                    }
                    break;
                    
                default:
                    console.log('📦 Неизвестный тип сообщения:', msg.type);
            }
        } catch (e) {
            console.error('❌ Ошибка обработки сообщения:', e);
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        alert('Ошибка подключения к серверу! Проверьте консоль для деталей.');
    };
    
    ws.onclose = (event) => {
        console.log('🔌 WebSocket отключён:', event.code, event.reason);
        // Не показываем alert при перезагрузке страницы
        if (!event.wasClean) {
            alert('Соединение с сервером потеряно! Обновите страницу.');
        }
    };
}

// Отрисовка игрового интерфейса
function renderGame() {
    if (!gameState) {
        console.log('⏳ gameState ещё не получен');
        return;
    }
    
    console.log('🎨 Рендер игры, started:', gameState.started);
    
    const gameInfo = document.getElementById('gameInfo');
    if (!gameInfo) return;
    
    // === Экран ожидания начала игры ===
    if (!gameState.started) {
        gameInfo.innerHTML = `
            <h3>🎲 Ожидание начала игры...</h3>
            <p>За столом <strong>${gameState.players?.length || 0}</strong> игроков.</p>
            <p>Нужно минимум 2 игрока для старта.</p>
            <button id="startGameBtn" style="
                background: #4caf50; 
                color: white; 
                font-size: 20px; 
                padding: 12px 30px; 
                margin-top: 15px;
                border: none;
                border-radius: 25px;
                cursor: pointer;
                font-weight: bold;
            ">🚀 НАЧАТЬ ИГРУ</button>
        `;
        
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                console.log('▶️ Нажата кнопка старта игры');
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'startGame', data: {} }));
                } else {
                    console.error('❌ WebSocket не подключён');
                    alert('Нет соединения с сервером!');
                }
            };
        }
        
        // Очищаем руку и действия
        const myHand = document.getElementById('myHand');
        const actions = document.getElementById('actions');
        if (myHand) myHand.innerHTML = '<h4>📖 Игра ещё не началась</h4>';
        if (actions) actions.innerHTML = '';
        
        return;
    }
    
    // === Игра активна ===
    const currentPlayer = gameState.players?.[gameState.currentPlayerIndex];
    const isMyTurn = currentPlayer?.id === playerId;
    
    // Информация о раунде
    gameInfo.innerHTML = `
        <h3>🎲 Раунд: кладём <strong style="color:#ffd966">${gameState.currentRoundCard || '???'}</strong></h3>
        <p>🔫 Ход игрока: <strong>${currentPlayer?.name || '...'}</strong> ${isMyTurn ? '<span style="color:#4caf50">(ВАШ ХОД!)</span>' : ''}</p>
        <p>📊 Карт в колоде: <strong>${gameState.deck?.length || 0}</strong></p>
    `;
    
    // === Отображение руки игрока ===
    const handDiv = document.getElementById('myHand');
    if (handDiv) {
        if (gameState.myHand && gameState.myHand.length > 0) {
            handDiv.innerHTML = `<h4>📖 Ваши карты (${gameState.myHand.length})</h4>`;
            
            gameState.myHand.forEach((card, idx) => {
                const cardEl = document.createElement('div');
                cardEl.className = 'card';
                
                // Подсветка выбранных карт
                if (selectedCards.includes(idx)) {
                    cardEl.style.background = '#5a3e2b';
                    cardEl.style.borderColor = '#ff6b6b';
                }
                
                // Отображение карт
                switch(card) {
                    case 'A': cardEl.innerText = 'A ♠️'; break;
                    case 'K': cardEl.innerText = 'K ♥️'; break;
                    case 'Q': cardEl.innerText = 'Q ♦️'; break;
                    case 'JOKER': cardEl.innerText = '🃏'; break;
                    default: cardEl.innerText = card;
                }
                
                // Обработчик клика (только если мой ход)
                if (isMyTurn) {
                    cardEl.style.cursor = 'pointer';
                    cardEl.onclick = () => toggleCard(idx);
                } else {
                    cardEl.style.opacity = '0.6';
                    cardEl.style.cursor = 'not-allowed';
                }
                
                handDiv.appendChild(cardEl);
            });
        } else {
            handDiv.innerHTML = '<h4>📖 У вас нет карт</h4>';
        }
    }
    
    // === Кнопки действий ===
    const actionsDiv = document.getElementById('actions');
    if (actionsDiv) {
        if (isMyTurn) {
            actionsDiv.innerHTML = `
                <button id="playBtn" style="
                    background: #2196f3;
                    color: white;
                    font-size: 18px;
                    padding: 12px 25px;
                    border: none;
                    border-radius: 20px;
                    cursor: pointer;
                    font-weight: bold;
                    margin: 5px;
                ">🎴 Сыграть выбранное (${selectedCards.length})</button>
                <button id="passBtn" style="
                    background: #757575;
                    color: white;
                    font-size: 16px;
                    padding: 10px 20px;
                    border: none;
                    border-radius: 20px;
                    cursor: pointer;
                    margin: 5px;
                ">⏭ Пропустить ход</button>
            `;
            
            document.getElementById('playBtn').onclick = () => {
                if (selectedCards.length === 0) {
                    alert('Выберите хотя бы одну карту!');
                    return;
                }
                console.log('🎴 Сыграно карт:', selectedCards.length);
                ws.send(JSON.stringify({ 
                    type: 'playCards', 
                    data: { 
                        cardCount: selectedCards.length,
                        // В реальной игре здесь была бы логика блефа
                        isBluff: false 
                    } 
                }));
                selectedCards = [];
                renderGame();
            };
            
            document.getElementById('passBtn').onclick = () => {
                console.log('⏭ Игрок пропустил ход');
                ws.send(JSON.stringify({ 
                    type: 'playCards', 
                    data: { cardCount: 0, isBluff: false } 
                }));
            };
        } else {
            actionsDiv.innerHTML = `
                <button id="challengeBtn" style="
                    background: #f44336;
                    color: white;
                    font-size: 18px;
                    padding: 12px 25px;
                    border: none;
                    border-radius: 20px;
                    cursor: pointer;
                    font-weight: bold;
                    margin: 5px;
                ">🔍 ОСПОРИТЬ</button>
                <p style="color: #ffaa66; margin-top: 10px;">
                    ⏳ Ожидание хода <strong>${currentPlayer?.name || '...'}</strong>
                </p>
            `;
            
            document.getElementById('challengeBtn').onclick = () => {
                if (confirm('Вы уверены, что хотите оспорить предыдущего игрока?')) {
                    console.log('🔍 Игрок оспорил ход');
                    ws.send(JSON.stringify({ type: 'challenge', data: {} }));
                }
            };
        }
    }
}

// Переключение выбора карты
function toggleCard(idx) {
    const pos = selectedCards.indexOf(idx);
    if (pos > -1) {
        selectedCards.splice(pos, 1); // Убрать из выбора
    } else {
        selectedCards.push(idx); // Добавить в выбор
    }
    renderGame();
}

// Обновление списка игроков
function updatePlayersList(players) {
    const container = document.getElementById('players');
    if (!container) return;
    
    container.innerHTML = '<h3>🎭 За столом:</h3>';
    
    if (!players || players.length === 0) {
        container.innerHTML += '<p style="color:#888">Пока никого нет...</p>';
        return;
    }
    
    players.forEach(p => {
        const div = document.createElement('div');
        div.style.padding = '8px 15px';
        div.style.margin = '5px';
        div.style.background = p.id === playerId ? '#2c4a3e' : '#0b0e14';
        div.style.borderRadius = '10px';
        div.style.border = p.id === playerId ? '2px solid #4caf50' : '1px solid #ffd966';
        div.style.fontWeight = p.id === playerId ? 'bold' : 'normal';
        div.innerText = `${p.name} ${p.id === playerId ? '(вы)' : ''}`;
        container.appendChild(div);
    });
}

// Периодический запрос состояния (для отладки, можно отключить в продакшене)
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && (!gameState || !gameState.started)) {
        console.log('🔄 Запрашиваю состояние игры...');
        // Только если сервер поддерживает этот тип сообщения
        // ws.send(JSON.stringify({ type: 'getState', data: {} }));
    }
}, 5000);

// Обработка закрытия вкладки (корректное отключение)
window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Page unload');
    }
});