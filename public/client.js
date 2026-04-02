// client.js
var ws = null;
var playerId = null;
var gameState = null;
var selectedIndexes = [];
var dealTimer = null;
var dealIdSeen = null;
var dealVisibleCount = 0;
var dealReady = false;
var clientDealing = false;
var suspenseUntil = 0;
var suspenseTimer = null;
var tableMode = false;
var autoNext = false;
var autoNextTimer = null;
var chatBubbles = {};
var statusBubbles = {};
var lastReveal = null;
var revealStatus = null;
var verdict = null;
var winnerBanner = null;
var deckPreviewState = 'hidden'; // hidden | show | collapse
var deckPreviewTimer = null;
var lastPileCount = 0;
var autoToggleUpdating = false;
var isThrowing = false;
var currentTurnText = '';
var currentTurnMine = false;

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
      document.body.classList.toggle('table-mode', tableMode);
      renderPlayers([]);
    };
  }

  var autoToggle = document.getElementById('autoNextToggle');
  if (autoToggle) {
    autoToggle.onchange = function() {
      if (autoToggleUpdating) return;
      autoNext = !!autoToggle.checked;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'setAutoNext', data: { enabled: autoNext } }));
      }
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
    var chatToggle = document.getElementById('chatToggle');
    if (login) login.style.display = 'none';
    if (game) game.style.display = 'block';
    if (chatToggle) chatToggle.classList.remove('hidden');
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
      if (typeof gameState.autoNextEnabled !== 'undefined') {
        autoToggleUpdating = true;
        autoNext = !!gameState.autoNextEnabled;
        var autoToggle = document.getElementById('autoNextToggle');
        if (autoToggle) autoToggle.checked = autoNext;
        autoToggleUpdating = false;
      }
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
      winnerBanner = { text: 'ПОБЕДИЛ: ' + (w || '...'), until: Date.now() + 5000 };
      renderPlayers([]);
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
  if (!gameState.started) return;
  if (!gameState.dealId) return;

  if (dealIdSeen !== gameState.dealId) {
    dealIdSeen = gameState.dealId;
    dealVisibleCount = 0;
    dealReady = false;
    clientDealing = true;
    lastPileCount = 0;
    lastReveal = null;
    revealStatus = null;
    verdict = null;

    deckPreviewState = 'show';
    if (deckPreviewTimer) clearTimeout(deckPreviewTimer);
    deckPreviewTimer = setTimeout(function() {
      deckPreviewState = 'collapse';
      renderPlayers([]);
      setTimeout(function() {
        deckPreviewState = 'hidden';
        dealReady = true;
        renderPlayers([]);
        renderGame();
        startDealTimer();
      }, 900);
    }, 3000);
  }
}

function startDealTimer() {
  if (dealTimer) clearInterval(dealTimer);
  dealTimer = setInterval(function() {
    var total = (gameState.myHand && gameState.myHand.length) ? gameState.myHand.length : 0;
    if (dealVisibleCount < total) {
      dealVisibleCount++;
      renderGame();
      renderPlayers([]);
    } else {
      clearInterval(dealTimer);
      dealTimer = null;
      clientDealing = false;
      renderGame();
      renderPlayers([]);
    }
  }, gameState.dealIntervalMs || 260);
}

function handleChallengeSuspense(data) {
  var loserName = findPlayerName(data.loserId);
  var liarName = findPlayerName(data.liarId);
  var challengerName = findPlayerName(data.challengerId);

  var base = data.truthful
    ? ('ПРАВДА! ' + challengerName + ' ошибся.')
    : ('ЛОЖЬ! ' + liarName + ' пойман.');

  var delay = data.delayMs || 4000;
  var start = Date.now();
  suspenseUntil = start + delay;

  // show reveal immediately
  if (data.cards) {
    lastReveal = { cards: data.cards, until: start + delay };
    revealStatus = data.truthful ? 'truth' : 'lie';
    verdict = { text: data.truthful ? 'ПРАВДА' : 'ЛОЖЬ', type: data.truthful ? 'truth' : 'lie', until: start + delay };
    renderPlayers([]);
    renderGame();
  }

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
      statusBubbles[data.loserId] = { text: data.hit ? 'УМЕР' : 'ЖИВ', type: data.hit ? 'dead' : 'alive', expires: Date.now() + 5000 };
      renderPlayers([]);
      renderGame();
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

function animateThrow() {
  if (isThrowing) return false;
  var hand = document.getElementById('myHand');
  if (!hand) return false;
  var cards = hand.querySelectorAll('.card-tile');

  var target = getPileCenter();
  for (var i = 0; i < selectedIndexes.length; i++) {
    var idx = selectedIndexes[i];
    var card = cards[idx];
    if (!card) continue;
    var rect = card.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var dx = target.x - cx;
    var dy = target.y - cy;
    card.style.setProperty('--throw-x', dx + 'px');
    card.style.setProperty('--throw-y', dy + 'px');
    card.classList.remove('selected');
    card.classList.add('throwing');
  }

  isThrowing = true;
  setTimeout(function() { isThrowing = false; }, 380);
  return true;
}

function getPileCenter() {
  var pile = document.querySelector('.pile');
  if (pile) {
    var rect = pile.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  var info = document.getElementById('gameInfo');
  if (info) {
    var r = info.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
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
    clientDealing = false;
    dealReady = false;
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

  currentTurnMine = gameState.currentPlayerId === playerId;
  currentTurnText = currentTurnMine ? 'ВАШ ХОД' : ('ХОД: ' + findPlayerName(gameState.currentPlayerId));

  var roundCard = gameState.currentRoundCard || '?';
  var dealing = !!clientDealing;
  var suspense = Date.now() < suspenseUntil;

  var tableTitle = tableName(roundCard);

  var lastPlayView = gameState.lastPlayView || null;
  var lastLine = '';
  if (lastPlayView) {
    if (lastPlayView.actualCards && lastPlayView.actualCards.length) {
      lastLine = '<div>Вы выложили: <b>' + cardsToLabel(lastPlayView.actualCards) + '</b></div>';
    } else {
      lastLine = '<div>Выложил: <b>' + findPlayerName(lastPlayView.playerId) + '</b> - ' + lastPlayView.claimedCount + ' карт(ы) ' + lastPlayView.claimedCard + '</div>';
    }
  }

  if (tableMode) {
    info.innerHTML = '';
  } else {
    info.innerHTML = '' +
      '<div class="table-title">' + tableTitle + '</div>' +
      '<div class="turn-banner' + (currentTurnMine ? ' your-turn' : '') + '">' + currentTurnText + '</div>' +
      (dealing ? '<div class="deal-banner">Раздача карт...</div>' : '') +
      (gameState.awaitingNextRound ? '<div class="deal-banner">Ожидание новой раздачи...</div>' : '') +
      '<div>Карт в сбросе: <b>' + (gameState.pileCount || 0) + '</b></div>' +
      (gameState.lastPlay ? '<div>Последняя ставка: <b>' + gameState.lastPlay.claimedCount + '</b> карт</div>' : '') +
      lastLine;
  }

  renderHand();

  actions.innerHTML = '';
  if (dealing || suspense || gameState.awaitingNextRound || isThrowing) {
    actions.innerHTML = '<div class="hint">Ожидание...</div>';
  } else if (currentTurnMine) {
    actions.innerHTML += '<button class="btn primary" id="playBtn">Сыграть (' + selectedIndexes.length + ')</button>';
    if (gameState.lastPlay) {
      actions.innerHTML += '<button class="btn danger" id="challengeBtn">Оспорить</button>';
    }

    var playBtn = document.getElementById('playBtn');
    if (playBtn) {
      playBtn.onclick = function() {
        if (!selectedIndexes.length) return alert('Выберите карты');
        animateThrow();
        setTimeout(function() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'playCards', data: { cardIndexes: selectedIndexes } }));
          }
          selectedIndexes = [];
        }, 320);
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
  var showCount = clientDealing ? (dealReady ? Math.min(dealVisibleCount, total) : 0) : total;

  for (var i = 0; i < showCount; i++) {
    var card = gameState.myHand[i];
    var el = document.createElement('div');
    var dealClass = gameState.dealing ? ' deal-in' : '';
    el.className = 'card-tile' + (selectedIndexes.indexOf(i) >= 0 ? ' selected' : '') + dealClass;
    el.innerHTML = cardInner(card);
    (function(idx) {
      el.onclick = function() {
        if (gameState.dealing || gameState.awaitingNextRound || isThrowing) return;
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
  return '[' + spent + '/6]';
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
    left.textContent = p.name + ' ' + shotsBar(p.bulletsSpent || 0) + (p.id === playerId ? ' (вы)' : '');

    var status = renderStatusBubble(p.id);
    if (status) left.appendChild(status);

    var bubble = renderBubble(p.id);
    if (bubble) left.appendChild(bubble);

    var right = document.createElement('div');
    right.className = 'player-meta';
    right.textContent = 'Победы: ' + (p.wins || 0);

    var cards = document.createElement('div');
    cards.className = 'player-cards';
    var count = p.handCount || 0;
    for (var c = 0; c < count; c++) {
      var back = document.createElement('div');
      back.className = 'card-back deal-in';
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

  var title = document.createElement('div');
  title.className = 'table-title in-table';
  title.textContent = tableName(gameState ? gameState.currentRoundCard : '');
  container.appendChild(title);

  var turn = document.createElement('div');
  turn.className = 'table-turn' + (currentTurnMine ? ' your' : '');
  turn.textContent = currentTurnText;
  container.appendChild(turn);

  if (winnerBanner && winnerBanner.until > Date.now()) {
    var win = document.createElement('div');
    win.className = 'winner-banner';
    win.textContent = winnerBanner.text;
    container.appendChild(win);
  }

  var center = document.createElement('div');
  center.className = 'table-center';

  var preview = document.createElement('div');
  preview.className = 'deck-preview ' + deckPreviewState;
  preview.innerHTML = buildDeckPreviewHtml();

  var pile = document.createElement('div');
  pile.className = 'pile';
  pile.innerHTML = buildPileHtml();

  var caption = document.createElement('div');
  caption.className = 'pile-caption';
  caption.textContent = buildPileCaption();

  var verdictEl = document.createElement('div');
  verdictEl.className = 'pile-verdict' + (verdict ? (' ' + verdict.type) : '');
  verdictEl.textContent = verdict ? verdict.text : '';

  center.appendChild(preview);
  center.appendChild(pile);
  if (caption.textContent) center.appendChild(caption);
  if (verdict) center.appendChild(verdictEl);

  container.appendChild(center);

  var playersList = (gameState && gameState.players) ? gameState.players.slice() : [];
  var seats = seatOrder(playersList.length);
  var showSeatCards = !gameState || !clientDealing || dealReady;
  for (var i = 0; i < seats.length; i++) {
    var seat = document.createElement('div');
    seat.className = 'seat seat-' + seats[i].pos;
    var p = seats[i].player;
    if (p) {
      seat.setAttribute('data-player-id', p.id);
      var name = document.createElement('div');
      name.className = 'seat-name' + (p.id === playerId ? ' you' : '');
      name.textContent = p.name + ' ' + shotsBar(p.bulletsSpent || 0);

      var status = renderStatusBubble(p.id);
      if (status) name.appendChild(status);

      var bubble = renderBubble(p.id);
      if (bubble) name.appendChild(bubble);

      var cards = document.createElement('div');
      cards.className = 'seat-cards';
      var count = showSeatCards ? (p.handCount || 0) : 0;
      for (var c = 0; c < count; c++) {
        var back = document.createElement('div');
        back.className = 'card-back deal-in';
        cards.appendChild(back);
      }

      seat.appendChild(name);
      seat.appendChild(cards);
    }
    container.appendChild(seat);
  }

  if (deckPreviewState === 'collapse') {
    applyPreviewCollapse(preview);
  }

  if (gameState && clientDealing && dealReady) {
    var dealKey = 'deal-' + gameState.dealId;
    if (container.getAttribute('data-deal') !== dealKey) {
      container.setAttribute('data-deal', dealKey);
      setTimeout(function() { applyDealFromCenter(container); }, 80);
    }
  }

  applyPileFromSeat(container);
}

function buildPileCaption() {
  var lastPlayView = gameState ? gameState.lastPlayView : null;
  if (!lastPlayView) return '';
  var name = findPlayerName(lastPlayView.playerId);
  return 'Сбросил: ' + name + ' - ' + lastPlayView.claimedCount + ' карт(ы)';
}

function applyPreviewCollapse(preview) {
  if (!preview || preview.getAttribute('data-collapse') === '1') return;
  preview.setAttribute('data-collapse', '1');
  var cards = preview.querySelectorAll('.preview-card');
  var prect = preview.getBoundingClientRect();
  var cx = prect.left + prect.width / 2;
  var cy = prect.top + prect.height / 2;
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var rect = card.getBoundingClientRect();
    var dx = cx - (rect.left + rect.width / 2);
    var dy = cy - (rect.top + rect.height / 2);
    card.style.setProperty('--to-x', dx + 'px');
    card.style.setProperty('--to-y', dy + 'px');
    card.style.animationDelay = (i * 10) + 'ms';
    card.classList.add('preview-collapse');
  }
}

function applyDealFromCenter(container) {
  var center = container.querySelector('.table-center');
  if (!center) return;
  var crect = center.getBoundingClientRect();
  var cx = crect.left + crect.width / 2;
  var cy = crect.top + crect.height / 2;

  var cards = container.querySelectorAll('.seat .card-back');
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var rect = card.getBoundingClientRect();
    var dx = cx - (rect.left + rect.width / 2);
    var dy = cy - (rect.top + rect.height / 2);
    card.style.setProperty('--from-x', dx + 'px');
    card.style.setProperty('--from-y', dy + 'px');
    card.style.animationDelay = (i * 45) + 'ms';
    card.classList.remove('deal-from-center');
    void card.offsetWidth;
    card.classList.add('deal-from-center');
  }
}

function applyPileFromSeat(container) {
  var lastPlayView = gameState ? gameState.lastPlayView : null;
  if (!lastPlayView) return;
  var seat = container.querySelector('.seat[data-player-id="' + lastPlayView.playerId + '"]');
  var pile = container.querySelector('.pile');
  if (!seat || !pile) return;
  var srect = seat.getBoundingClientRect();
  var prect = pile.getBoundingClientRect();
  var sx = srect.left + srect.width / 2;
  var sy = srect.top + srect.height / 2;
  var px = prect.left + prect.width / 2;
  var py = prect.top + prect.height / 2;
  var dx = sx - px;
  var dy = sy - py;

  var cards = pile.querySelectorAll('.pile-card.new-card');
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    card.style.setProperty('--from-x', dx + 'px');
    card.style.setProperty('--from-y', dy + 'px');
    card.style.animationDelay = (i * 60) + 'ms';
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
  var out = '';
  if (lastReveal && lastReveal.until > now) {
    for (var i = 0; i < lastReveal.cards.length; i++) {
      out += buildFlipCard(lastReveal.cards[i], true, true);
    }
    return out;
  }

  var lastPlayView = gameState ? gameState.lastPlayView : null;
  var count = lastPlayView ? (lastPlayView.actualCards ? lastPlayView.actualCards.length : lastPlayView.claimedCount) : 0;
  for (var j = 0; j < count; j++) {
    var isNew = j >= lastPileCount;
    if (lastPlayView && lastPlayView.actualCards) {
      out += buildFlipCard(lastPlayView.actualCards[j], true, isNew);
    } else {
      out += buildFlipCard(null, false, isNew);
    }
  }
  lastPileCount = count;
  return out;
}

function buildFlipCard(label, revealed, isNew) {
  var cls = 'pile-card flip';
  if (revealed) cls += ' reveal';
  if (revealStatus) cls += ' ' + revealStatus;
  if (isNew) cls += ' new-card';
  var frontText = label ? cardLabel(label) : '';
  return '<div class="' + cls + '"><div class="pile-inner"><div class="pile-face back"></div><div class="pile-face front">' + frontText + '</div></div></div>';
}

function buildDeckPreviewHtml() {
  var rows = [
    { label: 'A', count: 6 },
    { label: 'K', count: 6 },
    { label: 'Q', count: 6 },
    { label: 'JOKER', count: 2 }
  ];
  var html = '';
  var idx = 0;
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    html += '<div class="preview-row">';
    for (var c = 0; c < row.count; c++) {
      html += '<div class="preview-card" data-idx="' + idx + '">' +
        '<div class="preview-face front">' + row.label + '</div>' +
        '<div class="preview-face back"></div>' +
      '</div>';
      idx++;
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
  el.className = 'chat-bubble show';
  el.textContent = bubble.text;
  return el;
}

function renderStatusBubble(playerIdForBubble) {
  var now = Date.now();
  var bubble = statusBubbles[playerIdForBubble];
  if (!bubble || bubble.expires <= now) return null;
  var el = document.createElement('div');
  el.className = 'status-bubble ' + bubble.type + ' show';
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
