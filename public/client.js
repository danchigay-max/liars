// client.js
var ws = null;
var playerId = null;
var gameState = null;
var selectedIndexes = [];
var dealTimer = null;
var dealIdSeen = null;
var dealVisibleCount = 0;
var suspenseUntil = 0;
var suspenseTimer = null;

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
      handleDealAnimation();
      renderGame();
      renderPlayers([]);
      if (gameState.suspenseUntil) suspenseUntil = gameState.suspenseUntil;
    }

    if (msg.type === 'challengeResult') {
      handleChallengeSuspense(msg.data);
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

function handleDealAnimation() {
  if (!gameState) return;
  if (!gameState.dealing) return;

  if (dealIdSeen !== gameState.dealId) {
    dealIdSeen = gameState.dealId;
    dealVisibleCount = 0;
    if (dealTimer) clearInterval(dealTimer);
    dealTimer = setInterval(function() {
      var total = (gameState.myHand && gameState.myHand.length) ? gameState.myHand.length : 0;
      if (dealVisibleCount < total) {
        dealVisibleCount++;
        renderGame();
      } else {
        clearInterval(dealTimer);
        dealTimer = null;
      }
    }, gameState.dealIntervalMs || 300);
  }
}

function handleChallengeSuspense(data) {
  var loserName = findPlayerName(data.loserId);
  var liarName = findPlayerName(data.liarId);
  var challengerName = findPlayerName(data.challengerId);

  var base = data.truthful
    ? ('Правда! ' + challengerName + ' ошибся.')
    : ('Ложь! ' + liarName + ' пойман.');

  var delay = data.delayMs || 4000;
  var start = Date.now();
  suspenseUntil = start + delay;

  if (suspenseTimer) clearInterval(suspenseTimer);
  suspenseTimer = setInterval(function() {
    var elapsed = Date.now() - start;
    var dots = Math.min(3, Math.floor(elapsed / 700) + 1);
    logLine('Игрок ' + loserName + ' стреляет в себя' + new Array(dots + 1).join('.'));
    if (Date.now() >= suspenseUntil) {
      clearInterval(suspenseTimer);
      suspenseTimer = null;
      var text = base + (data.hit ? (' Выстрел. ' + loserName + ' погиб.') : (' Пусто. ' + loserName + ' жив.'));
      logLine(text);
      renderGame();
    }
  }, 400);
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
  var dealing = !!gameState.dealing;
  var suspense = Date.now() < suspenseUntil;

  var turnText = isMyTurn ? 'ВАШ ХОД' : ('ХОД ИГРОКА: ' + findPlayerName(gameState.currentPlayerId));
  var bannerClass = isMyTurn ? 'turn-banner your-turn' : 'turn-banner';

  var lastPlayView = gameState.lastPlayView || null;
  var lastLine = '';
  if (lastPlayView) {
    if (lastPlayView.actualCards && lastPlayView.actualCards.length) {
      lastLine = '<div>Вы выложили: <b>' + cardsToLabel(lastPlayView.actualCards) + '</b></div>';
    } else {
      lastLine = '<div>Выложил: <b>' + findPlayerName(lastPlayView.playerId) + '</b> - ' + lastPlayView.claimedCount + ' карт(ы) ' + lastPlayView.claimedCard + '</div>';
    }
  }

  info.innerHTML = '' +
    '<div class="' + bannerClass + '">' + turnText + '</div>' +
    (dealing ? '<div class="deal-banner">Раздача карт...</div>' : '') +
    '<div>Раунд: <b>' + roundCard + '</b></div>' +
    '<div>Карт в сбросе: <b>' + (gameState.pileCount || 0) + '</b></div>' +
    (gameState.lastPlay ? '<div>Последняя ставка: <b>' + gameState.lastPlay.claimedCount + '</b> карт</div>' : '') +
    lastLine;

  renderHand();

  actions.innerHTML = '';
  if (dealing || suspense) {
    actions.innerHTML = '<div class="hint">Ожидание...</div>';
    return;
  }

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

  var total = gameState.myHand.length;
  var showCount = gameState.dealing ? Math.min(dealVisibleCount, total) : total;

  for (var i = 0; i < showCount; i++) {
    var card = gameState.myHand[i];
    var el = document.createElement('div');
    el.className = 'card-tile' + (selectedIndexes.indexOf(i) >= 0 ? ' selected' : '');
    el.innerHTML = cardInner(card);
    (function(idx) {
      el.onclick = function() {
        if (gameState.dealing) return;
        var pos = selectedIndexes.indexOf(idx);
        if (pos >= 0) selectedIndexes.splice(pos, 1);
        else selectedIndexes.push(idx);
        renderGame();
      };
    })(i);
    myHand.appendChild(el);
  }
}

function cardInner(card) {
  if (card === 'JOKER') {
    return '<div class="card-value">JOKER</div>';
  }
  var suit = 'S';
  if (card === 'K') suit = 'H';
  if (card === 'Q') suit = 'D';
  return '<div class="card-value">' + card + '</div><div class="card-suit">' + suit + '</div>';
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
    right.textContent = 'Выстрелы: ' + shotsBar(p.bulletsSpent || 0) + ' | Победы: ' + (p.wins || 0);

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
