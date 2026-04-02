const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3100;

// Static file server
const server = http.createServer(function(req, res) {
  var filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  var extname = path.extname(filePath);
  var contentType = 'text/html';

  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpg';
      break;
  }

  fs.readFile(filePath, function(error, content) {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      res.end(content);
    }
  });
});

const wss = new WebSocket.Server({ server: server });

var players = []; // { id, name, ws, alive, hand[], bulletsSpent, wins, chamber, shotsInChamber }
var game = {
  started: false,
  currentRoundCard: null,
  currentPlayerId: null,
  deck: [],
  pile: [],
  lastPlay: null, // { playerId, claimedCount, cards[] }
  dealing: false,
  dealId: 0,
  dealIntervalMs: 350,
  dealTimer: null,
  suspenseUntil: 0
};

var CARD_VALUES = ['A', 'K', 'Q'];
var DECK_CONFIG = { A: 6, K: 6, Q: 6, JOKER: 2 };

function createDeck() {
  var deck = [];
  for (var i = 0; i < DECK_CONFIG.A; i++) deck.push('A');
  for (var j = 0; j < DECK_CONFIG.K; j++) deck.push('K');
  for (var k = 0; k < DECK_CONFIG.Q; k++) deck.push('Q');
  for (var m = 0; m < DECK_CONFIG.JOKER; m++) deck.push('JOKER');
  return shuffle(deck);
}

function shuffle(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function nextAlivePlayerId(fromPlayerId) {
  if (players.length === 0) return null;
  var startIdx = indexById(fromPlayerId);
  if (startIdx === -1) startIdx = 0;
  for (var i = 1; i <= players.length; i++) {
    var idx = (startIdx + i) % players.length;
    if (players[idx].alive) return players[idx].id;
  }
  return null;
}

function indexById(id) {
  for (var i = 0; i < players.length; i++) {
    if (players[i].id === id) return i;
  }
  return -1;
}

function alivePlayersCount() {
  var count = 0;
  for (var i = 0; i < players.length; i++) if (players[i].alive) count++;
  return count;
}

function initRevolver(player) {
  player.shotsInChamber = 0;
  player.chamber = 1 + Math.floor(Math.random() * 6); // guaranteed 1 of 6
}

function dealHands() {
  var deck = createDeck();
  for (var i = 0; i < players.length; i++) {
    if (players[i].alive) {
      players[i].hand = deck.splice(0, 5);
    } else {
      players[i].hand = [];
    }
  }
  game.deck = deck;
}

function startDealing() {
  dealHands();
  game.dealing = true;
  game.dealId = (game.dealId || 0) + 1;
  if (game.dealTimer) clearTimeout(game.dealTimer);
  var duration = game.dealIntervalMs * 5 + 200;
  game.dealTimer = setTimeout(function() {
    game.dealing = false;
    broadcastState();
  }, duration);
}

function startGame() {
  if (players.length < 2) return false;
  for (var i = 0; i < players.length; i++) {
    players[i].alive = true;
    players[i].bulletsSpent = 0;
    initRevolver(players[i]);
  }
  startDealing();
  game.started = true;
  game.currentRoundCard = CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)];
  game.currentPlayerId = players[0].id;
  game.pile = [];
  game.lastPlay = null;
  game.suspenseUntil = 0;
  broadcastState();
  return true;
}

function startNextRound(startFromPlayerId) {
  startDealing();
  game.currentRoundCard = CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)];
  game.pile = [];
  game.lastPlay = null;
  game.currentPlayerId = startFromPlayerId || nextAlivePlayerId(game.currentPlayerId);
  broadcastState();
}

function removeCardsFromHand(player, cardIndexes) {
  cardIndexes.sort(function(a, b) { return b - a; });
  var removed = [];
  for (var i = 0; i < cardIndexes.length; i++) {
    var idx = cardIndexes[i];
    if (idx >= 0 && idx < player.hand.length) {
      removed.push(player.hand.splice(idx, 1)[0]);
    }
  }
  return removed;
}

function isTruthful(cards, claimedCard) {
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (c !== claimedCard && c !== 'JOKER') return false;
  }
  return true;
}

function rouletteLoss(player) {
  player.bulletsSpent = (player.bulletsSpent || 0) + 1;
  player.shotsInChamber = (player.shotsInChamber || 0) + 1;
  var hit = player.shotsInChamber >= player.chamber;
  if (hit) {
    player.alive = false;
  }
  return hit;
}

function endGameIfNeeded() {
  if (alivePlayersCount() <= 1) {
    game.started = false;
    var winnerId = null;
    for (var i = 0; i < players.length; i++) {
      if (players[i].alive) {
        winnerId = players[i].id;
        players[i].wins = (players[i].wins || 0) + 1;
        break;
      }
    }
    broadcast('roundEnd', { winnerId: winnerId });
    for (var j = 0; j < players.length; j++) {
      players[j].alive = true;
      players[j].bulletsSpent = 0;
      initRevolver(players[j]);
    }
    startDealing();
    game.started = true;
    game.currentRoundCard = CARD_VALUES[Math.floor(Math.random() * CARD_VALUES.length)];
    game.currentPlayerId = winnerId || (players[0] && players[0].id);
    game.pile = [];
    game.lastPlay = null;
    game.suspenseUntil = 0;
    broadcastState();
    return true;
  }
  return false;
}

function broadcast(type, data) {
  var payload = JSON.stringify({ type: type, data: data });
  for (var i = 0; i < players.length; i++) {
    if (players[i].ws.readyState === WebSocket.OPEN) {
      players[i].ws.send(payload);
    }
  }
}

function buildPublicState() {
  return {
    started: game.started,
    currentRoundCard: game.currentRoundCard,
    currentPlayerId: game.currentPlayerId,
    pileCount: game.pile.length,
    dealing: game.dealing,
    dealId: game.dealId,
    dealIntervalMs: game.dealIntervalMs,
    suspenseUntil: game.suspenseUntil,
    lastPlay: game.lastPlay ? { playerId: game.lastPlay.playerId, claimedCount: game.lastPlay.claimedCount } : null,
    players: players.map(function(p) {
      return { id: p.id, name: p.name, alive: p.alive, handCount: p.hand.length, bulletsSpent: p.bulletsSpent || 0, wins: p.wins || 0 };
    })
  };
}

function broadcastState() {
  var publicState = buildPublicState();
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var personal = JSON.parse(JSON.stringify(publicState));
    personal.myHand = p.hand.slice();
    if (game.lastPlay) {
      personal.lastPlayView = {
        playerId: game.lastPlay.playerId,
        claimedCount: game.lastPlay.claimedCount,
        claimedCard: game.currentRoundCard,
        actualCards: (p.id === game.lastPlay.playerId) ? game.lastPlay.cards.slice() : null
      };
    } else {
      personal.lastPlayView = null;
    }
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'gameState', data: personal }));
    }
  }
}

function sendPlayersList() {
  var list = players.map(function(p) { return { id: p.id, name: p.name, alive: p.alive }; });
  broadcast('playersList', list);
}

function resolveChallenge(challengerId, isAuto) {
  if (!game.lastPlay) return;
  var liarId = game.lastPlay.playerId;
  var liar = players[indexById(liarId)];
  var challenger = players[indexById(challengerId)];
  if (!challenger || !challenger.alive) {
    var nextId = nextAlivePlayerId(liarId);
    challenger = players[indexById(nextId)];
  }
  if (!liar || !challenger) return;

  var truthful = isTruthful(game.lastPlay.cards, game.currentRoundCard);
  var loser = truthful ? challenger : liar;
  var hit = rouletteLoss(loser);
  var delayMs = 3000 + Math.floor(Math.random() * 3001);

  game.suspenseUntil = Date.now() + delayMs;

  broadcast('challengeResult', {
    truthful: truthful,
    liarId: liarId,
    challengerId: challenger.id,
    loserId: loser.id,
    hit: hit,
    cards: game.lastPlay.cards,
    delayMs: delayMs,
    auto: !!isAuto
  });
  broadcastState();

  setTimeout(function() {
    if (endGameIfNeeded()) return;
    var nextStart = loser.alive ? loser.id : nextAlivePlayerId(loser.id);
    game.suspenseUntil = 0;
    startNextRound(nextStart);
  }, delayMs);
}

wss.on('connection', function(ws) {
  var playerId = Math.random().toString(36).substr(2, 8);
  var playerName = 'Игрок ' + (players.length + 1);

  var player = { id: playerId, name: playerName, ws: ws, alive: true, hand: [], bulletsSpent: 0, wins: 0, chamber: 0, shotsInChamber: 0 };
  initRevolver(player);
  players.push(player);

  ws.send(JSON.stringify({ type: 'init', data: { id: playerId } }));
  sendPlayersList();
  broadcastState();

  ws.on('message', function(message) {
    var parsed;
    try {
      parsed = JSON.parse(message);
    } catch (e) {
      return;
    }

    var type = parsed.type;
    var data = parsed.data || {};

    if (type === 'setName') {
      if (typeof data.name === 'string' && data.name.trim()) {
        player.name = data.name.trim().slice(0, 20);
        sendPlayersList();
        broadcastState();
      }
      return;
    }

    if (type === 'startGame') {
      if (!game.started) {
        startGame();
      }
      return;
    }

    if (!game.started) return;
    if (game.dealing) return;
    if (game.suspenseUntil && Date.now() < game.suspenseUntil) return;
    if (!player.alive) return;

    if (type === 'playCards') {
      if (game.currentPlayerId !== player.id) return;
      if (!Array.isArray(data.cardIndexes) || data.cardIndexes.length === 0) return;

      var removed = removeCardsFromHand(player, data.cardIndexes);
      if (removed.length === 0) return;

      game.pile = game.pile.concat(removed);
      game.lastPlay = {
        playerId: player.id,
        claimedCount: removed.length,
        cards: removed
      };

      game.currentPlayerId = nextAlivePlayerId(player.id);
      broadcastState();

      if (player.hand.length === 0) {
        resolveChallenge(game.currentPlayerId, true);
      }
      return;
    }

    if (type === 'challenge') {
      if (!game.lastPlay) return;
      if (game.currentPlayerId !== player.id) return;
      resolveChallenge(player.id, false);
      return;
    }
  });

  ws.on('close', function() {
    var idx = indexById(player.id);
    if (idx !== -1) players.splice(idx, 1);

    if (game.started && alivePlayersCount() <= 1) {
      game.started = false;
    }

    if (game.currentPlayerId === player.id) {
      game.currentPlayerId = nextAlivePlayerId(player.id);
    }

    sendPlayersList();
    broadcastState();
  });
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('Сервер запущен на http://0.0.0.0:' + PORT);
  console.log('WebSocket: ws://0.0.0.0:' + PORT);
});
