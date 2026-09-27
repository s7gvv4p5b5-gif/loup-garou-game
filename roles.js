// roles.js
// Définition des rôles disponibles et logique de répartition automatique
// selon le nombre de joueurs. Ajouter un rôle plus tard = l'ajouter ici
// + ajouter sa logique d'action dans Room.js si besoin.

const TEAMS = {
  VILLAGE: 'village',
  LOUPS: 'loups',
};

const ROLES = {
  LOUP_GAROU: {
    id: 'loup_garou',
    name: 'Loup-Garou',
    emoji: '🐺',
    team: TEAMS.LOUPS,
    description: "Chaque nuit, choisis avec les autres loups une victime à dévorer.",
  },
  VILLAGEOIS: {
    id: 'villageois',
    name: 'Villageois',
    emoji: '👨',
    team: TEAMS.VILLAGE,
    description: "Pas de pouvoir particulier. Observe, débat et vote pour démasquer les loups.",
  },
  VOYANTE: {
    id: 'voyante',
    name: 'Voyante',
    emoji: '🔮',
    team: TEAMS.VILLAGE,
    description: "Chaque nuit, découvre en secret le rôle d'un joueur de ton choix.",
  },
  SORCIERE: {
    id: 'sorciere',
    name: 'Sorcière',
    emoji: '❤️',
    team: TEAMS.VILLAGE,
    description: "Une potion de vie et une potion de mort, chacune utilisable une seule fois dans la partie.",
  },
  CHASSEUR: {
    id: 'chasseur',
    name: 'Chasseur',
    emoji: '🏹',
    team: TEAMS.VILLAGE,
    description: "Si tu meurs, tu peux immédiatement emporter un autre joueur avec toi.",
  },
};

// Construit la liste des rôles à distribuer selon le nombre de joueurs et
// les options choisies par l'hôte. Le nombre de loups est automatiquement
// borné pour rester cohérent avec le nombre de joueurs.
function buildRoleDeck(playerCount, settings) {
  const deck = [];

  let numWolves = Math.max(1, Math.min(settings.numWolves, Math.floor(playerCount / 3) || 1));
  // Garde-fou : jamais autant (ou plus) de loups que de non-loups.
  const hardCap = Math.max(1, Math.ceil(playerCount / 2) - 1);
  numWolves = Math.max(1, Math.min(numWolves, hardCap));

  for (let i = 0; i < numWolves; i++) deck.push(ROLES.LOUP_GAROU.id);

  const remainingSlots = playerCount - numWolves;
  const specials = [];
  if (settings.includeVoyante && remainingSlots > specials.length) specials.push(ROLES.VOYANTE.id);
  if (settings.includeSorciere && remainingSlots > specials.length) specials.push(ROLES.SORCIERE.id);
  if (settings.includeChasseur && remainingSlots > specials.length) specials.push(ROLES.CHASSEUR.id);

  deck.push(...specials);

  while (deck.length < playerCount) deck.push(ROLES.VILLAGEOIS.id);

  return deck.slice(0, playerCount);
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { ROLES, TEAMS, buildRoleDeck, shuffle };
