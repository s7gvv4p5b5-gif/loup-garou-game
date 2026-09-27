# 🐺 Loup-Garou en ligne

Jeu multijoueur temps réel inspiré du Loup-Garou / Werewolf, jouable depuis
un navigateur (téléphone, tablette, ordinateur) sans rien installer.

## Sommaire

1. [Architecture](#architecture)
2. [Structure des fichiers](#structure-des-fichiers)
3. [Lancer en local](#lancer-en-local)
4. [Tester avec plusieurs téléphones](#tester-avec-plusieurs-téléphones)
5. [Déployer en production](#déployer-en-production)
6. [Limites actuelles & pistes d'évolution](#limites-actuelles--pistes-dévolution)

---

## Architecture

Pour rester simple à lancer et à déployer (une seule URL, un seul service),
le projet est volontairement **mono-service** :

- **Backend** : Node.js + Express + Socket.IO (`/server`). Toute la logique
  de jeu (rôles, nuit/jour/vote, conditions de victoire) vit **uniquement
  côté serveur**, dans `Room.js` — un joueur ne reçoit jamais que ce qu'il a
  le droit de voir. Impossible de tricher en inspectant le HTML/JS.
- **Frontend** : HTML/CSS/JS "vanilla" (`/client`), sans framework ni étape
  de build. Le serveur Express sert directement ces fichiers statiques.
- **Temps réel** : Socket.IO. Chaque changement d'état déclenche une
  diffusion personnalisée à chaque joueur (`Room.broadcastState`) — pas de
  rafraîchissement de page nécessaire.
- **Stockage** : en mémoire (une simple `Map` de salons). Pas de base de
  données pour ce MVP — largement suffisant pour jouer entre proches (voir
  les limites plus bas si tu veux industrialiser).

Un seul salon = un code à 4 lettres (ex. `ABCD`), partageable via un lien
du type `https://tondomaine.com/?join=ABCD`.

## Structure des fichiers

```
loup-garou-game/
├── server/
│   ├── package.json
│   ├── server.js        # Express + Socket.IO, sert le frontend + les events
│   ├── Room.js           # Moteur de jeu (lobby, nuit, vote, victoire...)
│   ├── roles.js           # Définition des rôles + répartition auto
│   └── test/
│       └── logic-smoke-test.js  # Test automatisé du moteur (sans réseau)
├── client/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── README.md
```

## Lancer en local

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
cd server
npm install
npm start
```

Le serveur écoute sur `http://localhost:3000` (le frontend est servi
automatiquement par ce même serveur — une seule commande suffit). Ouvre
cette adresse dans ton navigateur pour tester.

Tu peux vérifier que le moteur de jeu fonctionne correctement (sans avoir
besoin d'ouvrir plusieurs onglets) avec le test automatisé fourni :

```bash
node test/logic-smoke-test.js
```

Il simule une partie complète (distribution des rôles, nuits, votes,
victoire) et affiche `✅ Test de logique réussi.` si tout va bien.

## Tester avec plusieurs téléphones

**Sur le même Wi-Fi (le plus simple) :**

1. Lance le serveur (`npm start`) sur ton ordinateur.
2. Trouve l'adresse IP locale de ton ordinateur :
   - Mac/Linux : `ifconfig | grep inet`
   - Windows : `ipconfig` (regarde "Adresse IPv4")
   - Tu obtiens quelque chose comme `192.168.1.42`.
3. Sur chaque téléphone connecté au **même réseau Wi-Fi**, ouvre
   `http://192.168.1.42:3000` (remplace par ta propre IP).
4. Un joueur crée la partie, partage le code (ou le bouton "Copier le
   lien"), les autres rejoignent.

**Pour tester avec des proches qui ne sont pas sur ton Wi-Fi**, sans
déployer tout de suite, tu peux exposer temporairement ton serveur local
avec un tunnel :

```bash
npx localtunnel --port 3000
```

(ou `ngrok http 3000` si tu utilises [ngrok](https://ngrok.com)). Tu
obtiens une URL publique temporaire à partager.

## Déployer en production

Comme le projet est mono-service (un seul serveur Node sert tout), le
déploiement le plus simple consiste à héberger **le dossier `server/`**
(qui sert aussi `client/`) sur une plateforme qui exécute des applications
Node.js en continu — un simple hébergement de fichiers statiques ne
suffit pas ici, car il faut un processus qui garde les WebSockets ouverts.

Options recommandées (offres gratuites disponibles) :
[Render](https://render.com), [Railway](https://railway.app) ou
[Fly.io](https://fly.io).

**Exemple avec Render :**

1. Mets le projet sur GitHub (un simple `git init` + `git push` depuis la
   racine `loup-garou-game/`).
2. Sur Render : "New" → "Web Service" → connecte ton dépôt GitHub.
3. Renseigne :
   - **Root directory** : `server`
   - **Build command** : `npm install`
   - **Start command** : `npm start`
4. Render détecte automatiquement le port via la variable d'environnement
   `PORT` (déjà géré dans `server.js`).
5. Une fois déployé, tu obtiens une URL publique du type
   `https://ton-jeu.onrender.com` — c'est cette URL que tu partages à tes
   proches (le lien d'invitation `?join=CODE` fonctionnera directement
   dessus).

Comme le frontend est servi par ce même service Node, il n'y a **rien à
déployer séparément** : une seule URL pour tout le monde, joueurs sur
iPhone, Android ou ordinateur inclus.

**Pour que plusieurs personnes jouent simultanément :** aucune
configuration supplémentaire n'est nécessaire dans ce MVP. Chaque salon
est indépendant (identifié par son code), et un seul processus Node peut
gérer de nombreux salons en parallèle. Si un jour le nombre de joueurs
simultanés devient très important et que tu passes à plusieurs instances
du serveur, il faudra alors soit activer les "sticky sessions" (pour
qu'un même joueur reste connecté à la même instance), soit partager
l'état des salons via Redis (adaptateur `socket.io-redis`) — pas
nécessaire pour un usage entre amis.

## Limites actuelles & pistes d'évolution

Pour rester livrable rapidement, quelques simplifications ont été faites
volontairement :

- **Pas de base de données** : si le serveur redémarre, les parties en
  cours sont perdues (le lobby, lui, ne demande que quelques secondes à
  recréer). Ajouter Redis ou PostgreSQL permettrait de survivre à un
  redémarrage.
- **La Sorcière ne peut utiliser qu'un seul pouvoir par nuit** (soigner
  *ou* empoisonner, pas les deux) — une variante courante qui simplifie
  l'interface ; facile à assouplir dans `Room.js`
  (`submitSorciereAction`) si tu préfères la règle classique.
- **Pas de chat intégré** — pensé pour des groupes qui discutent déjà en
  vrai ou en vocal (WhatsApp, Discord...) pendant la partie.
- **Reconnexion basique** : un joueur qui perd sa connexion peut revenir
  (son pseudo et son rôle sont conservés), mais il n'y a pas encore de
  minuterie visible côté autres joueurs indiquant "en train de se
  reconnecter".

Pour ajouter un nouveau rôle : définis-le dans `roles.js`, ajoute sa
logique d'action dans `Room.js` (sur le modèle de la Voyante ou de la
Sorcière), puis son interface dans `app.js`
(`renderActionZone`). L'architecture a été pensée pour que ça reste
localisé à quelques endroits précis plutôt que dispersé partout.
