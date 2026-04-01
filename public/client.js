// client.js
var ws = null;
var playerId = null;
var gameState = null;
var selectedIndexes = [];

function logLine(text) {
  var el = document.getElementById('log');
  if (!el) return;
  el.textContent = text;
}

document.addEventListener('DOMContentLoaded', function() {
  var joinBtn = document.getElementById('joinBtn');
  if (joinBtn) joinBtn.addEventListener('click', handleJoin);
});

function handleJoin() {
  var nameInput = document.getElementById('playerName');
  var name = (nameInput && nameInput.value && nameInput.value.trim()) || ('Игрок_' + Math.floor(Math.random() * 1000));

  var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = protocol + '//' + window.location.host;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    alert('Не удалось подключиться к серверу');
    return;
  }

  ws.onopen = function() {
    ws.send(JSON.stringify({ type: 'setName', data: { name: name } }));
    var login = document.getElementById('login');
    var game = document.getElementById('game');
    if (login) login.style.display = 'none';
    if (game) game.style.display = 'block';
  };

  ws.onmessage = function(event) {
    var msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (msg.type === 'init') {
      playerId = msg.data && msg.data.id;
    }

    if (msg.type === 'playersList') {
      renderPlayers(msg.data || []);
    }

    if (msg.type === 'gameState') {
      gameState = msg.data;
      renderGame();
      renderPlayers([]);
    }

    if (msg.type === 'challengeResult') {
      var loserName = findPlayerName(msg.data.loserId);
      var liarName = findPlayerName(msg.data.liarId);
      var challengerName = findPlayerName(msg.data.challengerId);
      var text = msg.data.truthful
        ? ('Правда! ' + challengerName + ' ошибся.')
        : ('Ложь! ' + liarName + ' пойман.');
      text += msg.data.hit ? (' Выстрел. ' + loserName + ' погиб.') : (' Пусто. ' + loserName + ' жив.');
      logLine(text);
    }

    if (msg.type === 'roundEnd') {
      var w = findPlayerName(msg.data.winnerId);
      logLine('Раунд завершен. Победил: ' + (w || '...'));
    }
  };

  ws.onerror = function() {
    alert('Ошибка соединения. Проверьте консоль.');
  };
}

function renderGame() {
  if (!gameState) return;

  var info = document.getElementById('gameInfo');
  var actions = document.getElementById('actions');
  var myHand = document.getElementById('myHand');

  if (!info || !actions || !myHand) return;

  // Lobby
  if (!gameState.started) {
    info.innerHTML = '' +
      '<div>Ожидание игроков...</div>' +
      '<div>За столом: <b>' + (gameState.players ? gameState.players.length : 0) + '</b></div>' +
      '<div>Нужно минимум 2 игрока</div>';

    actions.innerHTML = '<button class="btn primary" id="startGameBtn">Начать игру</button>';
    var btn = document.getElementById('startGameBtn');
    if (btn) {
      btn.onclick = function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'startGame', data: {} }));
        }
      };
    }

    myHand.innerHTML = '';
    return;
  }

  var isMyTurn = gameState.currentPlayerId === playerId;
  var roundCard = gameState.currentRoundCard || '?';

  info.innerHTML = '' +
    '<div>Раунд: <b>' + roundCard + '</b></div>' +
    '<div>Ход игрока: <b>' + findPlayerName(gameState.currentPlayerId) + '</b></div>' +
    '<div>Карт в сбросе: <b>' + (gameState.pileCount || 0) + '</b></div>' +
    (gameState.lastPlay ? '<div>Последняя ставка: <b>' + gameState.lastPlay.claimedCount + '</b> карт</div>' : '') +
    (gameState.lastPlay ? '<div>Выложил: <b>' + findPlayerName(gameState.lastPlay.playerId) + '</b> — ' + cardsToLabel(gameState.lastPlay.cards) + '</div>' : '');

  renderHand();

  actions.innerHTML = '';
  if (isMyTurn) {
    actions.innerHTML += '<button class="btn primary" id="playBtn">Сыграть (' + selectedIndexes.length + ')</button>';
    if (gameState.lastPlay) {
      actions.innerHTML += '<button class="btn danger" id="challengeBtn">Оспорить</button>';
    }

    var playBtn = document.getElementById('playBtn');
    if (playBtn) {
      playBtn.onclick = function() {
        if (!selectedIndexes.length) return alert('Выберите карты');
        ws.send(JSON.stringify({ type: 'playCards', data: { cardIndexes: selectedIndexes } }));
        selectedIndexes = [];
      };
    }

    var challengeBtn = document.getElementById('challengeBtn');
    if (challengeBtn) {
      challengeBtn.onclick = function() {
        ws.send(JSON.stringify({ type: 'challenge', data: {} }));
      };
    }
  } else {
    if (gameState.lastPlay) {
      actions.innerHTML = '<button class="btn danger" id="challengeBtn">Оспорить</button>';
      var ch = document.getElementById('challengeBtn');
      if (ch) ch.onclick = function() { ws.send(JSON.stringify({ type: 'challenge', data: {} })); };
    } else {
      actions.innerHTML = '<div class="hint">Ожидание хода...</div>';
    }
  }
}

function renderHand() {
  var myHand = document.getElementById('myHand');
  if (!myHand) return;
  myHand.innerHTML = '';

  if (!gameState || !gameState.myHand) return;

  for (var i = 0; i < gameState.myHand.length; i++) {
    var card = gameState.myHand[i];
    var el = document.createElement('div');
    el.className = 'card-tile' + (selectedIndexes.indexOf(i) >= 0 ? ' selected' : '');
    el.textContent = cardLabel(card);
    (function(idx) {
      el.onclick = function() {
        var pos = selectedIndexes.indexOf(idx);
        if (pos >= 0) selectedIndexes.splice(pos, 1);
        else selectedIndexes.push(idx);
        renderGame();
      };
    })(i);
    myHand.appendChild(el);
  }
}

function cardLabel(card) {
  if (card === 'A') return 'A';
  if (card === 'K') return 'K';
  if (card === 'Q') return 'Q';
  if (card === 'JOKER') return 'JOKER';
  return card;
}

function cardsToLabel(cards) {
  if (!cards || !cards.length) return '-';
  var labels = [];
  for (var i = 0; i < cards.length; i++) labels.push(cardLabel(cards[i]));
  return labels.join(', ');
}

function shotsBar(spent) {
  var total = 6;
  var s = '';
  for (var i = 0; i < total; i++) {
    s += i < spent ? 'X' : '-';
  }
  return '[' + s + ']';
}

function renderPlayers(list) {
  var container = document.getElementById('players');
  if (!container) return;
  container.innerHTML = '<div class="section-title">Игроки</div>';

  var useList = (gameState && gameState.players && gameState.players.length) ? gameState.players : (list || []);

  for (var i = 0; i < useList.length; i++) {
    var p = useList[i];
    var row = document.createElement('div');
    row.className = 'player-row' + (p.alive ? '' : ' dead');

    var left = document.createElement('div');
    left.className = 'player-name';
    left.textContent = p.name + (p.id === playerId ? ' (вы)' : '');

    var right = document.createElement('div');
    right.className = 'player-meta';
    right.textContent = 'Выстрелы: ' + shotsBar(p.bulletsSpent || 0) + ' · Победы: ' + (p.wins || 0);

    row.appendChild(left);
    row.appendChild(right);
    container.appendChild(row);
  }
}

function findPlayerName(id) {
  if (!gameState || !gameState.players) return '...';
  for (var i = 0; i < gameState.players.length; i++) {
    if (gameState.players[i].id === id) return gameState.players[i].name;
  }
  return '...';
}
