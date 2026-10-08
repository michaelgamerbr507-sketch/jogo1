const DEFAULT_TIME = 15;
let ROUND_TIME = DEFAULT_TIME;
let deck = [], index = 0, time = ROUND_TIME, interval = null, running = false, locked = false, paused = false;
let attempts = new Map(), roundWinners = [], totalPlayers = new Map(), totals = new Map();
let ws = null, reconnectAttempts = 0;
const MAX_RECONNECT = 10, RECONNECT_DELAY = 5000;
let tickTockInterval = null;
let revealedLetters = 0;
let avatarCache = new Map();

const $ = id => document.getElementById(id);
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": "'"
  }[c]));
}

function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function av(p, cls = 'avatar') {
  const key = p.userId || p.key || p.name;
  if (avatarCache.has(key)) return avatarCache.get(key);

  const html = p.avatar
    ? <img class="${cls}" src="${esc(p.avatar)}" alt="" loading="lazy">
    : <span class="${cls} avatar-fallback">${esc((p.name || '??').replace('@', '').slice(0, 2).toUpperCase())}</span>;

  avatarCache.set(key, html);
  return html;
}

function renderFlag() {
  const q = deck[index];
  $('flag').innerHTML = q.flagAsset ? <img src="${esc(q.flagAsset)}" alt="${esc(q.name)}"> : esc(q.flag);
}

function renderAttempts() {
  const a = [...attempts.values()];
  $('attemptCount').textContent = a.length;
  $('attempts').innerHTML = a.slice(-8).map(p => av(p)).join('');
  const ac2 = $('attemptCount2');
  if (ac2) ac2.textContent = a.length;
}

function row(p, i, pts) {
  return <div class="row"><span class="pos">#${i + 1}</span>${av(p)}<span class="name">${esc(p.name)}</span><span class="pts">${pts} PTS</span></div>;
}

function renderRanks() {
  const rr = roundWinners.slice(0, 5);
  $('roundRanking').innerHTML = rr.length ? rr.map((p, i) => row(p, i, p.points)).join('') : '<div class="empty">Quem acertar aparece aqui</div>';
  const tr = [...totals.values()].sort((a, b) => b.points - a.points || a.order - b.order).slice(0, 5);
  $('totalRanking').innerHTML = tr.length ? tr.map((p, i) => row(p, i, p.points)).join('') : '<div class="empty">Ranking da partida aguardando</div>';
}

function renderHitAvatars() {
  const hitAvatars = $('hitAvatars');
  const hitCount = $('hitCount');
  if (!hitAvatars) return;

  if (roundWinners.length === 0) {
    hitAvatars.innerHTML = '';
    if (hitCount) hitCount.textContent = 0;
    return;
  }

  if (hitCount) hitCount.textContent = roundWinners.length;

  hitAvatars.innerHTML = roundWinners.map(w =>
    `<div class="hit-avatar-wrap">
      ${w.avatar ? <img class="hit-avatar" src="${esc(w.avatar)}" alt=""> : <span class="hit-avatar hit-avatar-fallback">${esc(w.name.replace('@', '').slice(0, 2).toUpperCase())}</span>}
      <span class="hit-name">${esc(w.name)}</span>
    </div>`
  ).join('');
}

function buildHint(answer, revealCount = 0) {
  const chars = [...answer];
  let out = '';                                                                                                                                                 let revealed = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/[A-Za-zÀ-ÿ]/.test(c)) {
      if (revealed < revealCount) {
        out += c.toUpperCase();
        revealed++;
      } else {
        out += '_';
      }
    } else {
      out += c === ' ' ? '  ' : c;
    }
  }
  return out;
}

function render() {
  const q = deck[index];
  $('roundNumber').textContent = index + 1;
  $('roundTotal').textContent = deck.length;
  $('timer').textContent = time;
  $('progressBar').style.width = ${Math.max(0, time / ROUND_TIME * 100)}%;
  renderFlag();
  renderAttempts();
  renderRanks();
  renderHitAvatars();

  const hintEl = $('hint');
  if (hintEl && deck[index]) {
    hintEl.textContent = buildHint(deck[index].name, revealedLetters);
  }
}

function start() {
  clearInterval(interval);
  deck = shuffle(COUNTRIES);
  index = 0;
  newQuestion();
}

function newQuestion() {
  clearInterval(interval);
  attempts.clear();
  roundWinners = [];
  locked = false;
  paused = false;
  time = ROUND_TIME;
  revealedLetters = 0;
  $('hint').textContent = '';
  $('message').textContent = 'VALENDO!';
  $('message').className = 'message';

  const q = deck[index];                                                                                                                                        if (q) {
    $('hint').textContent = buildHint(q.name, 0);
  }

  render();
  interval = setInterval(tick, 1000);
  running = true;
  startTickTock();
}

function tick() {
  if (paused || locked) return;

  time = Math.max(0, time - 1);
  render();

  if (time === 0) {
    clearInterval(interval);
    interval = null;
    running = false;
    locked = true;
    stopTickTock();
    timeUp();
  }
}

function timeUp() {
  const winners = roundWinners.slice();
  roundWinners = [];
  renderHitAvatars();
  if (winners.length > 0) {
    showOverlay(winners);
  } else {
    showOverlay(null);
  }
}

function showOverlay(firstOrList) {
  const ov = $('winnerOverlay');
  if (firstOrList && firstOrList.length > 0) {
    let html = '';
    firstOrList.forEach((w, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : #${i + 1};
      html += ${av(w, 'winner-avatar')}<div class="winner-name">${esc(w.name)}</div><div class="winner-label">${medal} — +${w.points} PTS</div>;                    if (i < firstOrList.length - 1) html += '<hr style="margin:8px auto;width:60%;border-color:#fff3">';
    });
    $('winnerContent').innerHTML = html;
  } else {
    $('winnerContent').innerHTML = '<div class="winner-fallback">!</div><div class="winner-name">NINGUEM ACERTOU</div><div class="winner-label">A RESPOSTA ERA</div><div class="winner-answer">' + esc(deck[index].name.toUpperCase()) + '</div>';
  }
  $('winnerOverlay').classList.add('show');
  let n = 3;
  $('nextCountdown').textContent = n;
  const t = setInterval(() => {
    n--;
    $('nextCountdown').textContent = Math.max(n, 0);
    if (n <= 0) {
      clearInterval(t);
      $('winnerOverlay').classList.remove('show');
      advance();
    }
  }, 1000);
}

function advance() {
  index++;
  if (index >= deck.length) {
    deck = shuffle(COUNTRIES);
    index = 0;
  }
  newQuestion();
}

function addChat(p, message) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = p.avatar ? <img src="${esc(p.avatar)}" alt=""><b>${esc(p.name)}</b><span>${esc(message)}</span> : <b>${esc(p.name)}</b><span>${esc(message)}</span>;
  $('chatList').prepend(el);
  while ($('chatList').children.length > 4) $('chatList').lastChild.remove();
}

function attempt(username, message, avatar = '') {
  if (!running || locked) return false;
  const name = String(username || '@Jogador').startsWith('@') ? String(username) : '@' + String(username);
  const key = norm(name);
  const pAttempt = { key, name, avatar };
  addChat(pAttempt, message);
  if (!attempts.has(key)) {
    attempts.set(key, pAttempt);
    renderAttempts();
  }
  const q = deck[index];
  const correct = [q.name, ...(q.aliases || [])].map(norm).includes(norm(message));
  if (!correct) return false;
  if (roundWinners.some(p => p.key === key)) return true;
  if (roundWinners.length >= 5) return true;

  const points = [5, 3, 2, 1, 1][roundWinners.length];
  const p = totals.get(key) || { key, name, avatar, points: 0, order: totals.size };
  if (avatar) p.avatar = avatar;
  p.points += points;
  totals.set(key, p);
  const w = { key, name: p.name, avatar: p.avatar, points };
  roundWinners.push(w);

  renderHitAvatars();
  renderRanks();

  $('message').textContent = ${name} ACERTOU! +${points} PTS;
  $('message').className = 'message good';

  return true;
}

window.handleChatMessage = (username, message, avatarUrl = '') => attempt(username, message, avatarUrl || '');

function revealHint() {
  const n = deck[index]?.name || '';
  if (!n) return;

  const letterCount = [...n].filter(c => /[A-Za-zÀ-ÿ]/.test(c)).length;

  if (revealedLetters < letterCount) {
    revealedLetters++;
    $('hint').textContent = buildHint(deck[index].name, revealedLetters);
    try {
      const A = window.AudioContext || window.webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = .025;
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .08);
    } catch (e) {}
  }
}

window.handleGiftEvent = revealHint;

function startTickTock() {
  stopTickTock();
  playTick();
  tickTockInterval = setInterval(playTick, 1000);
}

function stopTickTock() {
  if (tickTockInterval) {
    clearInterval(tickTockInterval);
    tickTockInterval = null;
  }
}

function playTick() {
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    const c = new A(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 750;
    o.type = 'sine';
    g.gain.value = 0.018;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.07);
  } catch (e) {}                                                                                                                                              }

function connectBridge(bridgeUrl, tiktokUsername) {
  if (ws) { ws.close(); ws = null; }
  console.log('[GAME] Conectando ao bridge:', bridgeUrl);
  ws = new WebSocket(bridgeUrl);
  ws.onopen = () => {
    console.log('[GAME] Conectado ao bridge');
    reconnectAttempts = 0;
    setLiveStatus('connecting', 'CONECTANDO...');
    const httpUrl = bridgeUrl.replace('wss:', 'https:').replace('ws:', 'http:');
    fetch(httpUrl + '/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: tiktokUsername })
    }).then(r => r.json()).then(data => console.log('[GAME] Bridge:', data)).catch(err => console.error('[GAME] Erro connect:', err));
  };
  ws.onmessage = (event) => {
    try {                                                                                                                                                           handleBridgeEvent(JSON.parse(event.data));
    } catch (e) {
      console.error('[GAME] Parse error:', e);
    }
  };
  ws.onclose = () => {
    console.log('[GAME] Desconectado, reconectando...');
    ws = null;
    setLiveStatus('disconnected', 'DESCONECTADO');
    if (reconnectAttempts < MAX_RECONNECT) {
      reconnectAttempts++;
      setTimeout(() => connectBridge(bridgeUrl, tiktokUsername), RECONNECT_DELAY);
    }
  };
  ws.onerror = (err) => console.error('[GAME] WS error:', err);
}

function handleBridgeEvent(event) {
  switch (event.type) {
    case 'comment':
      console.log('[GAME] Chat:', event.nickname, event.comment);
      attempt(event.nickname, event.comment, event.avatar);
      break;
    case 'gift':
      console.log('[GAME] Gift:', event.nickname, event.giftName, 'x' + event.count);
      const giftCount = event.count || 1;
      for (let i = 0; i < giftCount; i++) {
        revealHint();
      }
      break;
    case 'like':
    case 'follow':
    case 'share':
      break;
    case 'bridge_status':
      setLiveStatus(event.status, event.reason || event.error || event.username);
      break;
  }
}

function setLiveStatus(status, text) {
  const dot = $('liveDot'), txt = $('liveText');
  if (!dot || !txt) return;
  dot.className = 'live-dot ' + status;
  txt.textContent = text || status;
}

$('start').onclick = start;
$('next').onclick = advance;
$('demoSend').onclick = () => {
  const m = $('demoMessage').value.trim();
  if (m) {
    handleChatMessage($('demoUser').value, m, $('demoAvatar').value.trim());
    $('demoMessage').value = '';
  }
};
$('demoMessage').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('demoSend').click();
});
$('giftTip').onclick = revealHint;
$('adminToggle').onclick = () => $('admin').classList.toggle('hidden');
$('adminClose').onclick = () => $('admin').classList.add('hidden');
$('pause').onclick = () => {
  paused = !paused;
  $('pause').textContent = paused ? 'CONTINUAR' : 'PAUSAR';
  if (paused) stopTickTock();
  else startTickTock();
};
$('reset').onclick = () => {
  totals.clear();
  start();
};
$('showAnswer').onclick = () => {
  if (!running || locked) return;
  const q = deck[index];
  if (!q) return;
  $('hint').textContent = q.name.toUpperCase();
  $('message').textContent = RESPOSTA REVELADA: ${q.name.toUpperCase()};
  $('message').className = 'message timeout';
};
$('timeInput').onchange = e => {
  ROUND_TIME = Math.max(3, Math.min(120, +e.target.value || 15));
  time = ROUND_TIME;
  render();
};

const modeToggle = $('modeToggle'), modeLabel = $('modeLabel');
if (modeToggle && modeLabel) {
  modeToggle.checked = true;
  modeToggle.onchange = () => {
    $('testChat').classList.toggle('hidden', !modeToggle.checked);
    modeLabel.textContent = modeToggle.checked ? 'Modo Desenvolvimento (chat teste visivel)' : 'Modo Normal (chat teste oculto)';
  };
}

const BRIDGE_CONFIG = {
  url: 'wss://tiktokbridge.onrender.com',
  tiktokUsername: 'truecrimevideosreal'
};

if (BRIDGE_CONFIG.url !== 'wss://SEU_BRIDGE.onrender.com') {                                                                                                    connectBridge(BRIDGE_CONFIG.url, BRIDGE_CONFIG.tiktokUsername);
} else {
  console.log('[GAME] Configure BRIDGE_CONFIG no game.js com sua URL do Render e @ do streamer');
}

if (window.COUNTRIES?.length) {
  deck = shuffle(COUNTRIES);
  render();
}
