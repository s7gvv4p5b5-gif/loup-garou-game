// Room.js
// Toute la logique de jeu vit ici, côté serveur uniquement : un joueur ne
// peut ni voir les rôles des autres, ni influencer la résolution d'une
// nuit ou d'un vote en modifiant son navigateur. Le client ne fait que
// refléter l'état que ce fichier calcule et lui envoie.

const { ROLES, buildRoleDeck, shuffle } = require('./roles');

const NIGHT_STEP_TIMEOUT = 30000; // 30s max par étape de nuit
const HUNTER_SHOT_TIMEOUT = 20000; // 20s pour que le chasseur tire
const LOBBY_REMOVE_DELAY = 15000; // délai avant de retirer un joueur déconnecté du lobby

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map(); // token -> player
    this.hostToken = null;
    this.settings = {
      numWolves: 2,
      includeVoyante: true,
      includeSorciere: true,
      includeChasseur: true,
      discussionDuration: 90,
      voteDuration: 45,
    };
    this.phase = 'lobby';
    this.createdAt = Date.now();
    this._resetGameState();
  }

  _resetGameState() {
    this.nightNumber = 0;
    this.nightSteps = [];
    this.nightStepIndex = 0;
    this.wolfVotes = {};
    this.pendingWolfTarget = null;
    this.healUsedThisNight = false;
    this.poisonTargetThisNight = null;
    this.lastNightDeaths = [];
    this.lastVoteResult = null;
    this.votes = {};
    this.pendingHunterShot = null;
    this.hunterShotQueue = [];
    this.deathContext = null;
    this.winner = null;
    this._clearTimer();
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.timerEndsAt = null;
  }

  _setTimer(ms, fn) {
    this._clearTimer();
    this.timerEndsAt = Date.now() + ms;
    this._timer = setTimeout(fn, ms);
  }

  // ---------------- Joueurs & connexion ----------------

  addPlayer(pseudo, token, socketId) {
    if (this.phase !== 'lobby') {
      throw new Error('La partie a déjà commencé.');
    }
    const clean = (pseudo || '').trim().slice(0, 20) || 'Joueur';
    const taken = [...this.players.values()].some(
      p => p.connected && p.pseudo.toLowerCase() === clean.toLowerCase()
    );
    if (taken) throw new Error('Ce pseudo est déjà pris dans ce salon.');

    const player = {
      token,
      socketId,
      pseudo: clean,
      connected: true,
      isHost: this.players.size === 0,
      ready: false,
      alive: true,
      role: null,
      potions: null,
    };
    if (player.isHost) this.hostToken = token;
    this.players.set(token, player);
    return player;
  }

  rejoin(token, socketId) {
    const player = this.players.get(token);
    if (!player) throw new Error("Partie introuvable pour ce joueur (elle a peut-être expiré).");
    clearTimeout(player._removeTimer);
    player.socketId = socketId;
    player.connected = true;
    return player;
  }

  handleDisconnect(token) {
    const player = this.players.get(token);
    if (!player) return;
    player.connected = false;

    if (this.phase === 'lobby') {
      player._removeTimer = setTimeout(() => {
        if (!player.connected) {
          this.players.delete(token);
          if (this.hostToken === token) this._promoteNextHost();
          this.broadcastState();
        }
      }, LOBBY_REMOVE_DELAY);
    } else if (this.hostToken === token) {
      this._promoteNextHost();
    }
    this.broadcastState();
  }

  _promoteNextHost() {
    const next = [...this.players.values()].find(p => p.connected);
    if (next) {
      this.players.forEach(p => { p.isHost = false; });
      next.isHost = true;
      this.hostToken = next.token;
    }
  }

  isEmpty() {
    return [...this.players.values()].every(p => !p.connected);
  }

  // ---------------- Lobby ----------------

  toggleReady(token) {
    const player = this._requirePlayer(token);
    if (this.phase !== 'lobby') return;
    player.ready = !player.ready;
    this.broadcastState();
  }

  updateSettings(token, settings) {
    this._requireHost(token);
    if (this.phase !== 'lobby' || !settings) return;
    this.settings = {
      ...this.settings,
      includeVoyante: !!settings.includeVoyante,
      includeSorciere: !!settings.includeSorciere,
      includeChasseur: !!settings.includeChasseur,
      numWolves: Math.max(1, parseInt(settings.numWolves, 10) || this.settings.numWolves),
      discussionDuration: Math.max(15, parseInt(settings.discussionDuration, 10) || this.settings.discussionDuration),
      voteDuration: Math.max(10, parseInt(settings.voteDuration, 10) || this.settings.voteDuration),
    };
    this.broadcastState();
  }

  startGame(token) {
    this._requireHost(token);
    if (this.phase !== 'lobby') return;
    const connected = [...this.players.values()].filter(p => p.connected);
    if (connected.length < 5) {
      throw new Error('Il faut au moins 5 joueurs pour lancer une partie.');
    }
    if (connected.some(p => !p.ready)) {
      throw new Error('Tous les joueurs doivent être prêts avant de lancer la partie.');
    }
    this._assignRoles();
    this._resetGameState();
    this._startNight();
  }

  _assignRoles() {
    const players = [...this.players.values()];
    const deck = shuffle(buildRoleDeck(players.length, this.settings));
    players.forEach((p, i) => {
      p.role = deck[i];
      p.alive = true;
      p.ready = false;
      p.potions = p.role === ROLES.SORCIERE.id ? { heal: true, poison: true } : null;
    });
  }

  // ---------------- Nuit ----------------

  _startNight() {
    this.phase = 'night';
    this.nightNumber += 1;
    this.wolfVotes = {};
    this.pendingWolfTarget = null;
    this.healUsedThisNight = false;
    this.poisonTargetThisNight = null;
    this.deathContext = 'night';
    this.nightSteps = this._computeNightSteps();
    this.nightStepIndex = 0;
    this._runCurrentNightStep();
    this.broadcastState();
  }

  _computeNightSteps() {
    const steps = [];
    if (this._alivePlayersWithRole(ROLES.VOYANTE.id).length > 0) steps.push('voyante');
    steps.push('loups');
    const sorciere = this._alivePlayersWithRole(ROLES.SORCIERE.id)[0];
    if (sorciere && (sorciere.potions.heal || sorciere.potions.poison)) steps.push('sorciere');
    return steps;
  }

  get currentNightStep() {
    return this.nightSteps[this.nightStepIndex] || null;
  }

  _runCurrentNightStep() {
    if (!this.currentNightStep) {
      this._resolveNight();
      return;
    }
    this._setTimer(NIGHT_STEP_TIMEOUT, () => this._finalizeNightStep());
  }

  // Appelé soit par timeout, soit dès que toutes les actions attendues sont reçues.
  _finalizeNightStep() {
    if (this.currentNightStep === 'loups' && !this.pendingWolfTarget) {
      this.pendingWolfTarget = this._majorityTarget(this.wolfVotes);
    }
    this._advanceNightStep();
  }

  _advanceNightStep() {
    this.nightStepIndex += 1;
    if (this.nightStepIndex >= this.nightSteps.length) {
      this._resolveNight();
    } else {
      this._runCurrentNightStep();
      this.broadcastState();
    }
  }

  submitVoyanteAction(token, targetToken) {
    const player = this._requirePlayer(token);
    if (this.phase !== 'night' || this.currentNightStep !== 'voyante') return;
    if (player.role !== ROLES.VOYANTE.id || !player.alive) return;
    const target = this.players.get(targetToken);
    if (!target) return;
    this._emitTo(player.socketId, 'voyante_result', {
      targetPseudo: target.pseudo,
      roleName: ROLES[target.role.toUpperCase()]?.name || target.role,
    });
    this._finalizeNightStep();
  }

  submitWolfVote(token, targetToken) {
    const player = this._requirePlayer(token);
    if (this.phase !== 'night' || this.currentNightStep !== 'loups') return;
    if (player.role !== ROLES.LOUP_GAROU.id || !player.alive) return;
    if (!this.players.get(targetToken)?.alive) return;
    this.wolfVotes[token] = targetToken;
    const aliveWolves = this._alivePlayersWithRole(ROLES.LOUP_GAROU.id);
    const allVoted = aliveWolves.every(w => this.wolfVotes[w.token]);
    this.broadcastState();
    if (allVoted) this._finalizeNightStep();
  }

  submitSorciereAction(token, { heal, poisonTargetToken } = {}) {
    const player = this._requirePlayer(token);
    if (this.phase !== 'night' || this.currentNightStep !== 'sorciere') return;
    if (player.role !== ROLES.SORCIERE.id || !player.alive) return;

    if (heal && player.potions.heal) {
      this.healUsedThisNight = true;
      player.potions.heal = false;
    } else if (poisonTargetToken && player.potions.poison && this.players.get(poisonTargetToken)?.alive) {
      this.poisonTargetThisNight = poisonTargetToken;
      player.potions.poison = false;
    }
    this._finalizeNightStep();
  }

  _resolveNight() {
    this._clearTimer();
    const deaths = [];
    if (this.pendingWolfTarget && !this.healUsedThisNight) deaths.push(this.pendingWolfTarget);
    if (this.poisonTargetThisNight) deaths.push(this.poisonTargetThisNight);

    const uniqueDeaths = [...new Set(deaths)];
    uniqueDeaths.forEach(token => {
      const p = this.players.get(token);
      if (p) p.alive = false;
    });
    this.lastNightDeaths = uniqueDeaths.map(token => this._describeDead(token));
    this._afterDeathsApplied(uniqueDeaths);
  }

  _describeDead(token) {
    const p = this.players.get(token);
    return { token, pseudo: p.pseudo, roleId: p.role, roleName: ROLES[p.role.toUpperCase()]?.name || p.role };
  }

  // ---------------- Jour / discussion / vote ----------------

  startDiscussion() {
    this.phase = 'discussion';
    this._setTimer(this.settings.discussionDuration * 1000, () => this.startVote());
    this.broadcastState();
  }

  startVote() {
    this.phase = 'vote';
    this.votes = {};
    this._setTimer(this.settings.voteDuration * 1000, () => this._resolveVote());
    this.broadcastState();
  }

  submitVote(token, targetToken) {
    const player = this._requirePlayer(token);
    if (this.phase !== 'vote' || !player.alive) return;
    if (!this.players.get(targetToken)?.alive) return;
    this.votes[token] = targetToken;
    const alivePlayers = [...this.players.values()].filter(p => p.alive);
    const allVoted = alivePlayers.every(p => this.votes[p.token]);
    this.broadcastState();
    if (allVoted) this._resolveVote();
  }

  _resolveVote() {
    this._clearTimer();
    const eliminatedToken = this._majorityTarget(this.votes, true);
    const tally = {};
    Object.values(this.votes).forEach(t => {
      const pseudo = this.players.get(t)?.pseudo || '?';
      tally[pseudo] = (tally[pseudo] || 0) + 1;
    });
    this.deathContext = 'vote';
    if (eliminatedToken) {
      this.players.get(eliminatedToken).alive = false;
      this.lastVoteResult = { eliminated: this._describeDead(eliminatedToken), tally, hunterVictim: null };
      this._afterDeathsApplied([eliminatedToken]);
    } else {
      this.lastVoteResult = { eliminated: null, tally, hunterVictim: null };
      this._afterDeathsApplied([]);
    }
  }

  // ---------------- Chasseur ----------------

  _afterDeathsApplied(deadTokens) {
    const newlyDeadHunters = deadTokens.filter(t => this.players.get(t)?.role === ROLES.CHASSEUR.id);
    this.hunterShotQueue.push(...newlyDeadHunters);
    this._advanceHunterQueueOrFinish();
  }

  _advanceHunterQueueOrFinish() {
    if (this.hunterShotQueue.length > 0) {
      this.pendingHunterShot = this.hunterShotQueue.shift();
      this.phase = 'hunter_shot';
      this._setTimer(HUNTER_SHOT_TIMEOUT, () => {
        this.pendingHunterShot = null;
        this._advanceHunterQueueOrFinish();
      });
      this.broadcastState();
    } else {
      this.pendingHunterShot = null;
      this._finishDeathSequence();
    }
  }

  submitHunterShot(token, targetToken) {
    if (this.phase !== 'hunter_shot' || token !== this.pendingHunterShot) return;
    const target = this.players.get(targetToken);
    if (target && target.alive) {
      target.alive = false;
      const info = this._describeDead(targetToken);
      if (this.deathContext === 'night') this.lastNightDeaths.push(info);
      else if (this.lastVoteResult) this.lastVoteResult.hunterVictim = info;
      if (target.role === ROLES.CHASSEUR.id) this.hunterShotQueue.push(targetToken);
    }
    this._clearTimer();
    this._advanceHunterQueueOrFinish();
  }

  _finishDeathSequence() {
    const winner = this._checkWinCondition();
    if (winner) {
      this.phase = 'ended';
      this.winner = winner;
    } else if (this.deathContext === 'night') {
      this.phase = 'day_reveal';
    } else {
      this.phase = 'vote_reveal';
    }
    this.broadcastState();
  }

  hostAdvance(token) {
    this._requireHost(token);
    if (this.phase === 'day_reveal') this.startDiscussion();
    else if (this.phase === 'vote_reveal') this._startNight();
  }

  requestReplay(token) {
    this._requireHost(token);
    if (this.phase !== 'ended') return;
    this.players.forEach(p => {
      p.ready = false;
      p.role = null;
      p.alive = true;
      p.potions = null;
    });
    this._resetGameState();
    this.phase = 'lobby';
    this.broadcastState();
  }

  // ---------------- Conditions de victoire ----------------

  _checkWinCondition() {
    const alive = [...this.players.values()].filter(p => p.alive);
    const wolves = alive.filter(p => p.role === ROLES.LOUP_GAROU.id);
    const villagers = alive.filter(p => p.role !== ROLES.LOUP_GAROU.id);
    if (wolves.length === 0) return 'village';
    if (wolves.length >= villagers.length) return 'loups';
    return null;
  }

  // ---------------- Utilitaires ----------------

  _majorityTarget(votesObj, allowTie = false) {
    const counts = {};
    Object.values(votesObj).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const entries = Object.entries(counts);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0][1];
    const tied = entries.filter(e => e[1] === top);
    if (tied.length > 1) {
      return allowTie ? null : tied[Math.floor(Math.random() * tied.length)][0];
    }
    return entries[0][0];
  }

  _alivePlayersWithRole(roleId) {
    return [...this.players.values()].filter(p => p.alive && p.role === roleId);
  }

  _requirePlayer(token) {
    const p = this.players.get(token);
    if (!p) throw new Error('Joueur introuvable dans ce salon.');
    return p;
  }

  _requireHost(token) {
    const p = this._requirePlayer(token);
    if (!p.isHost) throw new Error("Seul l'hôte peut faire cette action.");
    return p;
  }

  _emitTo(socketId, event, payload) {
    if (socketId) this.io.to(socketId).emit(event, payload);
  }

  // ---------------- Diffusion de l'état (vue personnalisée par joueur) ----------------

  broadcastState() {
    this.players.forEach(player => {
      if (!player.connected || !player.socketId) return;
      this.io.to(player.socketId).emit('state_update', this.getStateFor(player.token));
    });
  }

  getStateFor(token) {
    const you = this.players.get(token);
    const roleInfo = you?.role ? ROLES[you.role.toUpperCase()] : null;

    let pendingAction = null;
    if (you && you.alive) {
      if (this.phase === 'night') {
        if (this.currentNightStep === 'voyante' && you.role === ROLES.VOYANTE.id) pendingAction = 'voyante';
        else if (this.currentNightStep === 'loups' && you.role === ROLES.LOUP_GAROU.id && !this.wolfVotes[token]) pendingAction = 'loups';
        else if (this.currentNightStep === 'sorciere' && you.role === ROLES.SORCIERE.id) pendingAction = 'sorciere';
      } else if (this.phase === 'vote' && !this.votes[token]) {
        pendingAction = 'vote';
      } else if (this.phase === 'hunter_shot' && this.pendingHunterShot === token) {
        pendingAction = 'hunter_shot';
      }
    }

    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      timerEndsAt: this.timerEndsAt,
      pendingAction,
      players: [...this.players.values()].map(p => ({
        token: p.token,
        pseudo: p.pseudo,
        connected: p.connected,
        isHost: p.isHost,
        ready: p.ready,
        alive: p.alive,
        isYou: p.token === token,
        revealedRole: (this.phase === 'ended' || !p.alive) ? (ROLES[p.role?.toUpperCase()]?.name || null) : null,
      })),
      you: you ? {
        token: you.token,
        pseudo: you.pseudo,
        isHost: you.isHost,
        alive: you.alive,
        role: you.role,
        roleName: roleInfo?.name || null,
        roleEmoji: roleInfo?.emoji || null,
        roleDescription: roleInfo?.description || null,
        potions: you.potions,
      } : null,
      wolfTargetPseudo: (this.phase === 'night' && this.currentNightStep === 'sorciere' && you?.role === ROLES.SORCIERE.id)
        ? (this.players.get(this.pendingWolfTarget)?.pseudo || null)
        : null,
      lastNightDeaths: (this.phase === 'day_reveal' || this.phase === 'ended') ? this.lastNightDeaths : [],
      lastVoteResult: (this.phase === 'vote_reveal' || this.phase === 'ended') ? this.lastVoteResult : null,
      winner: this.winner,
    };
  }
}

module.exports = Room;
