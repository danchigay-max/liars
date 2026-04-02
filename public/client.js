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
var tableMode = false;
var autoNext = false;
var autoNextTimer = null;
var chatBubbles = {};
var lastReveal = null;
var deckPreviewVisible = false;
var deckPreviewTimer = null;

function logLine(text) {
  var el = document.getElementById('log');
  if (!el) return;
  el.textContent = text;
}

function truncate(text, len) {
  if (!text) return '';
  if (text.length <= len) return text;
  return text.slice(0, len) + '...';
}

document.addEventListener('DOMContentLoaded', function() {
  var joinBtn = document.getElementById('joinBtn');
  if (joinBtn) joinBtn.addEventListener('click', handleJoin);

  var chatToggle = document.getElementById('chatToggle');
  var chatDrawer = document.getElementById('chatDrawer');
  if (chatToggle && chatDrawer) {
    chatToggle.onclick = function() {
      chatDrawer.classList.toggle('open');
    };
  }

  var helpToggle = document.getElementById('helpToggle');
  var rulesModal = document.getElementById('rulesModal');
  var rulesClose = document.getElementById('rulesClose');
  if (helpToggle && rulesModal) {
    helpToggle.onclick = function() { rulesModal.classList.add('open'); };
  }
  if (rulesClose && rulesModal) {
    rulesClose.onclick = function() { rulesModal.classList.remove('open'); };
  }

  if (rulesModal) {
    rulesModal.onclick = function(e) {
      if (e.target === rulesModal) rulesModal.classList.remove('open');
    };
  }

  var layoutToggle = document.getElementById('layoutToggle');
  if (layoutToggle) {
    layoutToggle.onclick = function() {
      tableMode = !tableMode;
      renderPlayers([]);
    };
  }

  var autoToggle = document.getElementById('autoNextToggle');
  if (autoToggle) {
    autoToggle.onchange = function() {
      autoNext = !!autoToggle.checked;
      scheduleAutoNext();
    };
  }

  var chatSend = document.getElementById('chatSend');
  var chatInput = document.getElementById('chatInput');
  if (chatSend && chatInput) {
    chatSend.onclick = function() { sendChat(); };
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') sendChat();
    });
  }
});

function sendChat() {
  var input = document.getElementById('chatInput');
  if (!input || !ws || ws.readyState !== WebSocket.OPEN) return;
  var text = (input.value || '').trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: 'chat', data: { text: text } }));
  input.value = '';
}

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
      scheduleAutoNext();
    }

    if (msg.type === 'challengeResult') {
      handleChallengeSuspense(msg.data);
    }

    if (msg.type === 'roundEnd') {
      var w = findPlayerName(msg.data.winnerId);
      logLine('Раунд завершен. Победил: ' + (w || '...'));
    }

    if (msg.type === 'chat') {
      addChatMessage(msg.data);
      showChatBubble(msg.data.playerId, msg.data.text);
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

    deckPreviewVisible = true;
    if (deckPreviewTimer) clearTimeout(deckPreviewTimer);
    deckPreviewTimer = setTimeout(function() {
      deckPreviewVisible = false;
      renderPlayers([]);
    }, 900);

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
      var reveal = data.cards ? (' Карты: ' + cardsToLabel(data.cards)) : '';
      var text = base + reveal + (data.hit ? (' Выстрел. ' + loserName + ' погиб.') : (' Пусто. ' + loserName + ' жив.'));
      logLine(text);
      if (data.cards) {
        lastReveal = { cards: data.cards, until: Date.now() + 4000 };
      }
      renderGame();
      renderPlayers([]);
    }
  }, 400);
}

function scheduleAutoNext() {
  if (!gameState) return;
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  if (autoNext && gameState.awaitingNextRound) {
    autoNextTimer = setTimeout(function() {
      if (ws && ws.readyState === WebSocket.OPEN && gameState && gameState.awaitingNextRound) {
        ws.send(JSON.stringify({ type: 'startNextRound', data: {} }));
      }
    }, 5000);
  }
}

function renderGame() {
  if (!gameState) return;

  var info = document.getElementById('gameInfo');
  var actions = document.getElementById('actions');
  var myHand = document.getElementById('myHand');
  var nextRoundBtn = document.getElementById('nextRoundBtn');

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
    if (nextRoundBtn) nextRoundBtn.disabled = true;
    return;
  }

  var isMyTurn = gameState.currentPlayerId === playerId;
  var roundCard = gameState.currentRoundCard || '?';
  var dealing = !!gameState.dealing;
  var suspense = Date.now() < suspenseUntil;

  var tableTitle = tableName(roundCard);
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
    '<div class="table-title">' + tableTitle + '</div>' +
    '<div class="' + bannerClass + '">' + turnText + '</div>' +
    (dealing ? '<div class="deal-banner">Раздача карт...</div>' : '') +
    (gameState.awaitingNextRound ? '<div class="deal-banner">Ожидание новой раздачи...</div>' : '') +
    '<div>Карт в сбросе: <b>' + (gameState.pileCount || 0) + '</b></div>' +
    (gameState.lastPlay ? '<div>Последняя ставка: <b>' + gameState.lastPlay.claimedCount + '</b> карт</div>' : '') +
    lastLine;

  renderHand();

  actions.innerHTML = '';
  if (dealing || suspense || gameState.awaitingNextRound) {
    actions.innerHTML = '<div class="hint">Ожидание...</div>';
  } else if (isMyTurn) {
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

  if (nextRoundBtn) {
    nextRoundBtn.disabled = !gameState.awaitingNextRound;
    nextRoundBtn.onclick = function() {
      if (ws && ws.readyState === WebSocket.OPEN && gameState.awaitingNextRound) {
        ws.send(JSON.stringify({ type: 'startNextRound', data: {} }));
      }
    };
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
        if (gameState.dealing || gameState.awaitingNextRound) return;
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
    return '<div class="card-value joker">JOKER</div>';
  }
  return '<div class="card-corner">' + card + '</div><div class="card-value">' + card + '</div><div class="card-corner bottom">' + card + '</div>';
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

function tableName(card) {
  if (card === 'A') return 'СТОЛ ТУЗОВ';
  if (card === 'K') return 'СТОЛ КОРОЛЕЙ';
  if (card === 'Q') return 'СТОЛ ДАМ';
  return 'СТОЛ';
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
  var tableLayout = document.getElementById('tableLayout');
  if (!container || !tableLayout) return;

  if (tableMode) {
    container.classList.add('hidden');
    tableLayout.classList.remove('hidden');
    renderTableLayout(tableLayout);
  } else {
    container.classList.remove('hidden');
    tableLayout.classList.add('hidden');
    renderPlayersList(container, list);
  }
}

function renderPlayersList(container, list) {
  container.innerHTML = '<div class="section-title">Игроки</div>';

  var useList = (gameState && gameState.players && gameState.players.length) ? gameState.players : (list || []);

  for (var i = 0; i < useList.length; i++) {
    var p = useList[i];
    var row = document.createElement('div');
    row.className = 'player-row' + (p.alive ? '' : ' dead');

    var left = document.createElement('div');
    left.className = 'player-name';
    left.textContent = p.name + (p.id === playerId ? ' (вы)' : '');

    var bubble = renderBubble(p.id);
    if (bubble) left.appendChild(bubble);

    var right = document.createElement('div');
    right.className = 'player-meta';
    right.textContent = 'Выстрелы: ' + shotsBar(p.bulletsSpent || 0) + ' | Победы: ' + (p.wins || 0);

    var cards = document.createElement('div');
    cards.className = 'player-cards';
    var count = p.handCount || 0;
    for (var c = 0; c < count; c++) {
      var back = document.createElement('div');
      back.className = 'card-back';
      cards.appendChild(back);
    }

    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(cards);
    container.appendChild(row);
  }
}

function renderTableLayout(container) {
  container.innerHTML = '';

  var center = document.createElement('div');
  center.className = 'table-center';

  var preview = document.createElement('div');
  preview.className = 'deck-preview' + (deckPreviewVisible ? ' show' : '');
  preview.innerHTML = buildDeckPreviewHtml();

  var pile = document.createElement('div');
  pile.className = 'pile';
  pile.innerHTML = buildPileHtml();

  center.appendChild(preview);
  center.appendChild(pile);
  container.appendChild(center);

  var playersList = (gameState && gameState.players) ? gameState.players.slice() : [];
  var seats = seatOrder(playersList.length);
  for (var i = 0; i < seats.length; i++) {
    var seat = document.createElement('div');
    seat.className = 'seat seat-' + seats[i].pos;
    var p = seats[i].player;
    if (p) {
      var name = document.createElement('div');
      name.className = 'seat-name' + (p.id === playerId ? ' you' : '');
      name.textContent = p.name;

      var bubble = renderBubble(p.id);
      if (bubble) name.appendChild(bubble);

      var cards = document.createElement('div');
      cards.className = 'seat-cards';
      var count = p.handCount || 0;
      for (var c = 0; c < count; c++) {
        var back = document.createElement('div');
        back.className = 'card-back';
        cards.appendChild(back);
      }

      seat.appendChild(name);
      seat.appendChild(cards);
    }
    container.appendChild(seat);
  }
}

function seatOrder(count) {
  var positions = [];
  if (count <= 1) {
    positions = ['bottom'];
  } else if (count === 2) {
    positions = ['left', 'right'];
  } else if (count === 3) {
    positions = ['left', 'right', 'bottom'];
  } else {
    positions = ['top', 'right', 'bottom', 'left'];
  }

  var list = (gameState && gameState.players) ? gameState.players.slice() : [];
  var seats = [];
  for (var i = 0; i < positions.length; i++) {
    seats.push({ pos: positions[i], player: list[i] || null });
  }
  return seats;
}

function buildPileHtml() {
  var now = Date.now();
  if (lastReveal && lastReveal.until > now) {
    var out = '';
    for (var i = 0; i < lastReveal.cards.length; i++) {
      out += '<div class="pile-card face">' + cardLabel(lastReveal.cards[i]) + '</div>';
    }
    return out;
  }
  if (gameState && gameState.lastPlay) {
    var count = gameState.lastPlay.claimedCount || 0;
    var backs = '';
    for (var j = 0; j < count; j++) {
      backs += '<div class="pile-card"></div>';
    }
    return backs;
  }
  return '';
}

function buildDeckPreviewHtml() {
  var rows = [
    { label: 'A', count: 6 },
    { label: 'K', count: 6 },
    { label: 'Q', count: 6 },
    { label: 'JOKER', count: 2 }
  ];
  var html = '';
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    html += '<div class="preview-row">';
    for (var c = 0; c < row.count; c++) {
      html += '<div class="preview-card">' + row.label + '</div>';
    }
    html += '</div>';
  }
  return html;
}

function renderBubble(playerIdForBubble) {
  var now = Date.now();
  var bubble = chatBubbles[playerIdForBubble];
  if (!bubble || bubble.expires <= now) return null;
  var el = document.createElement('div');
  el.className = 'chat-bubble';
  el.textContent = bubble.text;
  return el;
}

function showChatBubble(id, text) {
  chatBubbles[id] = { text: truncate(text, 16), expires: Date.now() + 6000 };
  setTimeout(function() { renderPlayers([]); }, 50);
}

function addChatMessage(data) {
  var messages = document.getElementById('chatMessages');
  if (!messages) return;
  var wrap = document.createElement('div');
  wrap.className = 'chat-msg';
  var name = document.createElement('span');
  name.className = 'chat-name';
  name.textContent = (data.name || 'Игрок') + ': ';
  var text = document.createElement('span');
  text.className = 'chat-text';
  text.textContent = data.text || '';
  wrap.appendChild(name);
  wrap.appendChild(text);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

function findPlayerName(id) {
  if (!gameState || !gameState.players) return '...';
  for (var i = 0; i < gameState.players.length; i++) {
    if (gameState.players[i].id === id) return gameState.players[i].name;
  }
  return '...';
}
