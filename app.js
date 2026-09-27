// app.js — logique du client. Aucune donnée secrète n'existe ici : le
// serveur n'envoie à chaque joueur que ce qu'il a le droit de voir
// (son propre rôle, les résultats déjà révélés, etc.). Ce fichier ne fait
// qu'afficher l'état reçu et transmettre les actions du joueur.

const socket = io();

const el = (id) => document.getElementById(id);
const screens = {
  home: el('screen-home'),
  lobby: el('screen-lobby'),
  game: el('screen-game'),
  end: el('screen-end'),
};

const CAUSE_TEXT = {
  loups: "a été dévoré·e par les loups",
  poison: "a été empoisonné·e par la Sorcière",
  petite_fille: "a été repérée en train d'espionner les loups, et n'a pas survécu à sa curiosité",
  amour: "est mort·e de chagrin",
  vote: "a été éliminé·e par le village",
  chasseur: "a été emporté·e par le tir du Chasseur",
};

function causeText(cause) {
  return CAUSE_TEXT[cause] || 'est mort·e';
}

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function toast(message) {
  const t = el('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

let myToken = localStorage.getItem('lg_token');
let myCode = localStorage.getItem('lg_code');
let timerInterval = null;

if (myToken && myCode) {
  socket.emit('rejoin', { token: myToken, code: myCode });
}

// Pré-remplit le code si on arrive via un lien d'invitation ?join=CODE
const params = new URLSearchParams(window.location.search);
if (params.get('join')) el('code-input').value = params.get('join').toUpperCase();

// ---------------- Écran d'accueil ----------------

el('btn-create').addEventListener('click', () => {
  const pseudo = el('pseudo-input').value.trim();
  if (!pseudo) return toast('Choisis un pseudo pour continuer.');
  socket.emit('create_room', { pseudo });
});

el('btn-join').addEventListener('click', () => {
  const pseudo = el('pseudo-input').value.trim();
  const code = el('code-input').value.trim().toUpperCase();
  if (!pseudo) return toast('Choisis un pseudo pour continuer.');
  if (code.length !== 4) return toast('Le code du salon fait 4 lettres.');
  socket.emit('join_room', { pseudo, code });
});

socket.on('joined_room', ({ code, token }) => {
  myToken = token;
  myCode = code;
  localStorage.setItem('lg_token', token);
  localStorage.setItem('lg_code', code);
});

socket.on('error_message', ({ message }) => toast(message));

socket.on('voyante_result', ({ targetPseudo, roleName }) => {
  toast(`🔮 ${targetPseudo} est : ${roleName}`);
});

socket.on('lover_result', ({ partnerPseudo }) => {
  toast(`💘 Tu es désormais amoureux·se de ${partnerPseudo} !`);
});

socket.on('petite_fille_result', ({ wolfNames }) => {
  toast(wolfNames.length
    ? `👧 Tu as repéré les loups : ${wolfNames.join(', ')}`
    : `👧 Tu n'as rien pu observer cette nuit.`);
});

// ---------------- Lobby : actions ----------------

el('btn-copy-link').addEventListener('click', () => {
  const url = `${window.location.origin}/?join=${myCode}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => toast('Lien copié !')).catch(() => toast(url));
  } else {
    toast(url);
  }
});

el('btn-ready').addEventListener('click', () => socket.emit('toggle_ready'));
el('btn-start').addEventListener('click', () => socket.emit('start_game'));
el('btn-host-advance').addEventListener('click', () => socket.emit('host_advance'));
el('btn-replay').addEventListener('click', () => socket.emit('request_replay'));

const SETTINGS_INPUT_IDS = [
  'set-wolves', 'set-voyante', 'set-sorciere', 'set-chasseur',
  'set-cupidon', 'set-ancien', 'set-petite-fille', 'set-discussion', 'set-vote',
];
SETTINGS_INPUT_IDS.forEach(id => el(id).addEventListener('change', sendSettings));

function sendSettings() {
  socket.emit('update_settings', {
    settings: {
      numWolves: parseInt(el('set-wolves').value, 10),
      includeVoyante: el('set-voyante').checked,
      includeSorciere: el('set-sorciere').checked,
      includeChasseur: el('set-chasseur').checked,
      includeCupidon: el('set-cupidon').checked,
      includeAncien: el('set-ancien').checked,
      includePetiteFille: el('set-petite-fille').checked,
      discussionDuration: parseInt(el('set-discussion').value, 10),
      voteDuration: parseInt(el('set-vote').value, 10),
    },
  });
}

// ---------------- Réception de l'état & rendu ----------------

socket.on('state_update', (state) => render(state));

function render(state) {
  if (state.phase === 'lobby') {
    showScreen('lobby');
    renderLobby(state);
  } else if (state.phase === 'ended') {
    showScreen('end');
    renderEnd(state);
  } else {
    showScreen('game');
    renderGame(state);
  }
}

function renderLobby(state) {
  el('room-code').textContent = state.code;
  el('player-count').textContent = state.players.length;

  const list = el('player-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.className = 'player-row' + (p.connected ? '' : ' offline');
    li.innerHTML = `
      <span><span class="dot ${p.ready ? 'ready' : ''}"></span>${escapeHtml(p.pseudo)} ${p.isHost ? '👑' : ''} ${p.isYou ? '(toi)' : ''}</span>
      <span class="status">${p.connected ? (p.ready ? 'Prêt' : 'En attente') : 'Hors ligne'}</span>
    `;
    list.appendChild(li);
  });

  const you = state.you;
  const isHost = !!you?.isHost;
  el('host-settings').classList.toggle('hidden', !isHost);
  el('btn-start').classList.toggle('hidden', !isHost);
  el('btn-ready').textContent = state.players.find(p => p.isYou)?.ready ? '✅ Prêt !' : 'Je suis prêt';

  if (!isHost) {
    el('set-wolves').value = state.settings.numWolves;
    el('set-voyante').checked = state.settings.includeVoyante;
    el('set-sorciere').checked = state.settings.includeSorciere;
    el('set-chasseur').checked = state.settings.includeChasseur;
    el('set-cupidon').checked = state.settings.includeCupidon;
    el('set-ancien').checked = state.settings.includeAncien;
    el('set-petite-fille').checked = state.settings.includePetiteFille;
    el('set-discussion').value = state.settings.discussionDuration;
    el('set-vote').value = state.settings.voteDuration;
  }
  SETTINGS_INPUT_IDS.forEach(id => { el(id).disabled = !isHost; });

  const connectedCount = state.players.filter(p => p.connected).length;
  const readyCount = state.players.filter(p => p.ready && p.connected).length;
  el('lobby-hint').textContent = connectedCount < 5
    ? `Il faut au moins 5 joueurs pour commencer (actuellement ${connectedCount}).`
    : `${readyCount}/${connectedCount} joueur(s) prêt(s).`;
}

function renderGame(state) {
  const phaseLabels = {
    night: '🌙 Nuit',
    day_reveal: '☀️ Aube',
    discussion: '🗣️ Discussion',
    vote: '🗳️ Vote',
    vote_reveal: '📯 Résultat du vote',
    hunter_shot: '🏹 Riposte du chasseur',
  };
  el('phase-badge').textContent = phaseLabels[state.phase] || state.phase;
  document.body.classList.toggle('night-bg', state.phase === 'night' || state.phase === 'hunter_shot');

  renderTimer(state.timerEndsAt);

  const you = state.you;
  const roleCard = el('role-card');
  if (you?.role) {
    roleCard.classList.remove('hidden');
    el('role-emoji').textContent = you.roleEmoji || '❔';
    el('role-name').textContent = you.roleName || '';
    el('role-desc').textContent = you.roleDescription || '';

    const extraEl = el('role-extra');
    if (you.role === 'ancien') {
      extraEl.textContent = you.extraLife ? '🛡️ Ta protection est intacte.' : '🛡️ Tu as déjà utilisé ta protection.';
      extraEl.classList.remove('hidden');
    } else {
      extraEl.classList.add('hidden');
    }

    const loverEl = el('role-lover');
    if (you.loverPartnerPseudo) {
      loverEl.textContent = `💘 Amoureux·se de ${you.loverPartnerPseudo}`;
      loverEl.classList.remove('hidden');
    } else {
      loverEl.classList.add('hidden');
    }
  } else {
    roleCard.classList.add('hidden');
  }

  const list = el('game-player-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.className = 'player-row' + (p.alive ? '' : ' dead') + (p.connected ? '' : ' offline');
    li.innerHTML = `
      <span>${p.alive ? '' : '💀 '}${escapeHtml(p.pseudo)} ${p.isYou ? '(toi)' : ''}</span>
      ${p.revealedRole ? `<span class="status">${escapeHtml(p.revealedRole)}</span>` : ''}
    `;
    list.appendChild(li);
  });

  renderActionZone(state);

  const canAdvance = you?.isHost && (state.phase === 'day_reveal' || state.phase === 'vote_reveal');
  const advanceBtn = el('btn-host-advance');
  advanceBtn.classList.toggle('hidden', !canAdvance);
  advanceBtn.textContent = state.phase === 'day_reveal' ? '🗣️ Passer à la discussion' : '🌙 Nuit suivante';
}

function renderActionZone(state) {
  const zone = el('action-zone');
  const you = state.you;
  zone.innerHTML = '';

  if (state.phase === 'day_reveal') {
    zone.innerHTML = renderDeathsList(state.lastNightDeaths);
    return;
  }

  if (state.phase === 'discussion') {
    zone.innerHTML = `<p class="waiting">💬 C'est l'heure de débattre à voix haute avec les autres joueurs.</p>`;
    return;
  }

  if (state.phase === 'vote_reveal') {
    const r = state.lastVoteResult;
    let html = r?.eliminated
      ? `<p class="reveal">${escapeHtml(r.eliminated.pseudo)} ${causeText(r.eliminated.cause)} : <strong>${escapeHtml(r.eliminated.roleName)}</strong></p>`
      : `<p class="reveal">Égalité : personne n'est éliminé aujourd'hui.</p>`;
    (r?.extraDeaths || []).forEach(d => {
      html += `<p class="reveal">💔 ${escapeHtml(d.pseudo)} ${causeText(d.cause)} : <strong>${escapeHtml(d.roleName)}</strong></p>`;
    });
    zone.innerHTML = html;
    return;
  }

  if (!you) return;

  if (state.phase === 'night' && !you.alive) {
    zone.innerHTML = `<p class="waiting">Tu es éliminé. Observe la suite en silence...</p>`;
    return;
  }

  const alivePlayers = state.players.filter(p => p.alive && !p.isYou);
  const pending = state.pendingAction;

  if (pending === 'cupidon') {
    zone.innerHTML = `<p class="prompt">💘 Choisis les deux joueurs qui tombent amoureux cette nuit :</p>`;
    renderCupidonPicker(zone, alivePlayers.concat(you.alive ? [{ token: you.token, pseudo: you.pseudo + ' (toi)' }] : []));
  } else if (pending === 'voyante') {
    zone.innerHTML = `<p class="prompt">🔮 Choisis un joueur dont tu veux découvrir le rôle :</p>`;
    zone.appendChild(buildTargetButtons(alivePlayers, (targetToken) => socket.emit('voyante_action', { targetToken })));
  } else if (pending === 'loups') {
    zone.innerHTML = `<p class="prompt">🐺 Choisissez ensemble votre victime :</p>`;
    zone.appendChild(buildTargetButtons(alivePlayers, (targetToken) => socket.emit('wolf_action', { targetToken })));
  } else if (pending === 'petite_fille') {
    zone.innerHTML = `<p class="prompt">👧 Veux-tu espionner les loups cette nuit ? Tu risques d'être repérée...</p>`;
    const spyBtn = document.createElement('button');
    spyBtn.className = 'btn btn-secondary';
    spyBtn.textContent = '👀 Espionner (risqué)';
    spyBtn.onclick = () => { socket.emit('petite_fille_action', { spy: true }); disableActionZone(); };
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-small';
    skipBtn.style.marginTop = '10px';
    skipBtn.textContent = 'Rester bien sagement couchée';
    skipBtn.onclick = () => { socket.emit('petite_fille_action', { spy: false }); disableActionZone(); };
    zone.appendChild(spyBtn);
    zone.appendChild(skipBtn);
  } else if (pending === 'sorciere') {
    const target = state.wolfTargetPseudo;
    zone.innerHTML = `<p class="prompt">❤️ Les loups ont désigné : <strong>${target ? escapeHtml(target) : 'personne cette nuit'}</strong></p>`;
    if (you.potions?.heal && target) {
      const healBtn = document.createElement('button');
      healBtn.className = 'btn btn-secondary';
      healBtn.textContent = '💚 Sauver cette personne';
      healBtn.onclick = () => { socket.emit('sorciere_action', { heal: true }); disableActionZone(); };
      zone.appendChild(healBtn);
    }
    if (you.potions?.poison) {
      const p = document.createElement('p');
      p.className = 'prompt';
      p.style.marginTop = '14px';
      p.textContent = "Ou empoisonner quelqu'un :";
      zone.appendChild(p);
      zone.appendChild(buildTargetButtons(alivePlayers, (targetToken) => socket.emit('sorciere_action', { poisonTargetToken: targetToken })));
    }
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-small';
    skipBtn.style.marginTop = '14px';
    skipBtn.textContent = 'Ne rien faire';
    skipBtn.onclick = () => { socket.emit('sorciere_action', {}); disableActionZone(); };
    zone.appendChild(skipBtn);
  } else if (pending === 'vote') {
    zone.innerHTML = `<p class="prompt">🗳️ Vote pour éliminer un joueur :</p>`;
    zone.appendChild(buildTargetButtons(alivePlayers, (targetToken) => socket.emit('cast_vote', { targetToken })));
  } else if (pending === 'hunter_shot') {
    zone.innerHTML = `<p class="prompt">🏹 Avant de mourir, choisis qui tu emportes avec toi :</p>`;
    zone.appendChild(buildTargetButtons(state.players.filter(p => p.alive && !p.isYou), (targetToken) => socket.emit('hunter_shot', { targetToken })));
  } else if (state.phase === 'night') {
    zone.innerHTML = `<p class="waiting">🌙 Le village dort... attends ton tour.</p>`;
  } else if (state.phase === 'hunter_shot') {
    zone.innerHTML = `<p class="waiting">🏹 Le chasseur ajuste son tir...</p>`;
  } else if (state.phase === 'vote') {
    zone.innerHTML = `<p class="waiting">🗳️ Ton vote est enregistré, en attente des autres joueurs...</p>`;
  }
}

function renderCupidonPicker(zone, players) {
  let picked = [];
  const wrap = document.createElement('div');
  wrap.className = 'target-grid';
  const buttons = players.map(p => {
    const btn = document.createElement('button');
    btn.className = 'btn target-btn';
    btn.textContent = p.pseudo;
    btn.onclick = () => {
      if (picked.includes(p.token)) {
        picked = picked.filter(t => t !== p.token);
        btn.classList.remove('picked');
      } else if (picked.length < 2) {
        picked.push(p.token);
        btn.classList.add('picked');
      }
      if (picked.length === 2) {
        socket.emit('cupidon_action', { loverAToken: picked[0], loverBToken: picked[1] });
        buttons.forEach(b => { b.disabled = true; });
      }
    };
    wrap.appendChild(btn);
    return btn;
  });
  zone.appendChild(wrap);
}

function disableActionZone() {
  el('action-zone').querySelectorAll('button').forEach(b => { b.disabled = true; });
}

function renderDeathsList(deaths) {
  if (!deaths || deaths.length === 0) {
    return `<p class="reveal">Cette nuit, personne n'est mort. Le village a eu de la chance.</p>`;
  }
  return deaths.map(d => `<p class="reveal">💀 ${escapeHtml(d.pseudo)} ${causeText(d.cause)} : <strong>${escapeHtml(d.roleName)}</strong></p>`).join('');
}

function buildTargetButtons(players, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'target-grid';
  players.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn target-btn';
    btn.textContent = p.pseudo;
    btn.onclick = () => {
      onPick(p.token);
      btn.classList.add('picked');
      wrap.querySelectorAll('button').forEach(b => { b.disabled = true; });
    };
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderTimer(endsAt) {
  clearInterval(timerInterval);
  const timerEl = el('timer');
  if (!endsAt) { timerEl.textContent = ''; return; }
  function tick() {
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    timerEl.textContent = `⏱ ${remaining}s`;
    if (remaining <= 0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function renderEnd(state) {
  const banner = el('winner-banner');
  const labels = {
    loups: '🐺 Les Loups-Garous ont gagné !',
    village: '🏡 Le Village a gagné !',
    amoureux: "💘 L'Amour a gagné !",
  };
  banner.textContent = labels[state.winner] || 'Partie terminée';
  banner.className = 'winner-banner ' + (state.winner || '');

  const list = el('end-role-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.className = 'player-row' + (p.alive ? '' : ' dead');
    li.innerHTML = `
      <span>${p.alive ? '🙂' : '💀'} ${escapeHtml(p.pseudo)} ${p.isYou ? '(toi)' : ''}</span>
      <span class="status">${escapeHtml(p.revealedRole || '')}</span>
    `;
    list.appendChild(li);
  });

  const you = state.you;
  el('btn-replay').classList.toggle('hidden', !you?.isHost);
  el('end-hint').textContent = you?.isHost ? '' : "En attente que l'hôte relance une partie...";
}
