/* =============================================
   WWWWWW — Moteur de jeu
   Jeu de plateforme à inversion de gravité
   =============================================
   Architecture :
   - Les salles sont chargées depuis le tableau
     global SALLES[] (rempli par les fichiers
     salle_XXX_*.js)
   - Ce fichier gère : parsing des salles, physique,
     caméra, rendu, boss, musique et SFX
   - Mode SPA : le moteur expose window.demarrerJeu()
     et window.arreterJeu() pour démarrer/arrêter
     le jeu sans rechargement de page.
   ============================================= */

(function() {
'use strict';

// Flag pour éviter les doubles initialisations
let jeuActif = false;
let loopId = null;
let _callbackRetour = null;
let _callbackBossVaincu = null;
let _listenersActifs = [];

// =============================================
// CONSTANTES
// =============================================

const TILE = 24;   // Taille d'une tile en pixels
const LIGNES = 30; // Nombre de lignes par salle
const TP_COLORS = ['#f44','#4f4','#44f','#ff4','#f4f','#4ff','#fa4','#4fa','#a4f'];

const VITESSE_INVERSION = 1.5;      // Vélocité verticale après inversion de gravité
const BOOST_TAPIS_LENT = 1.5;       // Vitesse des tapis roulants lents
const BOOST_TAPIS_RAPIDE = 3.2;     // Vitesse des tapis roulants rapides
const BOSS_FACTEUR_HP_VITESSE = 0.06; // Facteur de vitesse par HP perdu
const BOSS_DECROISSANCE_VITESSE = 5.0 / 1000; // Décroissance du boost de vitesse par frame

// =============================================
// CANVAS
// =============================================

let canvas, ctx;

function resize() {
  if (!canvas) return;
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

// =============================================
// THÈMES (construits depuis les salles)
// =============================================

// Tableau des thèmes, rempli après chargement des salles
let THEMES = [];

// =============================================
// INPUT
// =============================================

const keys = {};
let flipBuf = 0;              // Buffer d'input pour l'inversion de gravité
const FLIP_BUFFER = 12;       // Durée du buffer en frames

let started = true;
let audioCtx = null, musiqueActive = false;
let musiqueInitialisee = false;

/** Arrête la musique du jeu et ferme le contexte audio */
function stopMusic() {
  musiqueActive = false;
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

/** Retour à la page d'accueil via callback SPA (pas de navigation) */
function retourAccueil() {
  if (window.arreterJeu) window.arreterJeu();
}

/** Sauvegarde la progression (monde débloqué) dans localStorage */
function sauverProgression(mondeFini) {
  const actuel = parseInt(localStorage.getItem('wwwwww_progression') || '1');
  if (mondeFini + 1 > actuel) {
    localStorage.setItem('wwwwww_progression', String(mondeFini + 1));
  }
}

// Le keydown principal est enregistré dans demarrerJeu() pour pouvoir être nettoyé
function _onKeydownPrincipal(e) {
  if (!jeuActif) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
  if (e.code === 'Escape') {
    retourAccueil();
    return;
  }
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    // Flèche haut : uniquement si gravité normale (vers le bas) → flip vers le haut
    // Flèche bas : uniquement si gravité inversée (vers le haut) → flip vers le bas
    // Espace : toujours autorisé
    if (e.code === 'Space'
      || (e.code === 'ArrowUp' && !joueur.inverse)
      || (e.code === 'ArrowDown' && joueur.inverse)) {
      flipBuf = FLIP_BUFFER;
    }
  }
  keys[e.code] = true;
}

function _onKeyup(e) { keys[e.code] = false; }

// =============================================
// ÉTAT DU JEU
// =============================================

let deaths = 0;
let time = 0;
let tremblement = 0;          // Intensité du screen shake
let flashMort = 0;            // Opacité du flash blanc de mort (1 → 0)
let clesEnPoche = 0;          // Nombre de clés en possession
let trinketsCollectes = 0;    // Nombre de trinkets ramassés
const TRINKETS_TOTAL = 20;    // Nombre total de trinkets dans le monde
const trinketsRamasses = new Set(); // Positions des trinkets déjà ramassés (survit au respawn)
let bossGemsCollectes = 0;        // Compteur de Boss Gems ramassées
let bossVaincuAffiche = false;     // Affichage "Boss Vaincu" (dismiss par touche)
let bossLoots = [];               // Loots flottants après la mort du boss

// --- Animation de l'écran "Boss Vaincu" ---
let bvTimer = 0;            // Timer global de l'animation (frames)
let bvPhase = 0;            // Phase : 0=titre, 1=trinkets, 2=gems, 3=morts, 4=message espace
let bvCompteur = 0;         // Valeur affichée du compteur en cours
let bvCibleCompteur = 0;    // Valeur cible du compteur en cours
let bvTickTimer = 0;        // Timer pour le rythme des ticks de comptage
let bvPhaseDelai = 0;       // Délai avant de commencer le comptage d'une phase

// Musique "Dernière Transmission" — jouée au ramassage de la Boss Gem
const MUSIQUE_DERNIERE_TRANSMISSION = {
  bpm: 135,
  mel:  ['C5','_','E5','_','G5','_','C6','_','B5','_','G5','_','F5','_','E5','_',
         'D5','_','F5','_','A5','_','G5','F5','E5','_','D5','_','C5','_','_','_'],
  mel2: ['C6','_','B5','G5','_','E5','G5','B5','C6','_','D6','_','C6','B5','G5','_',
         'A5','_','G5','F5','E5','_','D5','_','E5','G5','C6','_','B5','_','C6','_'],
  arp:  ['C4','E4','G4','C5','G4','E4','C4','E4','F3','A3','C4','F4','C4','A3','F3','A3',
         'G3','B3','D4','G4','D4','B3','G3','B3','A3','C4','E4','A4','E4','C4','A3','C4'],
  arp2: ['C4','G4','C5','G4','E4','G4','C4','G4','F3','C4','F4','C4','A3','C4','F3','C4',
         'G3','D4','G4','D4','B3','D4','G3','D4','A3','E4','A4','E4','C4','E4','A3','E4'],
  bas:  ['C2','_','C2','_','C3','_','C2','_','F1','_','F1','_','F2','_','F1','_',
         'G1','_','G1','_','G2','_','G1','_','A1','_','A1','_','A2','_','A1','_'],
  bas2: ['C2','C2','_','C2','C3','_','C2','G1','F1','F1','_','F1','F2','_','F1','C1',
         'G1','G1','_','G1','G2','_','G1','D1','A1','A1','_','A1','A2','_','A1','E1'],
  pad:  ['C3','E3','G3'],
  kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
  kick2:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0],
  snr:  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
  snr2: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,1,0,1,0],
  hh:   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
  hh2:  [1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0]
};
let coyote = 0;               // Frames de coyote time restantes
const COYOTE_FRAMES = 6;      // Durée du coyote time en frames
let gravLineCooldown = 0;     // Cooldown après traversée d'une ligne de gravité
const GRAV_LINE_CD = 15;      // Durée du cooldown en frames (~0.25s)
let particules = [];
const camera = { x: 0, y: 0 };
let salleIdx = 0;
let echelle = 1;              // Facteur d'échelle (viewport height / monde height)
let vueW = 0;                 // Largeur logique de la vue (en unités monde)

// Joueur
const joueur = {
  x: 0, y: 0, vx: 0, vy: 0,
  w: 16, h: 20,
  speed: 2.2,              // Vitesse horizontale
  gravite: 0.28,           // Accélération gravitationnelle par frame
  maxChute: 5,             // Vitesse de chute maximale
  inverse: false,          // true = gravité inversée (tombe vers le haut)
  auSol: false,            // true = au sol (ou au plafond si inverse)
  alive: true,
  spawnX: 0, spawnY: 0,    // Position de spawn initiale
  checkX: -1, checkY: -1,  // Position du dernier checkpoint activé
  trainee: [],             // Particules de traînée
  surPlateforme: null       // Référence à la plateforme mobile actuelle
};

// =============================================
// TILES
// =============================================

// Codes de tiles :
// 0=vide  1=mur  2=pic haut  3=pic bas
// 4=checkpoint  5=ligne de gravité(G)  6=tapis roulant rapide droite())
// 7=pic gauche  8=pic droit
// 9=tapis roulant lent droite(])  10=tapis roulant lent gauche([)
// 11=clé  12=porte  13=pic non résolu(!)  14=pic losange (volant)
// 15=tapis roulant rapide gauche(()  16=trinket  17=plateforme éphémère(@)

const TILE_CHARS = {
  '.': 0, ' ': 0, '#': 1, '!': 13,
  'C': 4, 'G': 5,
  ']': 9, '[': 10, ')': 6, '(': 15,
  'K': 11, 'P': 12, 'T': 16, '@': 17
};

// Types d'ennemis :
//   r = Rose (linéaire, vitesse constante)
//   R = Rose foncé (sinusoïde, vitesse constante)
//   v = Vert (linéaire, vitesse variable : accél./décél.)
//   V = Vert foncé (sinusoïde, vitesse variable : accél./décél.)
//
// Direction : placée du côté où l'ennemi se dirige
//   Droite : r>  (direction à droite du type)
//   Gauche : <r  (direction à gauche du type)
//   Haut   : ^   (au-dessus du type, sur la ligne précédente)
//            r
//   Bas    : r   (au-dessus du type, sur la ligne suivante)
//            v
//
// Note : 'v' est à la fois un type d'ennemi et la direction "bas".
// Le parser résout l'ambiguïté en 2 phases :
//   Phase 1 — paires horizontales (>, <) : prioritaires, non ambiguës
//   Phase 2 — paires verticales (^, v) : uniquement si non consommé en phase 1
// Ainsi v> = vert allant à droite (phase 1), mais R au-dessus d'un v isolé = rose foncé allant vers le bas (phase 2).
const ENEMY_TYPES = {
  'r': 'pink',
  'R': 'purple',
  'v': 'green',
  'V': 'dgreen'
};

// Variables du monde (initialisées par assemblerMonde)
let monde, MONDE_COLS, MONDE_W, MONDE_H;
let ennemis = [], plateformesMobiles = [], checkpoints = [];
let ephemeres = [];             // État des plateformes éphémères [{r, c, etat, timer}]
let teleporteurs = [];          // Paires de téléporteurs [{digit, ax, ay, bx, by, salle, cooldown}]
const TP_COOLDOWN = 20;         // Cooldown anti-rebond après téléportation (frames)
const EPH_DELAI = 36;          // Frames avant disparition (~0.6s)
const EPH_REAPPEAR = 180;      // Frames avant réapparition (~3s)
let offsetsSalles = [], nbSalles = 0;
let largeursSalles = [];       // Largeur (en colonnes) de chaque salle
let salleMin = 0, salleMax = 0; // Plage des salles actives (courante ± 1)
const FOG_TILES = 4;           // Largeur du brouillard progressif en tiles

/** Détermine l'index de salle à laquelle appartient une colonne globale */
function salleDeColonne(col) {
  for (let i = offsetsSalles.length - 1; i >= 0; i--) {
    if (col >= offsetsSalles[i]) return i;
  }
  return 0;
}

/** Convertit une couleur hex (#RGB ou #RRGGBB) en rgba avec alpha donné */
function bgAvecAlpha(hex, alpha) {
  let r, g, b;
  if (hex.length === 4) {
    // Format court #RGB → dupliquer chaque caractère
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

// =============================================
// BOSS
// =============================================

const boss = {
  active: false, defeated: false,
  x: 0, y: 0, w: 72, h: 72,
  hp: 0, maxHp: 5,
  inv: 0,                  // Frames d'invincibilité restantes après un hit
  timer: 0,                // Timer global du boss
  pat: 0,                  // Index du pattern d'attaque courant
  bx: 0, by: 0,            // Position de spawn du boss
  roomX: 0,                // Position X du début de la salle du boss (en pixels)
  roomW: 0,                // Largeur de la salle du boss (en pixels)
  bullets: [],              // Projectiles actifs
  beams: [],                // Faisceaux laser actifs (visuels)
  triggers: [],             // Boutons-lasers au sol/plafond
  state: 'idle',            // 'idle' (mouvement) ou 'prefire' (charge d'attaque)
  atkTimer: 0,              // Timer avant la prochaine attaque
  spdMul: 1,                // Multiplicateur de vitesse (boost temporaire après un hit)
  preTimer: 0,              // Compte à rebours de la phase de charge
  frozenX: 0, frozenY: 0,   // Position figée pendant la phase de charge
  frozenTimer: 0,            // Timer figé pendant la phase de charge (pour éviter la téléportation)
  targetX: 0, targetY: 0,   // Destination courante du boss (mouvement aléatoire)
  vxSmooth: 0, vySmooth: 0, // Vélocité lissée du boss (pour le steering)
  wanderAngle: 0,            // Angle de perturbation aléatoire (wander)
  gateCol: 0,                // Colonne monde de la porte d'entrée
  introTimer: 0,             // Timer d'animation à l'apparition (360 frames = 6s)
  shieldTimer: 0             // Invincibilité post-intro (360 frames = 6s, boss actif)
};

// =============================================
// PARSING DES SALLES
// =============================================

/**
 * Parse un tableau de strings (map) en données de salle.
 * Extrait les tiles, ennemis et checkpoints.
 */
function parserSalle(rows) {
  const w = rows[0].length;
  const tiles = Array.from({ length: LIGNES }, () => new Array(w).fill(0));
  const en = [], cp = [];

  // Positions consommées par les paires ennemi (type + direction)
  const consumed = new Set();

  /** Lecture sécurisée d'un caractère de la map */
  function ch(r, c) {
    return (r >= 0 && r < LIGNES && r < rows.length && c >= 0 && c < w && c < rows[r].length)
      ? rows[r][c] : '.';
  }

  // Phase 1 : paires horizontales (non ambiguës)
  // Droite : type puis >    Gauche : < puis type
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < w; c++) {
      const cur = ch(r, c);
      if (!ENEMY_TYPES[cur]) continue;

      const right = ch(r, c + 1);
      const left  = ch(r, c - 1);

      if (right === '>' && !consumed.has(`${r},${c + 1}`)) {
        en.push({ r, c, type: ENEMY_TYPES[cur], dir: 'r' });
        consumed.add(`${r},${c}`);
        consumed.add(`${r},${c + 1}`);
      } else if (left === '<' && !consumed.has(`${r},${c - 1}`)) {
        en.push({ r, c, type: ENEMY_TYPES[cur], dir: 'l' });
        consumed.add(`${r},${c}`);
        consumed.add(`${r},${c - 1}`);
      }
    }
  }

  // Phase 2 : paires verticales (uniquement pour les types non consommés en phase 1)
  // Haut : ^ au-dessus du type    Bas : v en-dessous du type
  // 'v' en-dessous n'est traité comme direction que s'il n'a pas été consommé en phase 1
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < w; c++) {
      if (consumed.has(`${r},${c}`)) continue;
      const cur = ch(r, c);
      if (!ENEMY_TYPES[cur]) continue;

      const above = ch(r - 1, c);
      const below = ch(r + 1, c);

      if (above === '^' && !consumed.has(`${r - 1},${c}`)) {
        en.push({ r, c, type: ENEMY_TYPES[cur], dir: 'u' });
        consumed.add(`${r},${c}`);
        consumed.add(`${r - 1},${c}`);
      } else if (below === 'v' && !consumed.has(`${r + 1},${c}`)) {
        en.push({ r, c, type: ENEMY_TYPES[cur], dir: 'd' });
        consumed.add(`${r},${c}`);
        consumed.add(`${r + 1},${c}`);
      }
    }
  }

  // Phase 2.5 : ennemis sans direction → mouvement circulaire
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < w; c++) {
      if (consumed.has(`${r},${c}`)) continue;
      const cur = ch(r, c);
      if (!ENEMY_TYPES[cur]) continue;
      en.push({ r, c, type: ENEMY_TYPES[cur], dir: 'circle' });
      consumed.add(`${r},${c}`);
    }
  }

  // Phase 2.7 : plateformes mobiles (=, ~) avec rails (|, -)
  const parsedPlats = [];
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < w; c++) {
      if (consumed.has(`${r},${c}`)) continue;
      const cur = ch(r, c);
      if (cur !== '=' && cur !== '~') continue;

      // Scanner la séquence horizontale consécutive de = ou ~
      const platChar = cur;
      let endC = c;
      while (endC < w && ch(r, endC) === platChar && !consumed.has(`${r},${endC}`)) endC++;
      const platW = endC - c;
      const platSpeed = platChar === '=' ? 0.8 : 1.6;

      // Consommer les tiles de la plateforme
      for (let cc = c; cc < endC; cc++) consumed.add(`${r},${cc}`);

      // Chercher des rails horizontaux (-) sur la même ligne
      let hLeft = c - 1, hRight = endC;
      while (hLeft >= 0 && ch(r, hLeft) === '-' && !consumed.has(`${r},${hLeft}`)) hLeft--;
      hLeft++;
      while (hRight < w && ch(r, hRight) === '-' && !consumed.has(`${r},${hRight}`)) hRight++;
      hRight--;
      const hasHRails = hLeft < c || hRight >= endC;

      if (hasHRails) {
        // Plateforme horizontale
        const borneGauche = Math.min(hLeft, c);
        const borneDroite = Math.max(hRight + 1, endC);
        // Consommer les rails -
        for (let cc = hLeft; cc <= hRight; cc++) {
          if (cc < c || cc >= endC) consumed.add(`${r},${cc}`);
        }
        parsedPlats.push({
          col: c, row: r, w: platW, speed: platSpeed, horizontal: true,
          startCol: borneGauche, endCol: borneDroite
        });
      } else {
        // Chercher des rails verticaux (|) au-dessus et en-dessous (à la 1ère colonne)
        let vTop = r - 1, vBot = r + 1;
        while (vTop >= 0 && ch(vTop, c) === '|' && !consumed.has(`${vTop},${c}`)) vTop--;
        vTop++;
        while (vBot < LIGNES && ch(vBot, c) === '|' && !consumed.has(`${vBot},${c}`)) vBot++;
        vBot--;
        const hasVRails = vTop < r || vBot > r;

        if (hasVRails) {
          // Plateforme verticale
          const borneHaute = Math.min(vTop, r);
          const borneBasse = Math.max(vBot, r);
          // Consommer les rails |
          for (let rr = vTop; rr <= vBot; rr++) {
            if (rr !== r) consumed.add(`${rr},${c}`);
          }
          parsedPlats.push({
            col: c, row: r, w: platW, speed: platSpeed, horizontal: false,
            startRow: borneHaute, endRow: borneBasse
          });
        }
        // Si aucun rail : plateforme ignorée (pas de mouvement)
      }
    }
  }

  // Phase 3 : parser les tiles et les téléporteurs (en ignorant les positions consommées)
  const tpBrut = {}; // Positions brutes des téléporteurs par chiffre : { '1': [{r,c}, ...], ... }
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < w; c++) {
      if (consumed.has(`${r},${c}`)) continue;
      const cur = ch(r, c);
      // Téléporteurs : chiffres 1-9
      if (cur >= '1' && cur <= '9') {
        if (!tpBrut[cur]) tpBrut[cur] = [];
        tpBrut[cur].push({ r, c });
      } else {
        tiles[r][c] = TILE_CHARS[cur] || 0;
        if (tiles[r][c] === 4) cp.push({ r, c });
      }
    }
  }
  // Ne garder que les paires exactes (exactement 2 positions par chiffre)
  const teleporteurs = [];
  for (const [digit, positions] of Object.entries(tpBrut)) {
    if (positions.length === 2) {
      teleporteurs.push({ digit, a: positions[0], b: positions[1] });
    }
  }

  return {
    tiles, w, en, cp, teleporteurs,
    plats: parsedPlats
  };
}

// =============================================
// CONSTRUCTION DU MONDE
// =============================================

/**
 * Assemble toutes les salles en un unique
 * tableau de tiles. Les salles se chevauchent d'une
 * colonne pour assurer la continuité.
 */
function assemblerMonde() {
  const salles = SALLES.map(defSalle => {
    if (defSalle.buildRoom) {
      // Salle générée procéduralement (boss)
      return defSalle.buildRoom(LIGNES);
    }
    return parserSalle(defSalle.map);
  });

  nbSalles = salles.length;
  largeursSalles = salles.map(s => s.w);

  // Calcul des offsets : chaque salle chevauche la précédente d'1 colonne
  let totalW = 0;
  offsetsSalles = [];
  for (let i = 0; i < salles.length; i++) {
    offsetsSalles.push(totalW);
    totalW += salles[i].w;
    if (i < salles.length - 1) totalW--; // chevauchement
  }

  // Allocation du monde complet
  const grille = [];
  for (let r = 0; r < LIGNES; r++) grille[r] = new Array(totalW).fill(0);

  const allEn = [], allCp = [], allPl = [];
  const allTp = []; // Téléporteurs (paires en coordonnées globales)

  // Fusion des salles
  for (let si = 0; si < salles.length; si++) {
    const s = salles[si], off = offsetsSalles[si];
    for (let r = 0; r < LIGNES; r++) {
      for (let c = 0; c < s.w; c++) {
        const dc = off + c;
        if (dc >= 0 && dc < totalW) {
          const tile = s.tiles[r][c];
          if (tile !== 0 || grille[r][dc] === 0) grille[r][dc] = tile;
        }
      }
    }
    for (const e of s.en) allEn.push({ r: e.r, c: e.c + off, type: e.type, dir: e.dir });
    for (const cp of s.cp) allCp.push({ r: cp.r, c: cp.c + off });
    for (const p of (s.plats || [])) {
      if (p.horizontal) {
        allPl.push({
          x: (p.col + off) * TILE, y: p.row * TILE, w: p.w * TILE, h: TILE,
          startX: (p.startCol + off) * TILE, endX: (p.endCol + off) * TILE,
          startY: 0, endY: 0,
          speed: p.speed, dir: 1, horizontal: true
        });
      } else {
        allPl.push({
          x: (p.col + off) * TILE, y: p.row * TILE, w: p.w * TILE, h: TILE,
          startY: p.startRow * TILE, endY: p.endRow * TILE,
          startX: 0, endX: 0,
          speed: p.speed, dir: 1, horizontal: false
        });
      }
    }
    for (const tp of (s.teleporteurs || [])) {
      allTp.push({
        digit: tp.digit,
        ax: (tp.a.c + off) * TILE, ay: tp.a.r * TILE,
        bx: (tp.b.c + off) * TILE, by: tp.b.r * TILE,
        salle: si, cooldown: 0
      });
    }
    if (s.bossInfo) {
      boss.roomX = (off + s.bossInfo.roomCol) * TILE;
      boss.roomW = (s.bossInfo.roomW || 100) * TILE;
      boss.bx = (off + s.bossInfo.bossCol) * TILE;
      boss.by = s.bossInfo.bossRow * TILE;
      boss.gateCol = off + (s.bossInfo.gateCol || 0); // Colonne monde de la porte d'entrée
      boss.triggers = s.bossInfo.triggers.map(tr => ({
        x: (off + tr.col) * TILE, y: tr.row * TILE, w: 2 * TILE, h: TILE,
        cooldown: 0, laserActive: 0, laserDir: tr.dir
      }));
    }
  }

  // Résolution des pics non résolus (code 13 → orientation selon mur adjacent)
  // Priorité : mur en dessous → pic vers le haut (2), mur au-dessus → pic vers le bas (3),
  // mur à gauche seul → pic vers la droite (8), mur à droite seul → pic vers la gauche (7),
  // ambiguïté latérale ou pas de mur → losange (14)
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < totalW; c++) {
      if (grille[r][c] !== 13) continue;
      // estSolide sauf éphémère (17) : les pics ne doivent pas pointer vers une éphémère
      const murPic = t => estSolide(t) && t !== 17;
      const below = (r + 1 < LIGNES) && murPic(grille[r + 1][c]);
      const above = (r - 1 >= 0) && murPic(grille[r - 1][c]);
      const left  = (c - 1 >= 0) && murPic(grille[r][c - 1]);
      const right = (c + 1 < totalW) && murPic(grille[r][c + 1]);

      if (below)            grille[r][c] = 2;  // pointe vers le haut
      else if (above)       grille[r][c] = 3;  // pointe vers le bas
      else if (left && !right)  grille[r][c] = 8;  // pointe vers la droite
      else if (right && !left)  grille[r][c] = 7;  // pointe vers la gauche
      else                  grille[r][c] = 14; // losange (pic volant)
    }
  }


  return { grille, totalW, allEn, allCp, allPl, allTp };
}

// =============================================
// INITIALISATION DU MONDE (appelée par demarrerJeu)
// =============================================

let mondeDonnees;

function _initialiserMonde() {
  THEMES = SALLES.map(l => l.theme);
  mondeDonnees = assemblerMonde();
  monde = mondeDonnees.grille;
  MONDE_COLS = mondeDonnees.totalW;
  MONDE_W = MONDE_COLS * TILE;
  MONDE_H = LIGNES * TILE;
}

// =============================================
// PARALLAXE — décors de fond multi-couches
// =============================================

// 3 couches : lointaine (étoiles), moyenne (formes), proche (structures)
let PARALLAXE_COUCHES = [
  { facteur: 0.05, opacite: 0.20, flou: 8 },   // Couche 0 : étoiles lointaines
  { facteur: 0.25, opacite: 0.10, flou: 4 },   // Couche 1 : formes géométriques
  { facteur: 0.50, opacite: 0.07, flou: 16 },  // Couche 2 : structures proches
];

// Visibilité des couches parallaxe (toggle avec I, O, P)
let parallaxeVisible = [true, true, true];
function _onKeydownParallaxe(e) {
  if (!jeuActif) return;
  if (e.code === 'KeyI') parallaxeVisible[0] = !parallaxeVisible[0];
  if (e.code === 'KeyO') parallaxeVisible[1] = !parallaxeVisible[1];
  if (e.code === 'KeyP') parallaxeVisible[2] = !parallaxeVisible[2];
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) */
function creeRNG(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Génère les éléments de décor parallaxe pour chaque salle et chaque couche */
let parallaxeElements = [];

function genererParallaxe() {
  parallaxeElements = [];
  for (let si = 0; si < nbSalles; si++) {
    const salleW = largeursSalles[si] * TILE;
    const salleX = offsetsSalles[si] * TILE;
    const couches = [];

    for (let ci = 0; ci < PARALLAXE_COUCHES.length; ci++) {
      const rng = creeRNG(si * 1000 + ci * 333 + 42);
      const elems = [];

      if (ci === 0) {
        // Couche lointaine : petits points (étoiles)
        const nb = 30 + Math.floor(rng() * 22);
        for (let i = 0; i < nb; i++) {
          elems.push({
            type: 'point',
            x: salleX + rng() * salleW,
            y: rng() * MONDE_H,
            taille: 2 + Math.floor(rng() * 3),
            scintille: rng() > 0.6,  // certaines étoiles scintillent
            phase: rng() * Math.PI * 2,
          });
        }
      } else if (ci === 1) {
        // Couche moyenne : tracés de circuit imprimé (lignes orthogonales + angles à 45°)
        const nbCircuits = 5 + Math.floor(rng() * 4);
        for (let i = 0; i < nbCircuits; i++) {
          const startX = salleX + rng() * salleW;
          const startY = rng() * MONDE_H;
          const segments = [];
          let cx = startX, cy = startY;
          const nbSegs = 3 + Math.floor(rng() * 5);
          for (let s = 0; s < nbSegs; s++) {
            const tirage = rng();
            let nx, ny;
            if (tirage < 0.35) {
              // Segment horizontal
              const longueur = (20 + rng() * 60) * (rng() > 0.5 ? 1 : -1);
              nx = cx + longueur; ny = cy;
            } else if (tirage < 0.7) {
              // Segment vertical
              const longueur = (20 + rng() * 60) * (rng() > 0.5 ? 1 : -1);
              nx = cx; ny = cy + longueur;
            } else {
              // Segment diagonal à 45° (style routage PCB)
              const longueur = (15 + rng() * 40) * (rng() > 0.5 ? 1 : -1);
              const dirY = rng() > 0.5 ? 1 : -1;
              nx = cx + longueur; ny = cy + longueur * dirY;
            }
            segments.push({ x0: cx, y0: cy, x1: nx, y1: ny });
            cx = nx; cy = ny;
          }
          elems.push({ type: 'circuit', segments });
        }
      } else {
        // Couche proche : silhouettes de structures (grands rectangles)
        const nb = 8 + Math.floor(rng() * 6);
        for (let i = 0; i < nb; i++) {
          const bw = 40 + rng() * 100;
          const bh = 60 + rng() * 200;
          elems.push({
            type: 'structure',
            x: salleX + rng() * salleW,
            y: MONDE_H - bh - rng() * 100,
            w: bw,
            h: bh,
          });
        }
      }
      couches.push(elems);
    }
    parallaxeElements.push(couches);
  }
}

/** Dessine toutes les couches parallaxe visibles */
function dessinerParallaxe(theme, camX) {
  for (let ci = 0; ci < PARALLAXE_COUCHES.length; ci++) {
    const couche = PARALLAXE_COUCHES[ci];
    if (!parallaxeVisible[ci]) continue;
    const opacite = couche.opacite;
    const flou = couche.flou;

    // Dessiner les éléments des salles actives ± 2
    for (let si = Math.max(0, salleIdx - 2); si <= Math.min(nbSalles - 1, salleIdx + 2); si++) {
      const elems = parallaxeElements[si]?.[ci];
      if (!elems) continue;

      // Décalage relatif au centre de la salle (évite la dérive sur les niveaux lointains)
      const salleCentreX = (offsetsSalles[si] + largeursSalles[si] / 2) * TILE;
      const decalage = (camX - salleCentreX) * (1 - couche.facteur);
      ctx.save();
      ctx.translate(decalage, 0);

      for (const e of elems) {
        if (e.type === 'point') {
          let a = opacite;
          if (e.scintille) a *= 0.5 + 0.5 * Math.sin(time * 0.03 + e.phase);
          // Halo flou : passes concentriques d'opacité décroissante
          for (let p = flou; p >= 0; p -= 2) {
            ctx.fillStyle = bgAvecAlpha(theme.acc, Math.max(0, a * (1 - p / flou) * 0.5));
            ctx.fillRect(e.x - p, e.y - p, e.taille + p * 2, e.taille + p * 2);
          }
          ctx.fillStyle = bgAvecAlpha(theme.acc, Math.max(0, a));
          ctx.fillRect(e.x, e.y, e.taille, e.taille);
        } else if (e.type === 'circuit') {
          // Tracé PCB : lignes fines sans flou, noeuds aux jonctions
          ctx.strokeStyle = bgAvecAlpha(theme.acc, opacite);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const seg of e.segments) {
            ctx.moveTo(seg.x0, seg.y0);
            ctx.lineTo(seg.x1, seg.y1);
          }
          ctx.stroke();
          // Noeuds aux jonctions (petits carrés)
          ctx.fillStyle = bgAvecAlpha(theme.acc, opacite * 1.5);
          for (const seg of e.segments) {
            ctx.fillRect(seg.x0 - 1.5, seg.y0 - 1.5, 3, 3);
          }
          // Noeud terminal
          const last = e.segments[e.segments.length - 1];
          ctx.fillRect(last.x1 - 1.5, last.y1 - 1.5, 3, 3);
        } else if (e.type === 'structure') {
          for (let p = flou; p >= 0; p -= 4) {
            ctx.fillStyle = bgAvecAlpha(theme.wall, opacite * 0.7 * (1 - p / flou) * 0.4);
            ctx.fillRect(e.x - p, e.y - p, e.w + p * 2, e.h + p * 2);
          }
        }
      }
      ctx.restore();
    }
  }
}

genererParallaxe();

// Couleurs par type d'ennemi
const ENEMY_COLORS = { pink: '#f0f', purple: '#a0f', green: '#0e0', dgreen: '#084' };

/** Initialise les ennemis depuis les données du monde */
function initEnnemis() {
  ennemis = [];
  for (const e of mondeDonnees.allEn) {
    const wx = e.c * TILE + TILE / 2, wy = e.r * TILE + TILE / 2;
    const isCircle = e.dir === 'circle';
    const isH = !isCircle && (e.dir === 'r' || e.dir === 'l');
    const sign = isCircle ? 1 : ((e.dir === 'r' || e.dir === 'd') ? 1 : -1);

    // Salle d'appartenance de l'ennemi
    const salle = salleDeColonne(e.c);
    const salleGauche = offsetsSalles[salle] * TILE;
    const salleDroite = (offsetsSalles[salle] + largeursSalles[salle] - 1) * TILE;

    // Calcul des bornes de patrouille (mur à mur, clampées aux frontières de salle)
    let minB = 0, maxB = 0;
    if (!isCircle) {
      // Les bornes minB/maxB représentent la zone de déplacement du coin haut-gauche de l'alien (16×16).
      // minB = position minimale (bord gauche/haut du mur + 1 tile)
      // maxB = position maximale (bord gauche/haut du mur suivant - taille alien)
      if (isH) {
        let mn = e.c - 1; while (mn >= 0 && !estSolide(monde[e.r][mn])) mn--;
        let mx = e.c + 1; while (mx <= MONDE_COLS - 1 && !estSolide(monde[e.r][mx])) mx++;
        minB = (mn >= 0 && estSolide(monde[e.r][mn])) ? (mn + 1) * TILE : 0;
        maxB = (mx <= MONDE_COLS - 1 && estSolide(monde[e.r][mx])) ? mx * TILE : MONDE_W;
        // Confinement dans la salle d'origine
        minB = Math.max(minB, salleGauche);
        maxB = Math.min(maxB, salleDroite);
      } else {
        let mn = e.r - 1; while (mn >= 0 && !estSolide(monde[mn][e.c])) mn--;
        let mx = e.r + 1; while (mx <= LIGNES - 1 && !estSolide(monde[mx][e.c])) mx++;
        minB = (mn >= 0 && estSolide(monde[mn][e.c])) ? (mn + 1) * TILE : 0;
        maxB = (mx <= LIGNES - 1 && estSolide(monde[mx][e.c])) ? mx * TILE : MONDE_H;
      }
    }

    ennemis.push({
      x: wx - 8, y: wy - 8, w: 16, h: 16,
      baseX: wx - 8, baseY: wy - 8,
      isH, isCircle, angle: 0,
      speed: ((e.type === 'pink' || e.type === 'purple') ? 0.85 : 2.4) * sign,
      minB, maxB,
      type: e.type || 'pink', timer: 0,
      color: ENEMY_COLORS[e.type] || '#f0f',
      salle
    });
  }
}

/** Initialise les plateformes mobiles */
function initPlateformes() {
  plateformesMobiles = mondeDonnees.allPl.map(p => ({
    ...p,
    pause: 0,
    salle: salleDeColonne(Math.floor(p.x / TILE))
  }));
}

// Initialisation des checkpoints (appelée dans _initialiserEntites)
function _initCheckpoints() {
  checkpoints = mondeDonnees.allCp.map(cp => ({ x: cp.c * TILE, y: cp.r * TILE, activated: false }));
}

// Initialisation des plateformes éphémères (scan du monde pour trouver les tiles 17)
// Positions originales des éphémères (ne change jamais, sert de référence pour le reset)
let ephemeresOriginales = null;

function initEphemeres() {
  // Premier appel : scanner le monde pour trouver toutes les positions éphémères
  if (!ephemeresOriginales) {
    ephemeresOriginales = [];
    for (let r = 0; r < LIGNES; r++) {
      for (let c = 0; c < MONDE_COLS; c++) {
        if (monde[r][c] === 17) ephemeresOriginales.push({ r, c });
      }
    }
  }
  // Restaurer toutes les tiles éphémères dans le monde et réinitialiser les états
  ephemeres = ephemeresOriginales.map(p => {
    monde[p.r][p.c] = 17; // Restaurer la tile (annule toute disparition en cours)
    return { r: p.r, c: p.c, etat: 'active', timer: 0 };
  });
}

/** Trouve le groupe contigu d'éphémères actives connectées à (startR, startC) via BFS */
function groupeEphemeres(startR, startC) {
  // Index rapide des éphémères actives par position
  const ephIdx = new Map();
  for (const e of ephemeres) if (e.etat === 'active') ephIdx.set(`${e.r},${e.c}`, e);

  const groupe = [];
  const visite = new Set();
  const file = [{ r: startR, c: startC }];
  visite.add(`${startR},${startC}`);

  while (file.length > 0) {
    const { r, c } = file.shift();
    const eph = ephIdx.get(`${r},${c}`);
    if (!eph) continue;
    groupe.push(eph);
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const clef = `${r + dr},${c + dc}`;
      if (!visite.has(clef)) {
        visite.add(clef);
        file.push({ r: r + dr, c: c + dc });
      }
    }
  }
  return groupe;
}

// Initialisation des téléporteurs (appelée dans _initialiserEntites)
function _initTeleporteurs() {
  teleporteurs = mondeDonnees.allTp.map(tp => ({ ...tp, cooldown: 0 }));
}

// =============================================
// GESTION DU JOUEUR
// =============================================

/**
 * Détermine la gravité correcte à une position donnée (en pixels).
 * Retourne true si la gravité doit être inversée (sol au-dessus).
 */
function graviteInverseeA(px, py) {
  const col = Math.floor(px / TILE);
  const row = Math.floor(py / TILE);
  const solEnDessous = row + 1 < LIGNES && estSolide(monde[row + 1][col]);
  const solAuDessus = row - 1 >= 0 && estSolide(monde[row - 1][col]);
  return !solEnDessous && solAuDessus;
}

function initJoueur() {
  // Spawn au premier checkpoint (le plus à gauche de la salle 1)
  const premierCp = checkpoints.reduce((best, cp) => (!best || cp.x < best.x) ? cp : best, null);
  joueur.x = premierCp.x + 4; joueur.y = premierCp.y;
  joueur.vx = 0; joueur.vy = 0;
  joueur.inverse = graviteInverseeA(premierCp.x, premierCp.y);
  joueur.auSol = false; joueur.alive = true;
  joueur.spawnX = joueur.x; joueur.spawnY = joueur.y;
  joueur.checkX = joueur.x; joueur.checkY = joueur.y;
  joueur.trainee = [];
  clesEnPoche = 0;
  premierCp.activated = true;

  // Reset du boss
  boss.active = false; boss.defeated = false;
  boss.hp = boss.maxHp; boss.bullets = []; boss.beams = [];
  boss.inv = 0; boss.timer = 0; boss.pat = 0;
  boss.state = 'idle'; boss.atkTimer = 0;
  boss.spdMul = 1; boss.preTimer = 0; boss.introTimer = 0; boss.shieldTimer = 0;
}

/** Respawn au dernier checkpoint activé */
function respawn() {
  deaths++;
  tremblement = 10;
  emettreParticules(joueur.x + joueur.w / 2, joueur.y + joueur.h / 2, '#f00', 20);
  joueur.x = joueur.checkX >= 0 ? joueur.checkX : joueur.spawnX;
  joueur.y = joueur.checkY >= 0 ? joueur.checkY : joueur.spawnY;
  joueur.vx = 0; joueur.vy = 0;
  joueur.inverse = graviteInverseeA(joueur.x, joueur.y);
  joueur.auSol = false; joueur.alive = true;
  joueur.trainee = [];
  flipBuf = 0; coyote = 0; gravLineCooldown = 0;
  initEnnemis(); initPlateformes(); initEphemeres();
  for (const tp of teleporteurs) tp.cooldown = 0;
  boss.bullets = []; boss.beams = []; bossLoots = [];
  if (boss.active && !boss.defeated) {
    boss.hp = boss.maxHp; // Full vie au respawn
    boss.timer = 0; boss.pat = [0, 2, 4][Math.floor(Math.random() * 3)];
    boss.state = 'idle'; boss.atkTimer = 0;
    boss.spdMul = 1; boss.preTimer = 0;
    boss.vxSmooth = 0; boss.vySmooth = 0;
    bossNouvelleDestination();
  }
}

/** Redémarrage complet (depuis le menu victoire) */
function recommencer() {
  deaths = 0;
  trinketsCollectes = 0; trinketsRamasses.clear();
  bossGemsCollectes = 0; bossVaincuAffiche = false; bossLoots = [];
  bvTimer = 0; bvPhase = 0; bvCompteur = 0; bvCibleCompteur = 0; bvTickTimer = 0; bvPhaseDelai = 0;
  for (const cp of checkpoints) cp.activated = false;
  const w2 = assemblerMonde();
  for (let r = 0; r < LIGNES; r++) {
    for (let c = 0; c < MONDE_COLS; c++) monde[r][c] = w2.grille[r][c];
  }
  teleporteurs = w2.allTp.map(tp => ({ ...tp, cooldown: 0 }));
  ephemeresOriginales = null; // Forcer le re-scan après reconstruction du monde
  initJoueur(); initEnnemis(); initPlateformes(); initEphemeres();
  genererParallaxe();
  flipBuf = 0; coyote = 0; gravLineCooldown = 0;
}

// =============================================
// PARTICULES
// =============================================

function emettreParticules(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    particules.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 25 + Math.random() * 15, ml: 40,
      color: col, sz: 2 + Math.random() * 3
    });
  }
}

// =============================================
// HELPERS DE TILES
// =============================================

/** Détruit une porte et toutes les portes adjacentes en cascade (BFS) avec animation */
function detruirePorteCascade(startC, startR) {
  const file = [{ c: startC, r: startR, delai: 0 }];
  const visite = new Set();
  visite.add(`${startR},${startC}`);

  while (file.length > 0) {
    const { c, r, delai } = file.shift();
    setTimeout(() => {
      monde[r][c] = 0;
      emettreParticules(c * TILE + TILE / 2, r * TILE + TILE / 2, '#f80', 8);
    }, delai * 80);

    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nr = r + dr, nc = c + dc;
      const clef = `${nr},${nc}`;
      if (nr >= 0 && nr < LIGNES && nc >= 0 && nc < MONDE_COLS
          && !visite.has(clef) && monde[nr][nc] === 12) {
        visite.add(clef);
        file.push({ c: nc, r: nr, delai: delai + 1 });
      }
    }
  }
}

/** Retourne le code de tile aux coordonnées pixel (px, py) */
function getTile(px, py) {
  const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
  if (r < 0 || r >= LIGNES || c < 0 || c >= MONDE_COLS) return 1;
  return monde[r][c];
}

/** true si la tile est solide (bloque le mouvement) */
function estSolide(t) { return t === 1 || t === 12 || t === 9 || t === 10 || t === 6 || t === 15 || t === 17; }

/** true si la tile est dangereuse (tue au contact) */
function estDangereux(t) { return t === 2 || t === 3 || t === 7 || t === 8 || t === 14; }

/** true si deux rectangles AABB se chevauchent */
function chevauche(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Détermine la salle courante du joueur */
function getSalleIdx() {
  for (let i = offsetsSalles.length - 1; i >= 0; i--) {
    if (joueur.x >= offsetsSalles[i] * TILE) return i;
  }
  return 0;
}

// =============================================
// HELPERS DE GAMEPLAY
// =============================================

/** Tue le joueur : flash, SFX et respawn après délai */
function tuerJoueur() {
  joueur.alive = false;
  flashMort = 1;
  sfx('death');
  setTimeout(respawn, 350);
}

/** Active l'écran de victoire du boss (stats, musique, progression) */
function activerEcranBossVaincu() {
  bossVaincuAffiche = true;
  bvTimer = 0; bvPhase = 0; bvCompteur = 0; bvCibleCompteur = 0; bvTickTimer = 0; bvPhaseDelai = 40;
  if (typeof MUSIC_DATA !== 'undefined' && MUSIC_DATA.length > salleIdx) {
    MUSIC_DATA[salleIdx] = MUSIQUE_DERNIERE_TRANSMISSION;
  }
  // Sauvegarder la progression : ce monde est terminé, débloquer le suivant
  if (typeof window.MONDE_COURANT === 'number') {
    sauverProgression(window.MONDE_COURANT + 1);
  }
}

/** Calcule la vitesse actuelle du boss (augmente avec les dégâts subis) */
function bossVitesseActuelle() {
  return 1.2 * (1 + (boss.maxHp - boss.hp) * BOSS_FACTEUR_HP_VITESSE) * boss.spdMul;
}

/** Dessine un trinket (losange cyan pulsant et tournant) au point (cx, cy) */
function dessinerTrinket(cx, cy) {
  const p = 0.5 + 0.5 * Math.sin(time * 0.08);
  const angle = time * 0.03;
  const sz = 7 + 2 * p;
  ctx.shadowColor = '#0ff'; ctx.shadowBlur = 15 * p;
  ctx.fillStyle = `rgba(0,255,255,${0.6 + 0.4 * p})`;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angle) * sz, cy + Math.sin(angle) * sz);
  ctx.lineTo(cx + Math.cos(angle + Math.PI / 2) * sz, cy + Math.sin(angle + Math.PI / 2) * sz);
  ctx.lineTo(cx + Math.cos(angle + Math.PI) * sz, cy + Math.sin(angle + Math.PI) * sz);
  ctx.lineTo(cx + Math.cos(angle + 3 * Math.PI / 2) * sz, cy + Math.sin(angle + 3 * Math.PI / 2) * sz);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// =============================================
// MISE À JOUR (UPDATE)
// =============================================

function update() {
  if (!started) return;
  if (bossVaincuAffiche) return;
  time++;
  if (!joueur.alive) return;

  salleIdx = getSalleIdx();
  salleMin = Math.max(0, salleIdx - 1);
  salleMax = Math.min(nbSalles - 1, salleIdx + 1);

  // --- Inversion de gravité (avec buffer d'input + coyote time) ---
  if (joueur.auSol) coyote = COYOTE_FRAMES;
  else if (coyote > 0) coyote--;

  if (flipBuf > 0 && (joueur.auSol || coyote > 0)) {
    joueur.inverse = !joueur.inverse;
    joueur.auSol = false; coyote = 0; flipBuf = 0;
    joueur.vy = joueur.inverse ? -VITESSE_INVERSION : VITESSE_INVERSION;
    emettreParticules(joueur.x + joueur.w / 2, joueur.y + joueur.h / 2, THEMES[salleIdx].acc, 6);
    sfx('flip');
  } else if (flipBuf > 0) {
    flipBuf--;
  }

  // --- Mouvement horizontal ---
  joueur.vx = 0;
  if (keys.ArrowLeft || keys.KeyA || keys.KeyQ) joueur.vx = -joueur.speed;
  if (keys.ArrowRight || keys.KeyD) joueur.vx = joueur.speed;

  // Effet des tapis roulants (vérifie bord gauche ET bord droit du joueur)
  if (joueur.auSol) {
    const fy = joueur.inverse ? joueur.y - 1 : joueur.y + joueur.h + 1;
    const ftG = getTile(joueur.x, fy);
    const ftD = getTile(joueur.x + joueur.w - 1, fy);
    // Le tapis s'applique si au moins un bord du joueur est au-dessus d'un tapis
    const ft = (ftG === 9 || ftG === 10 || ftG === 6 || ftG === 15) ? ftG : ftD;
    if (ft === 9) joueur.vx += BOOST_TAPIS_LENT;    // Tapis roulant lent droite
    if (ft === 10) joueur.vx -= BOOST_TAPIS_LENT;  // Tapis roulant lent gauche
    if (ft === 6) joueur.vx += BOOST_TAPIS_RAPIDE;   // Tapis roulant rapide droite
    if (ft === 15) joueur.vx -= BOOST_TAPIS_RAPIDE;  // Tapis roulant rapide gauche
  }

  // --- Gravité (pas appliquée si au sol) ---
  const gD = joueur.inverse ? -1 : 1;
  if (!joueur.auSol) {
    joueur.vy += joueur.gravite * gD;
    if (Math.abs(joueur.vy) > joueur.maxChute) joueur.vy = joueur.maxChute * gD;
  }

  // --- Collision horizontale ---
  joueur.x += joueur.vx;
  let porteOuverteCeFrame = false;
  for (const pt of [
    { x: joueur.x, y: joueur.y + 1 }, { x: joueur.x + joueur.w - 1, y: joueur.y + 1 },
    { x: joueur.x, y: joueur.y + joueur.h - 2 }, { x: joueur.x + joueur.w - 1, y: joueur.y + joueur.h - 2 }
  ]) {
    const t = getTile(pt.x, pt.y);
    // Ouverture de porte si le joueur a une clé (une seule par frame)
    if (t === 12 && clesEnPoche > 0 && !porteOuverteCeFrame) {
      const dc = Math.floor(pt.x / TILE), dr = Math.floor(pt.y / TILE);
      detruirePorteCascade(dc, dr);
      clesEnPoche--;
      porteOuverteCeFrame = true;
      sfx('door');
      // Franchissement de la porte du boss avec la gem → message + musique
      if (boss.defeated && bossGemsCollectes > 0 && !bossVaincuAffiche) {
        activerEcranBossVaincu();
      }
      continue;
    }
    if (estSolide(t)) {
      if (joueur.vx > 0) joueur.x = Math.floor(pt.x / TILE) * TILE - joueur.w;
      else if (joueur.vx < 0) joueur.x = Math.floor(pt.x / TILE) * TILE + TILE;
      joueur.vx = 0;
      break;
    }
  }

  // --- Collision verticale ---
  joueur.y += joueur.vy;
  // Ne pas perdre le statut auSol si le joueur ne bouge pas verticalement
  if (joueur.vy !== 0) joueur.auSol = false;
  for (const pt of [
    { x: joueur.x + 2, y: joueur.y }, { x: joueur.x + joueur.w - 3, y: joueur.y },
    { x: joueur.x + 2, y: joueur.y + joueur.h - 1 }, { x: joueur.x + joueur.w - 3, y: joueur.y + joueur.h - 1 }
  ]) {
    const t = getTile(pt.x, pt.y);
    // Ouverture de porte au sol/plafond si le joueur a une clé (une seule par frame)
    if (t === 12 && clesEnPoche > 0 && !porteOuverteCeFrame) {
      const dc = Math.floor(pt.x / TILE), dr = Math.floor(pt.y / TILE);
      detruirePorteCascade(dc, dr);
      clesEnPoche--;
      porteOuverteCeFrame = true;
      sfx('door');
      if (boss.defeated && bossGemsCollectes > 0 && !bossVaincuAffiche) {
        activerEcranBossVaincu();
      }
      continue;
    }
    if (estSolide(t)) {
      if (joueur.vy > 0) {
        joueur.y = Math.floor(pt.y / TILE) * TILE - joueur.h;
        joueur.auSol = !joueur.inverse;
      } else if (joueur.vy < 0) {
        joueur.y = Math.floor(pt.y / TILE) * TILE + TILE;
        joueur.auSol = joueur.inverse;
      }
      joueur.vy = 0;
      break;
    }
  }

  // --- Plateformes mobiles (seulement dans les salles actives) ---
  joueur.surPlateforme = null;
  for (const pl of plateformesMobiles) {
    if (pl.salle < salleMin || pl.salle > salleMax) continue;
    const ox = pl.x, oy = pl.y;

    // Pause en bout de course
    if (pl.pause > 0) { pl.pause--; }
    else if (pl.horizontal) {
      pl.x += pl.speed * pl.dir;
      if (pl.x < pl.startX || pl.x + pl.w > pl.endX) { pl.dir *= -1; pl.pause = 30; }
    } else {
      pl.y += pl.speed * pl.dir;
      if (pl.y < pl.startY || pl.y > pl.endY) { pl.dir *= -1; pl.pause = 30; }
    }
    const dx = pl.x - ox, dy = pl.y - oy;

    if (joueur.x + joueur.w > pl.x && joueur.x < pl.x + pl.w) {
      // Gravité normale : atterrir sur le dessus de la plateforme
      if (!joueur.inverse && joueur.vy >= 0 && joueur.y + joueur.h >= pl.y && joueur.y + joueur.h <= pl.y + 10) {
        joueur.y = pl.y - joueur.h; joueur.vy = 0; joueur.auSol = true;
        joueur.x += dx; joueur.y += dy;
        joueur.surPlateforme = pl;
      }
      // Gravité inversée : atterrir sous la plateforme
      else if (joueur.inverse && joueur.vy <= 0 && joueur.y <= pl.y + pl.h && joueur.y >= pl.y + pl.h - 10) {
        joueur.y = pl.y + pl.h; joueur.vy = 0; joueur.auSol = true;
        joueur.x += dx; joueur.y += dy;
        joueur.surPlateforme = pl;
      }
    }
  }

  // --- Vérification support plateforme mobile ---
  // Si le joueur était sur une plateforme mobile au frame précédent mais n'est plus dessus,
  // et qu'il n'est pas non plus sur du sol solide, il doit tomber.
  if (joueur.auSol && !joueur.surPlateforme) {
    const probeY2 = joueur.inverse ? joueur.y - 1 : joueur.y + joueur.h;
    const sol2G = estSolide(getTile(joueur.x + 2, probeY2));
    const sol2D = estSolide(getTile(joueur.x + joueur.w - 3, probeY2));
    if (!sol2G && !sol2D) {
      joueur.auSol = false;
    }
  }

  // --- Détection de danger (pics) ---
  const m = 3; // Marge de tolérance (hitbox rétrécie de 3px)
  for (const pt of [
    { x: joueur.x + m, y: joueur.y + m }, { x: joueur.x + joueur.w - m - 1, y: joueur.y + m },
    { x: joueur.x + m, y: joueur.y + joueur.h - m - 1 }, { x: joueur.x + joueur.w - m - 1, y: joueur.y + joueur.h - m - 1 },
    { x: joueur.x + joueur.w / 2, y: joueur.y + 1 }, { x: joueur.x + joueur.w / 2, y: joueur.y + joueur.h - 2 }
  ]) {
    if (estDangereux(getTile(pt.x, pt.y))) {
      tuerJoueur();
      return;
    }
  }

  mettreAJourCollectibles();
  if (!joueur.alive) return; // tuerJoueur() appelé par mettreAJourEnnemis()
  mettreAJourEnnemis();
  if (!joueur.alive) return;
  mettreAJourParticules();
}

// =============================================
// SOUS-FONCTIONS DE UPDATE
// =============================================

/** Met à jour les lignes de gravité, éphémères, téléporteurs, clés, trinkets et checkpoints */
function mettreAJourCollectibles() {
  // --- Lignes de gravité ---
  if (gravLineCooldown > 0) {
    gravLineCooldown--;
  } else {
    const glc = Math.floor((joueur.x + joueur.w / 2) / TILE);
    const glr = Math.floor((joueur.y + joueur.h / 2) / TILE);
    if (glr >= 0 && glr < LIGNES && glc >= 0 && glc < MONDE_COLS && monde[glr][glc] === 5) {
      joueur.inverse = !joueur.inverse;
      joueur.vy = joueur.inverse ? -VITESSE_INVERSION : VITESSE_INVERSION;
      gravLineCooldown = GRAV_LINE_CD;
      emettreParticules(joueur.x + joueur.w / 2, joueur.y + joueur.h / 2, '#fff', 8);
      sfx('flip');
    }
  }

  // --- Plateformes éphémères ---
  if (joueur.auSol) {
    const ephProbeY = joueur.inverse ? joueur.y - 1 : joueur.y + joueur.h + 1;
    for (const px2 of [joueur.x + 2, joueur.x + joueur.w - 3]) {
      const ec = Math.floor(px2 / TILE), er = Math.floor(ephProbeY / TILE);
      if (er >= 0 && er < LIGNES && ec >= 0 && ec < MONDE_COLS && monde[er][ec] === 17) {
        const eph = ephemeres.find(e => e.r === er && e.c === ec && e.etat === 'active');
        if (eph) {
          const groupe = groupeEphemeres(eph.r, eph.c);
          for (const g of groupe) {
            g.etat = 'disparition';
            g.timer = EPH_DELAI;
          }
          break;
        }
      }
    }
  }
  for (const eph of ephemeres) {
    if (eph.etat === 'disparition') {
      eph.timer--;
      if (eph.timer <= 0) {
        eph.etat = 'disparue';
        eph.timer = EPH_REAPPEAR;
        monde[eph.r][eph.c] = 0;
        emettreParticules(eph.c * TILE + TILE / 2, eph.r * TILE + TILE / 2, '#88f', 6);
        sfx('ephDestroy');
      }
    } else if (eph.etat === 'disparue') {
      eph.timer--;
      if (eph.timer <= 0) {
        eph.etat = 'active';
        monde[eph.r][eph.c] = 17;
      }
    }
  }

  // --- Téléporteurs ---
  for (const tp of teleporteurs) {
    if (tp.cooldown > 0) { tp.cooldown--; continue; }
    const pcxT = joueur.x + joueur.w / 2, pcyT = joueur.y + joueur.h / 2;
    const surA = pcxT >= tp.ax && pcxT < tp.ax + TILE && pcyT >= tp.ay && pcyT < tp.ay + TILE;
    const surB = pcxT >= tp.bx && pcxT < tp.bx + TILE && pcyT >= tp.by && pcyT < tp.by + TILE;
    if (surA || surB) {
      const destX = surA ? tp.bx : tp.ax;
      const destY = surA ? tp.by : tp.ay;
      joueur.x = destX + (joueur.x - (surA ? tp.ax : tp.bx));
      joueur.y = destY + (joueur.y - (surA ? tp.ay : tp.by));
      tp.cooldown = TP_COOLDOWN;
      emettreParticules(pcxT, pcyT, '#fff', 8);
      emettreParticules(destX + TILE / 2, destY + TILE / 2, '#fff', 8);
      sfx('teleport');
      break;
    }
  }

  // --- Ramassage de clé ---
  const pcx = joueur.x + joueur.w / 2, pcy = joueur.y + joueur.h / 2;
  const kc = Math.floor(pcx / TILE), kr = Math.floor(pcy / TILE);
  if (kr >= 0 && kr < LIGNES && kc >= 0 && kc < MONDE_COLS && monde[kr][kc] === 11) {
    monde[kr][kc] = 0;
    clesEnPoche++;
    emettreParticules(kc * TILE + TILE / 2, kr * TILE + TILE / 2, '#ff0', 15);
    sfx('key');
  }

  // --- Ramassage de trinket ---
  if (kr >= 0 && kr < LIGNES && kc >= 0 && kc < MONDE_COLS && monde[kr][kc] === 16) {
    const clefPos = `${kr},${kc}`;
    if (!trinketsRamasses.has(clefPos)) {
      trinketsRamasses.add(clefPos);
      trinketsCollectes++;
    }
    monde[kr][kc] = 0;
    emettreParticules(kc * TILE + TILE / 2, kr * TILE + TILE / 2, '#0ff', 20);
    sfx('trinket');
  }

  // --- Activation de checkpoint ---
  for (const cp of checkpoints) {
    if (!cp.activated && pcx > cp.x && pcx < cp.x + TILE && pcy > cp.y && pcy < cp.y + TILE) {
      cp.activated = true;
      joueur.checkX = cp.x + (TILE - joueur.w) / 2; joueur.checkY = cp.y;
      emettreParticules(cp.x + TILE / 2, cp.y + TILE / 2, '#0f0', 12);
      sfx('checkpoint');
    }
  }
}

/** Met à jour les ennemis, le boss et ses loots */
function mettreAJourEnnemis() {
  for (const e of ennemis) {
    if (e.salle < salleMin || e.salle > salleMax) continue;
    e.timer++;
    let ms = Math.abs(e.speed);

    // Vert / Vert-foncé : vitesse oscillante
    if (e.type === 'green' || e.type === 'dgreen') {
      ms *= 0.08 + 0.92 * Math.abs(Math.sin(e.timer * 0.025));
    }

    const dir = Math.sign(e.speed);
    if (e.isCircle) {
      const rayonMax = 4 * TILE - e.w / 2;
      e.angle += ms * 0.012;
      const sinOsc = (e.type === 'purple' || e.type === 'dgreen')
        ? 25 * (0.5 + 0.5 * Math.sin(e.timer * 0.04))
        : 0;
      const rayon = rayonMax - sinOsc;
      e.x = e.baseX + Math.cos(e.angle) * rayon;
      e.y = e.baseY + Math.sin(e.angle) * rayon;
    } else if (e.isH) {
      e.x += ms * dir;
      if (e.type === 'purple' || e.type === 'dgreen') {
        e.y = e.baseY + Math.sin(e.timer * 0.04) * 25;
      }
      if (e.x <= e.minB || e.x + e.w >= e.maxB) {
        e.speed *= -1;
        e.x = Math.max(e.minB, Math.min(e.x, e.maxB - e.w));
      }
    } else {
      e.y += ms * dir;
      if (e.type === 'purple' || e.type === 'dgreen') {
        e.x = e.baseX + Math.sin(e.timer * 0.04) * 25;
      }
      if (e.y <= e.minB || e.y + e.h >= e.maxB) {
        e.speed *= -1;
        e.y = Math.max(e.minB, Math.min(e.y, e.maxB - e.h));
      }
    }

    if (chevauche(joueur, e)) {
      tuerJoueur();
      return;
    }
  }

  updateBoss();

  // --- Loots du boss (physique + ramassage) ---
  for (let i = bossLoots.length - 1; i >= 0; i--) {
    const l = bossLoots[i];
    if (!l.grounded) {
      l.vy += 0.15 * Math.sign(l.vy || 1);
      l.x += l.vx; l.y += l.vy;
      if (l.y > 27 * TILE) { l.y = 27 * TILE; l.grounded = true; l.vx = 0; l.vy = 0; }
      if (l.y < 2 * TILE) { l.y = 2 * TILE; l.grounded = true; l.vx = 0; l.vy = 0; }
    }
    if (chevauche(joueur, { x: l.x - 8, y: l.y - 8, w: 16, h: 16 })) {
      if (l.type === 'trinket') {
        trinketsCollectes++;
        sfx('trinket');
        emettreParticules(l.x, l.y, '#0ff', 15);
      } else if (l.type === 'key') {
        clesEnPoche++;
        sfx('key');
        emettreParticules(l.x, l.y, '#ff0', 15);
      } else if (l.type === 'gem') {
        bossGemsCollectes++;
        sfx('bossGem');
        emettreParticules(l.x, l.y, '#f0f', 30);
        emettreParticules(l.x, l.y, '#ff0', 30);
      }
      bossLoots.splice(i, 1);
    }
  }
}

/** Met à jour la traînée du joueur, les particules et le tremblement */
function mettreAJourParticules() {
  const pcx = joueur.x + joueur.w / 2, pcy = joueur.y + joueur.h / 2;
  if (time % 3 === 0) joueur.trainee.push({ x: pcx, y: pcy, life: 12 });
  joueur.trainee = joueur.trainee.filter(t => { t.life--; return t.life > 0; });
  particules = particules.filter(p => {
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.95; p.vy *= 0.95;
    p.life--;
    return p.life > 0;
  });
  if (tremblement > 0) tremblement--;
}

// =============================================
// BOSS — MISE À JOUR
// =============================================

/** Choisit une destination aléatoire dans la zone jouable de la salle du boss */
function bossNouvelleDestination() {
  const margeX = 4 * TILE;
  const minY = 2 * TILE + 2 * TILE;               // Plafond + marge de passage
  const maxY = 28 * TILE - boss.h - 2 * TILE;      // Sol - boss - marge de passage
  boss.targetX = boss.roomX + margeX + Math.random() * (boss.roomW - 2 * margeX - boss.w);
  boss.targetY = minY + Math.random() * (maxY - minY);
}

function updateBoss() {
  // Activation du boss quand le joueur entre dans la salle
  if (!boss.active && !boss.defeated && boss.roomX > 0 && joueur.x > boss.roomX + 3 * TILE) {
    boss.active = true;
    boss.hp = boss.maxHp;
    boss.x = boss.bx; boss.y = boss.by;
    boss.timer = 0; boss.pat = [0, 2, 4][Math.floor(Math.random() * 3)]; // Pattern initial aléatoire
    boss.bullets = []; boss.beams = []; boss.inv = 0;
    boss.state = 'intro'; boss.atkTimer = 0;
    boss.introTimer = 360; // 6 secondes d'invincibilité à l'apparition (60fps × 6)
    boss.spdMul = 1; boss.preTimer = 0;
    boss.vxSmooth = 0; boss.vySmooth = 0;
    // Fermer la porte d'entrée (mur solide sur toute la hauteur de la colonne)
    if (boss.gateCol > 0) {
      for (let r = 2; r < 28; r++) monde[r][boss.gateCol] = 1;
    }
    sfx('bossAlarm');
  }
  if (!boss.active || boss.defeated) return;

  boss.timer++;

  // Phase d'intro : le boss est invincible et immobile pendant 6 secondes
  if (boss.state === 'intro') {
    boss.introTimer--;
    if (boss.introTimer <= 0) {
      boss.state = 'idle';
      boss.atkTimer = 0;
      boss.shieldTimer = 360; // 6s d'invincibilité post-intro (boss actif)
      bossNouvelleDestination();
    }
    return; // Pas de mouvement ni d'attaque pendant l'intro
  }

  // Décompte du bouclier post-intro
  if (boss.shieldTimer > 0) boss.shieldTimer--;

  // Décroissance du boost de vitesse (retour à 1x en ~1000 frames)
  if (boss.spdMul > 1) boss.spdMul = Math.max(1, boss.spdMul - BOSS_DECROISSANCE_VITESSE);

  const ph = boss.maxHp - boss.hp; // Points de vie perdus
  const bspd = 1 + ph * BOSS_FACTEUR_HP_VITESSE;

  if (boss.state === 'idle') {
    // Mouvement fluide vers une destination avec steering + wander
    const dx = boss.targetX - boss.x, dy = boss.targetY - boss.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spd = 1.2 * bspd * boss.spdMul;

    if (dist < spd * 3) {
      bossNouvelleDestination();
    } else {
      // Direction souhaitée vers la cible
      const desiredVx = (dx / dist) * spd;
      const desiredVy = (dy / dist) * spd;

      // Perturbation aléatoire (wander) — dévie légèrement la trajectoire
      boss.wanderAngle += (Math.random() - 0.5) * 0.3;
      const wanderForce = spd * 0.25;
      const wx = Math.cos(boss.wanderAngle) * wanderForce;
      const wy = Math.sin(boss.wanderAngle) * wanderForce;

      // Interpolation douce (steering) : la vélocité converge vers la direction souhaitée
      const steer = 0.04;
      boss.vxSmooth += ((desiredVx + wx) - boss.vxSmooth) * steer;
      boss.vySmooth += ((desiredVy + wy) - boss.vySmooth) * steer;

      // Limiter la vitesse résultante
      const v = Math.sqrt(boss.vxSmooth * boss.vxSmooth + boss.vySmooth * boss.vySmooth);
      if (v > spd) {
        boss.vxSmooth = (boss.vxSmooth / v) * spd;
        boss.vySmooth = (boss.vySmooth / v) * spd;
      }

      boss.x += boss.vxSmooth;
      boss.y += boss.vySmooth;
    }

    // Clamp vertical — garder un passage pour le joueur (2 tiles min entre boss et sol/plafond)
    const bossMinY = 2 * TILE + 2 * TILE;          // Plafond (2 tiles) + marge de passage
    const bossMaxY = 28 * TILE - boss.h - 2 * TILE; // Sol (ligne 28) - boss - marge de passage
    if (boss.y < bossMinY) { boss.y = bossMinY; boss.vySmooth = Math.abs(boss.vySmooth); }
    if (boss.y > bossMaxY) { boss.y = bossMaxY; boss.vySmooth = -Math.abs(boss.vySmooth); }

    // Timer d'attaque — cadencé sur le BPM de la musique (6 temps entre attaques, 2 temps de charge)
    const bossVit = 1.2 * bspd * boss.spdMul;
    const bossBpm = 110 + 40 * Math.min(1, (bossVit - 1.2) / (9.4 - 1.2));
    const framesParTemps = 60 / bossBpm * 60; // 1 temps en frames (à 60fps)
    boss.atkTimer++;
    const iv = Math.round(framesParTemps * 6); // Attaque tous les 6 temps
    if (boss.atkTimer >= iv) {
      boss.state = 'prefire';
      boss.preTimer = Math.round(framesParTemps * 2); // Charge de 2 temps
      boss.frozenX = boss.x; boss.frozenY = boss.y;
      boss.frozenTimer = boss.timer; // Figer le timer pour reprendre sans téléportation
      const prochaineTir = boss.pat % 6;
      sfx(prochaineTir === 0 || prochaineTir === 2 || prochaineTir === 4 ? 'bossCharge' : 'bossChargeIdle');
    }
  } else if (boss.state === 'prefire') {
    // Phase de charge : boss figé et tremblant
    boss.x = boss.frozenX + (Math.random() - 0.5) * 5;
    boss.y = boss.frozenY + (Math.random() - 0.5) * 5;
    boss.preTimer--;

    if (boss.preTimer <= 0) {
      boss.state = 'idle'; boss.atkTimer = 0;
      boss.x = boss.frozenX; boss.y = boss.frozenY;
      bossNouvelleDestination(); // Nouvelle destination après l'attaque

      // Tir d'attaque — 3 patterns en rotation (phases 0, 2, 4)
      // Les phases 1, 3, 5 sont des pauses (pas de tir)
      const spd = 1 + ph * BOSS_FACTEUR_HP_VITESSE;
      const phase = boss.pat % 6;

      // SFX de tir uniquement quand le boss tire vraiment
      if (phase === 0 || phase === 2 || phase === 4) sfx('bossShoot');

      if (phase === 0) {
        // VIOLET : mur de projectiles depuis le bord opposé au joueur
        const roomCx = boss.roomX + boss.roomW / 2;
        const playerLeft = joueur.x < roomCx;
        const spawnX = playerLeft ? boss.roomX + boss.roomW - TILE : boss.roomX + TILE;
        const dir = playerLeft ? -1 : 1;
        const gap = 3 + Math.floor(Math.random() * (LIGNES - 8));
        for (let r = 2; r < LIGNES - 2; r++) {
          if (Math.abs(r - gap) > 4) {
            boss.bullets.push({
              x: spawnX, y: r * TILE + TILE / 2,
              vx: dir * 2.5 * spd, vy: 0, r: 4, c: '#c0f'
            });
          }
        }
      } else if (phase === 2) {
        // ORANGE : tirs ciblés vers le joueur
        // Le nombre de projectiles augmente avec les HP perdus
        const count = Math.round(3 + 7 * (1 - boss.hp / boss.maxHp));
        const dx = joueur.x - (boss.x + boss.w / 2), dy = joueur.y - (boss.y + boss.h / 2);
        const baseAng = Math.atan2(dy, dx);
        const spread = 0.5 + 0.4 * (count - 3) / 7;
        for (let i = 0; i < count; i++) {
          const tt = count > 1 ? (i / (count - 1) - 0.5) : 0;
          const ang = baseAng + tt * spread + (Math.random() - 0.5) * 0.08;
          boss.bullets.push({
            x: boss.x + boss.w / 2, y: boss.y + boss.h / 2,
            vx: Math.cos(ang) * 2.6 * spd, vy: Math.sin(ang) * 2.6 * spd,
            r: 5, c: '#f80'
          });
        }
      } else if (phase === 4) {
        // JAUNE : 12–24 projectiles en cercle (nombre croissant avec les HP perdus)
        const circleCount = Math.round(12 + 12 * (1 - boss.hp / boss.maxHp));
        for (let i = 0; i < circleCount; i++) {
          const ang = (i / circleCount) * Math.PI * 2;
          boss.bullets.push({
            x: boss.x + boss.w / 2, y: boss.y + boss.h / 2,
            vx: Math.cos(ang) * 2.2 * spd, vy: Math.sin(ang) * 2.2 * spd,
            r: 4, c: '#ff0'
          });
        }
      }

      boss.pat++;
    }
  }

  // --- Mise à jour des projectiles du boss ---
  boss.bullets = boss.bullets.filter(b => {
    // Historique de positions pour la traînée (max 6 points)
    if (!b.trail) b.trail = [];
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 6) b.trail.shift();
    b.x += b.vx; b.y += b.vy;
    // Confiner les projectiles dans la salle du boss (100 colonnes)
    if (b.x < boss.roomX || b.x > boss.roomX + boss.roomW ||
        b.y < 0 || b.y > LIGNES * TILE) return false;
    if (chevauche(joueur, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
      tuerJoueur();
      return false;
    }
    return true;
  });

  // --- Boutons-lasers (triggers) ---
  for (const tr of boss.triggers) {
    if (tr.cooldown > 0) tr.cooldown--;
    if (tr.laserActive > 0) tr.laserActive--;

    // Hitbox étendue d'une tile vers la zone de marche du joueur
    // (sol → étendre vers le haut, plafond → étendre vers le bas)
    const thbY = tr.laserDir === 'up' ? tr.y - TILE : tr.y;
    const thbH = tr.h + TILE;
    if (tr.cooldown === 0 && chevauche(joueur, { x: tr.x, y: thbY, w: tr.w, h: thbH })) {
      tr.laserActive = 20;
      tr.cooldown = 90;
      sfx('trigger');

      // Vérifier si le laser touche le boss (demi-largeur de faisceau = 6px)
      const bx = tr.x + tr.w / 2;
      const halfBeam = 6;
      const hit = bx + halfBeam > boss.x && bx - halfBeam < boss.x + boss.w;
      let dmg = false;
      if (tr.laserDir === 'up' && hit && boss.y < tr.y) dmg = true;
      if (tr.laserDir === 'down' && hit && boss.y + boss.h > tr.y) dmg = true;

      if (dmg && boss.inv === 0 && boss.state !== 'intro' && boss.shieldTimer <= 0 && bossVitesseActuelle() <= 3) {
        boss.hp--;
        boss.inv = 60;
        tremblement = 15;
        boss.spdMul = 6.0; // Boost de vitesse après un hit
        bossNouvelleDestination(); // Fuite immédiate vers un autre point
        // Impulser la vélocité vers la nouvelle cible pour une fuite réactive
        const fdx = boss.targetX - boss.x, fdy = boss.targetY - boss.y;
        const fd = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
        boss.vxSmooth = (fdx / fd) * 3;
        boss.vySmooth = (fdy / fd) * 3;
        emettreParticules(boss.x + boss.w / 2, boss.y + boss.h / 2, '#fff', 30);

        if (boss.hp <= 0) {
          boss.defeated = true; boss.active = false;
          emettreParticules(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ff0', 50);
          emettreParticules(boss.x + boss.w / 2, boss.y + boss.h / 2, '#f0f', 50);
          tremblement = 30;
          // Rouvrir la porte d'entrée
          if (boss.gateCol > 0) {
            for (let r = 2; r < 28; r++) monde[r][boss.gateCol] = 0;
          }
          // Spawn des loots — directions aléatoires, zone d'évitement autour du joueur
          const lx = boss.x + boss.w / 2, ly = boss.y + boss.h / 2;
          const pjx = joueur.x + joueur.w / 2, pjy = joueur.y + joueur.h / 2;
          const angJoueur = Math.atan2(pjy - ly, pjx - lx); // Angle vers le joueur
          const lootTypes = ['trinket', 'trinket', 'trinket', 'key', 'gem'];
          for (let li = 0; li < lootTypes.length; li++) {
            // Angle aléatoire, mais rejeté s'il pointe trop vers le joueur
            let ang;
            do {
              ang = Math.random() * Math.PI * 2;
            } while (Math.abs(Math.atan2(Math.sin(ang - angJoueur), Math.cos(ang - angJoueur))) < 0.6);
            // Espacement : décaler légèrement chaque loot pour éviter la superposition
            const spd = 1.5 + li * 0.3 + Math.random() * 0.3;
            bossLoots.push({
              type: lootTypes[li], x: lx, y: ly,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              grounded: false
            });
          }
        }
      } else if (dmg && boss.inv > 0) {
        // Feedback visuel : le laser touche mais le boss est encore invincible
        emettreParticules(boss.x + boss.w / 2, boss.y + boss.h / 2, '#888', 5);
      }

      boss.beams.push({ x: bx, y: tr.y, dir: tr.laserDir, life: 20 });
    }
  }

  boss.beams = boss.beams.filter(b => { b.life--; return b.life > 0; });
  if (boss.inv > 0) boss.inv--;

  // Contact boss/joueur = rebond (inversion de gravité, comme une ligne G)
  if (joueur.alive && gravLineCooldown === 0 && chevauche(joueur, { x: boss.x, y: boss.y, w: boss.w, h: boss.h })) {
    joueur.inverse = !joueur.inverse;
    joueur.vy = joueur.inverse ? -VITESSE_INVERSION : VITESSE_INVERSION;
    gravLineCooldown = GRAV_LINE_CD;
    emettreParticules(joueur.x + joueur.w / 2, joueur.y + joueur.h / 2, '#f0f', 8);
    sfx('flip');
  }
}

// =============================================
// CAMÉRA
// =============================================

function mettreAJourCamera() {
  // Interpolation douce vers la position du joueur (avec anticipation horizontale)
  camera.x += (joueur.x + joueur.w / 2 - vueW / 2 + joueur.vx * 20 - camera.x) * 0.08;
  camera.x = Math.max(0, Math.min(camera.x, Math.max(0, MONDE_W - vueW)));
  // Pas de défilement vertical : les 30 lignes sont toujours visibles
  camera.y = 0;
}

// =============================================
// RENDU
// =============================================

/** Dessine un pic (triangle) selon son type */
function dessinerPic(x, y, t) {
  const m = 2;   // marge : espace entre le pic et les bords de la tile
  const p = 6;   // retrait de la pointe (distance pointe ↔ bord opposé)

  // Base et pointe selon l'orientation
  // d = décalage de 1px vers le mur adjacent (la base colle davantage au mur)
  const d = 1;
  let bx0, by0, bx1, by1, px0, py0; // base gauche, base droite, pointe
  if (t === 2) { // Pic vers le haut (mur en dessous → décaler vers le bas)
    bx0 = x + m; by0 = y + TILE - m + d; bx1 = x + TILE - m; by1 = y + TILE - m + d;
    px0 = x + TILE / 2; py0 = y + p + d;
  } else if (t === 3) { // Pic vers le bas (mur au-dessus → décaler vers le haut)
    bx0 = x + m; by0 = y + m - d; bx1 = x + TILE - m; by1 = y + m - d;
    px0 = x + TILE / 2; py0 = y + TILE - p - d;
  } else if (t === 7) { // Pic vers la gauche (mur à droite → décaler vers la droite)
    bx0 = x + TILE - m + d; by0 = y + m; bx1 = x + TILE - m + d; by1 = y + TILE - m;
    px0 = x + p + d; py0 = y + TILE / 2;
  } else if (t === 8) { // Pic vers la droite (mur à gauche → décaler vers la gauche)
    bx0 = x + m - d; by0 = y + m; bx1 = x + m - d; by1 = y + TILE - m;
    px0 = x + TILE - p - d; py0 = y + TILE / 2;
  } else { // Losange (pic volant, pas de décalage)
    const cx2 = x + TILE / 2, cy2 = y + TILE / 2;
    bx0 = x + 4; by0 = cy2; bx1 = x + TILE - 4; by1 = cy2;
    px0 = cx2; py0 = y + 4;
  }

  ctx.shadowColor = '#f00'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#f22'; ctx.beginPath();
  if (t === 14) {
    ctx.moveTo(px0, y + 4); ctx.lineTo(x + TILE - 4, y + TILE / 2);
    ctx.lineTo(x + TILE / 2, y + TILE - 4); ctx.lineTo(x + 4, y + TILE / 2);
  } else {
    ctx.moveTo(bx0, by0); ctx.lineTo(px0, py0); ctx.lineTo(bx1, by1);
  }
  ctx.fill(); ctx.shadowBlur = 0;

  // Scintillation très rare : deux éclats partent des coins de la base, convergent vers la pointe
  const hash = (x * 7 + y * 13 + t) | 0;
  const cycle = (hash + time) % 720;  // période ~12s à 60fps
  if (cycle < 20) {
    const prog = cycle / 20;  // 0 (base) → 1 (pointe)
    const easeP = prog * prog;  // accélération vers la pointe

    // Deux branches : coin gauche → pointe, coin droit → pointe
    for (let branche = 0; branche < 2; branche++) {
      const sx = branche === 0 ? bx0 : bx1;
      const sy = branche === 0 ? by0 : by1;
      const lx = sx + (px0 - sx) * easeP;
      const ly = sy + (py0 - sy) * easeP;

      // Couleur : rouge clair à la base → blanc pur à la pointe
      const rr = 255;
      const gg = Math.floor(120 + 135 * prog);
      const bb = Math.floor(80 + 175 * prog);

      // Taille : petit à la base, plus gros au milieu, fin à la pointe
      const taille = (1 - Math.abs(prog - 0.4) * 1.5) * 3 + 1;
      const alpha = 0.4 + 0.6 * prog;

      // Point lumineux principal
      ctx.fillStyle = `rgba(${rr},${gg},${bb},${Math.min(1, alpha)})`;
      ctx.fillRect(lx - taille / 2, ly - taille / 2, taille, taille);

      // Traînée douce (3 points en arrière, opacité décroissante)
      for (let tr = 1; tr <= 3; tr++) {
        const trP = Math.max(0, easeP - tr * 0.06);
        const trx = sx + (px0 - sx) * trP;
        const try_ = sy + (py0 - sy) * trP;
        const trA = alpha * (0.3 - tr * 0.08);
        if (trA > 0) {
          ctx.fillStyle = `rgba(${rr},${Math.floor(100 + 80 * prog)},${Math.floor(60 + 80 * prog)},${trA})`;
          ctx.fillRect(trx - 0.5, try_ - 0.5, 1.5, 1.5);
        }
      }
    }

    // Éclat blanc à la pointe quand les deux branches convergent (fin d'animation)
    if (prog > 0.8) {
      const flashA = (prog - 0.8) / 0.2;
      ctx.fillStyle = `rgba(255,255,255,${flashA * 0.9})`;
      ctx.fillRect(px0 - 1.5, py0 - 1.5, 3, 3);
    }
  }
}

/** Dessine le boss, ses projectiles, faisceaux, triggers et loots */
function dessinerBoss() {
  if (boss.active && !boss.defeated) {

    // --- Phase d'intro : animations d'apparition (6 secondes) ---
    if (boss.state === 'intro') {
      const t = 1 - boss.introTimer / 360; // Progression 0 → 1
      const pulse = 0.6 + 0.4 * Math.sin(boss.timer * 0.15); // Pulsation rapide
      const scale = 0.5 + 0.5 * Math.min(1, t * 2); // Grossissement progressif (atteint 100% à mi-intro)
      const alpha = Math.min(1, t * 3); // Apparition progressive (opaque dès le premier tiers)

      ctx.save();
      ctx.globalAlpha = alpha * pulse;

      // Corps du boss — couleur alternant entre magenta et blanc (clignotement d'invincibilité)
      const introFlash = boss.timer % 8 < 4;
      const couleur = introFlash ? '#fff' : '#f0f';
      ctx.fillStyle = couleur;
      ctx.shadowColor = couleur;
      ctx.shadowBlur = 30 + 20 * pulse;

      // Dessin centré avec mise à l'échelle progressive
      const cx = boss.x + boss.w / 2, cy = boss.y + boss.h / 2;
      const sw = boss.w * scale, sh = boss.h * scale;
      ctx.fillRect(cx - sw / 2, cy - sh / 2, sw, sh);
      ctx.shadowBlur = 0;

      // Yeux fermés pendant l'intro (lignes horizontales)
      if (scale > 0.7) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#000';
        const ox = cx - sw / 2, oy = cy - sh / 2;
        ctx.fillRect(ox + 15 * scale, oy + 25 * scale, 12 * scale, 3 * scale);
        ctx.fillRect(ox + 45 * scale, oy + 25 * scale, 12 * scale, 3 * scale);
        // Bouche fermée — ligne tendue
        ctx.fillRect(ox + 20 * scale, oy + 45 * scale, 32 * scale, 4 * scale);
      }

      // Cercle de bouclier pulsant autour du boss
      ctx.globalAlpha = (0.3 + 0.2 * pulse) * alpha;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#f0f';
      ctx.shadowBlur = 15;
      const rayon = boss.w * 0.8 + 10 * Math.sin(boss.timer * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Particules orbitales autour du boss
      ctx.globalAlpha = alpha * 0.8;
      const nbOrb = 6;
      for (let i = 0; i < nbOrb; i++) {
        const ang = (i / nbOrb) * Math.PI * 2 + boss.timer * 0.05;
        const orbR = rayon + 5;
        const ox = cx + Math.cos(ang) * orbR;
        const oy = cy + Math.sin(ang) * orbR;
        ctx.fillStyle = i % 2 === 0 ? '#f0f' : '#fff';
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Barre de vie (vide, grisée pendant l'intro)
      ctx.fillStyle = '#300'; ctx.fillRect(boss.x, boss.y - 16, boss.w, 8);
      ctx.fillStyle = '#666'; ctx.fillRect(boss.x, boss.y - 16, boss.w, 8);
      return;
    }

    // Couleur du prochain vrai tir (violet / orange / jaune)
    // Si la phase courante est une pause (1, 3, 5), on annonce le tir suivant (phase + 1)
    const prochainPhase = boss.pat % 6;
    const phaseAnnonce = (prochainPhase === 1 || prochainPhase === 3 || prochainPhase === 5) ? (boss.pat + 1) % 6 : prochainPhase;
    const couleurAttaque = phaseAnnonce === 0 ? '#c0f' : phaseAnnonce === 2 ? '#f80' : '#ff0';

    // Couleur du sprite selon l'état
    let couleurCorps;
    if (boss.state === 'prefire') {
      // Scintillement de la couleur de la prochaine attaque
      couleurCorps = boss.timer % 4 < 2 ? couleurAttaque : '#fff';
    } else if (boss.inv > 0) {
      // Clignotement blanc post-hit
      couleurCorps = boss.inv % 4 < 2 ? '#fff' : '#f0f';
    } else {
      couleurCorps = '#f0f';
    }
    ctx.fillStyle = couleurCorps;
    ctx.shadowColor = couleurCorps;
    ctx.shadowBlur = 25;
    ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
    ctx.shadowBlur = 0;

    if (boss.state === 'prefire') {
      // Phase de charge : yeux fermés, bouche crispée
      ctx.fillStyle = '#000';
      ctx.fillRect(boss.x + 15, boss.y + 25, 12, 3);
      ctx.fillRect(boss.x + 45, boss.y + 25, 12, 3);
      ctx.fillRect(boss.x + 20, boss.y + 42, 32, 10);
    } else {
      // Mode normal : yeux ouverts qui suivent le joueur
      ctx.fillStyle = '#000';
      ctx.fillRect(boss.x + 15, boss.y + 20, 12, 12);
      ctx.fillRect(boss.x + 45, boss.y + 20, 12, 12);
      const ex = Math.sign(joueur.x - boss.x) * 3, ey = Math.sign(joueur.y - boss.y) * 3;
      ctx.fillStyle = '#f00';
      ctx.fillRect(boss.x + 18 + ex, boss.y + 24 + ey, 6, 6);
      ctx.fillRect(boss.x + 48 + ex, boss.y + 24 + ey, 6, 6);
      ctx.fillRect(boss.x + 20, boss.y + 45, 32, 8);
    }

    // Invincibilité active (bouclier post-intro ou inv post-hit) → bouclier visuel
    const estInvincible = boss.shieldTimer > 0 || boss.inv > 0 || bossVitesseActuelle() > 3;
    if (estInvincible) {
      const cx = boss.x + boss.w / 2, cy = boss.y + boss.h / 2;
      const pulse = 0.6 + 0.4 * Math.sin(boss.timer * 0.15);
      const bossSpd = bossVitesseActuelle();
      const fade = boss.shieldTimer > 0 ? Math.min(1, boss.shieldTimer / 60)
                 : boss.inv > 0 ? Math.min(1, boss.inv / 15)
                 : Math.min(1, (bossSpd - 3) / 1); // Fondu proportionnel à la vitesse au-dessus de 3
      ctx.save();
      ctx.globalAlpha = (0.3 + 0.2 * pulse) * fade;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#f0f';
      ctx.shadowBlur = 15;
      const rayon = boss.w * 0.8 + 10 * Math.sin(boss.timer * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Particules orbitales
      ctx.globalAlpha = 0.8 * fade;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + boss.timer * 0.05;
        const ox = cx + Math.cos(ang) * (rayon + 5);
        const oy = cy + Math.sin(ang) * (rayon + 5);
        ctx.fillStyle = i % 2 === 0 ? '#f0f' : '#fff';
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Barre de vie du boss (au-dessus du sprite)
    ctx.fillStyle = '#300'; ctx.fillRect(boss.x, boss.y - 16, boss.w, 8);
    if (estInvincible) {
      // Invincible : barre de vie grisée mais montrant le remplissage
      ctx.fillStyle = '#666'; ctx.fillRect(boss.x, boss.y - 16, boss.w * boss.hp / boss.maxHp, 8);
    } else {
      ctx.fillStyle = '#f00'; ctx.shadowColor = '#f00'; ctx.shadowBlur = 4;
      ctx.fillRect(boss.x, boss.y - 16, boss.w * boss.hp / boss.maxHp, 8);
      ctx.shadowBlur = 0;
    }

    // Projectiles du boss (traînée + scintillement)
    for (const b of boss.bullets) {
      if (b.trail) {
        for (let i = 0; i < b.trail.length; i++) {
          const t = b.trail[i];
          const alpha = (i + 1) / (b.trail.length + 1) * 0.4;
          const tr = b.r * (i + 1) / (b.trail.length + 1);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = b.c;
          ctx.beginPath(); ctx.arc(t.x, t.y, tr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      const shimmer = 1 + Math.sin(boss.timer * 0.3 + b.x * 0.1) * 0.25;
      ctx.fillStyle = b.c; ctx.shadowColor = b.c; ctx.shadowBlur = 8 + shimmer * 6;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * shimmer, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Faisceaux laser
    for (const b of boss.beams) {
      const al = b.life / 20;
      ctx.strokeStyle = `rgba(0,255,255,${al})`;
      ctx.shadowColor = '#0ff'; ctx.shadowBlur = 20 * al;
      ctx.lineWidth = 8; ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x, b.dir === 'up' ? 0 : LIGNES * TILE);
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Boutons-lasers (triggers)
    for (const tr of boss.triggers) {
      const act = tr.laserActive > 0;
      ctx.fillStyle = act ? '#0ff' : (tr.cooldown > 0 ? '#333' : '#0a8');
      ctx.shadowColor = act ? '#0ff' : '#0a8';
      ctx.shadowBlur = act ? 12 : 4;
      ctx.fillRect(tr.x, tr.y, tr.w, tr.h);
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#fff';
      const tcx = tr.x + tr.w / 2, tcy = tr.y + tr.h / 2;
      ctx.beginPath();
      if (tr.laserDir === 'up') {
        ctx.moveTo(tcx - 4, tcy + 3); ctx.lineTo(tcx, tcy - 5); ctx.lineTo(tcx + 4, tcy + 3);
      } else {
        ctx.moveTo(tcx - 4, tcy - 3); ctx.lineTo(tcx, tcy + 5); ctx.lineTo(tcx + 4, tcy - 3);
      }
      ctx.fill();
    }
  }

  // Loots du boss
  for (const l of bossLoots) {
    const p = 0.5 + 0.5 * Math.sin(time * 0.08);
    if (l.type === 'trinket') {
      dessinerTrinket(l.x, l.y);
    } else if (l.type === 'key') {
      ctx.shadowColor = '#ff0'; ctx.shadowBlur = 12 * p;
      ctx.fillStyle = `rgba(255,255,0,${0.7 + 0.3 * p})`;
      ctx.beginPath(); ctx.arc(l.x, l.y - 2, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(l.x - 2, l.y + 2, 4, 8);
      ctx.fillRect(l.x, l.y + 6, 4, 3);
      ctx.shadowBlur = 0;
    } else if (l.type === 'gem') {
      const sz = 10 + 3 * p;
      ctx.shadowColor = '#f0f'; ctx.shadowBlur = 20 * p;
      ctx.fillStyle = time % 10 < 5 ? '#f0f' : '#ff0';
      ctx.beginPath();
      ctx.moveTo(l.x, l.y - sz);
      ctx.lineTo(l.x + sz * 0.7, l.y);
      ctx.lineTo(l.x, l.y + sz);
      ctx.lineTo(l.x - sz * 0.7, l.y);
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    }
  }
}

/** Dessine le HUD : infos salle, compteurs, barre de progression, flash de mort */
function dessinerHUD(theme, vw, vh) {
  // Salle et compteur de morts
  ctx.fillStyle = theme.acc; ctx.shadowColor = theme.acc; ctx.shadowBlur = 6;
  ctx.font = '16px "Courier New"'; ctx.textAlign = 'left';
  ctx.fillText(`Salle ${salleIdx + 1}/${nbSalles} : ${theme.name}  |  Morts: ${deaths}`, 16, 30);

  // Compteur de clés
  if (clesEnPoche > 0) {
    ctx.fillStyle = '#ff0'; ctx.shadowColor = '#ff0';
    ctx.fillText(`\u{1F511} x${clesEnPoche}`, 16, 52);
  }

  // Compteur de trinkets
  if (trinketsCollectes > 0 || TRINKETS_TOTAL > 0) {
    ctx.fillStyle = '#0ff'; ctx.shadowColor = '#0ff';
    ctx.fillText(`\u{2666} ${trinketsCollectes}/${TRINKETS_TOTAL}`, 16, clesEnPoche > 0 ? 74 : 52);
  }

  // Compteur de Boss Gems
  if (bossGemsCollectes > 0) {
    let gemY = 52;
    if (clesEnPoche > 0) gemY += 22;
    if (trinketsCollectes > 0 || TRINKETS_TOTAL > 0) gemY += 22;
    ctx.fillStyle = '#f0f'; ctx.shadowColor = '#f0f';
    ctx.fillText(`\u{2B20} x${bossGemsCollectes}`, 16, gemY);
  }
  ctx.shadowBlur = 0;

  // Barre de progression
  const prog = Math.min(1, joueur.x / (MONDE_W - vueW));
  const bw = 160, bh = 6, bx = vw / 2 - bw / 2, by = 16;
  ctx.strokeStyle = `${theme.acc}50`; ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = theme.acc; ctx.shadowColor = theme.acc; ctx.shadowBlur = 4;
  ctx.fillRect(bx, by, bw * prog, bh);
  ctx.shadowBlur = 0;

  // HUD du boss (barre de vie en bas de l'écran)
  if (boss.active && !boss.defeated) {
    ctx.fillStyle = '#f0f'; ctx.shadowColor = '#f0f'; ctx.shadowBlur = 6;
    ctx.font = '14px "Courier New"'; ctx.textAlign = 'center';
    ctx.fillText('BOSS', vw / 2, vh - 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#300'; ctx.fillRect(vw / 2 - 80, vh - 22, 160, 10);
    ctx.fillStyle = '#f0f'; ctx.shadowColor = '#f0f'; ctx.shadowBlur = 4;
    ctx.fillRect(vw / 2 - 80, vh - 22, 160 * boss.hp / boss.maxHp, 10);
    ctx.shadowBlur = 0;
  }

  // Flash blanc de mort — décroissance progressive
  if (flashMort > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashMort})`;
    ctx.fillRect(0, 0, vw, vh);
    flashMort = Math.max(0, flashMort - 0.04);
  }
}

/** Dessine la modale "Boss Vaincu" avec animation de comptage et effet vidéosurveillance */
function dessinerModaleBossVaincu(vw, vh) {
  bvTimer++;

  // --- Logique d'animation des compteurs ---
  // Phase 0 = titre (affichage après délai), 1 = trinkets, 2 = gems, 3 = morts, 4 = message espace
  if (bvPhaseDelai > 0) {
    bvPhaseDelai--;
  } else if (bvPhase >= 1 && bvPhase <= 3 && bvCompteur < bvCibleCompteur) {
    bvTickTimer++;
    // Vitesse adaptative : plus le nombre est grand, plus on accélère (ralenti)
    const tickInterval = bvCibleCompteur > 100 ? 2 : bvCibleCompteur > 20 ? 4 : 5;
    if (bvTickTimer >= tickInterval) {
      bvTickTimer = 0;
      // Incrément adaptatif pour les grands nombres
      const reste = bvCibleCompteur - bvCompteur;
      const increment = reste > 200 ? Math.ceil(reste / 40) : reste > 50 ? Math.ceil(reste / 20) : 1;
      bvCompteur = Math.min(bvCompteur + increment, bvCibleCompteur);
      sfx('countTick');
    }
  } else if (bvPhase >= 1 && bvPhase <= 3 && bvCompteur >= bvCibleCompteur) {
    // Compteur terminé → passer à la phase suivante après une pause marquée
    if (bvPhaseDelai === 0) {
      // Trinkets au maximum → effet spécial "perfect"
      if (bvPhase === 1 && trinketsCollectes === TRINKETS_TOTAL) {
        sfx('perfectTrinkets');
      } else {
        sfx('countDone');
      }
      bvPhase++;
      bvPhaseDelai = 55; // Pause entre les compteurs
      if (bvPhase === 2) { bvCompteur = 0; bvCibleCompteur = bossGemsCollectes; }
      else if (bvPhase === 3) { bvCompteur = 0; bvCibleCompteur = deaths; }
      else if (bvPhase === 4) { bvCompteur = 0; } // Phase message final
    }
  } else if (bvPhase === 0 && bvPhaseDelai === 0) {
    // Titre affiché, lancer le comptage des trinkets
    bvPhase = 1;
    bvCompteur = 0;
    bvCibleCompteur = trinketsCollectes;
    bvPhaseDelai = 20;
  }

  // --- Dimensions de la modale ---
  const modalW = Math.min(520, vw * 0.7);
  const modalH = Math.min(380, vh * 0.55);
  const mx = (vw - modalW) / 2;
  const my = (vh - modalH) / 2;

  // --- Fond assombri ---
  ctx.fillStyle = 'rgba(5,5,16,0.75)';
  ctx.fillRect(0, 0, vw, vh);

  // --- Effet vidéosurveillance : fond de la modale ---
  ctx.save();

  // Fond modale
  ctx.fillStyle = `rgba(8,12,20,0.95)`;
  ctx.fillRect(mx, my, modalW, modalH);

  // Bordure style moniteur
  ctx.strokeStyle = `rgba(80,255,200,${0.4 + Math.sin(bvTimer * 0.08) * 0.15})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(mx + 1, my + 1, modalW - 2, modalH - 2);
  ctx.strokeStyle = `rgba(80,255,200,0.15)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 4, my + 4, modalW - 8, modalH - 8);

  // Scanlines horizontales
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let sy = my; sy < my + modalH; sy += 3) {
    ctx.fillRect(mx, sy, modalW, 1);
  }

  // Ligne de balayage (scanline mobile)
  const scanY = my + ((bvTimer * 1.5) % modalH);
  ctx.fillStyle = 'rgba(120,255,220,0.06)';
  ctx.fillRect(mx, scanY, modalW, 2);
  ctx.fillStyle = 'rgba(120,255,220,0.03)';
  ctx.fillRect(mx, scanY - 8, modalW, 16);

  // Glitch horizontal aléatoire
  if (Math.random() < 0.04) {
    const glitchY = my + Math.random() * modalH;
    const glitchH = 2 + Math.random() * 4;
    const glitchShift = (Math.random() - 0.5) * 8;
    ctx.fillStyle = 'rgba(120,255,220,0.08)';
    ctx.fillRect(mx + glitchShift, glitchY, modalW, glitchH);
  }

  // Vignette (coins sombres)
  const vigGrad = ctx.createRadialGradient(vw / 2, vh / 2, modalH * 0.3, vw / 2, vh / 2, modalH * 0.9);
  vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vigGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vigGrad;
  ctx.fillRect(mx, my, modalW, modalH);

  // --- Texte ---
  ctx.textAlign = 'center';
  const centreX = vw / 2;
  const baseY = my + 55;
  const lineH = 48;
  const fontSize = Math.min(18, vw * 0.028);
  const titleSize = Math.min(32, vw * 0.05);

  // Micro-tremblement du texte (effet CRT)
  const jitterX = (Math.random() - 0.5) * 0.8;
  const jitterY = (Math.random() - 0.5) * 0.4;

  // Titre "BOSS VAINCU"
  ctx.font = `bold ${titleSize}px "Courier New"`;
  ctx.shadowColor = '#f0f'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#f0f';
  const titleAlpha = 0.85 + Math.sin(bvTimer * 0.12) * 0.15;
  ctx.globalAlpha = titleAlpha;
  ctx.fillText('BOSS VAINCU !', centreX + jitterX, baseY + jitterY);
  ctx.globalAlpha = 1;

  // Séparateur
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(80,255,200,0.3)';
  ctx.fillRect(mx + 30, baseY + 18, modalW - 60, 1);

  // Ligne 1 : Trinkets
  const row1Y = baseY + lineH + 20;
  if (bvPhase >= 1) {
    ctx.font = `${fontSize}px "Courier New"`;
    ctx.shadowColor = '#0ff'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#0ff';
    const trinketVal = bvPhase === 1 ? bvCompteur : trinketsCollectes;
    const trinketTxt = `TRINKETS ............ ${String(trinketVal).padStart(3, ' ')} / ${TRINKETS_TOTAL}`;
    ctx.fillText(trinketTxt, centreX + jitterX, row1Y + jitterY);
  }

  // Ligne 2 : Boss Gems
  const row2Y = row1Y + lineH;
  if (bvPhase >= 2) {
    ctx.font = `${fontSize}px "Courier New"`;
    ctx.shadowColor = '#ff0'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff0';
    const gemVal = bvPhase === 2 ? bvCompteur : bossGemsCollectes;
    const gemTxt = `BOSS GEM ............ ${String(gemVal).padStart(3, ' ')}`;
    ctx.fillText(gemTxt, centreX + jitterX, row2Y + jitterY);
  }

  // Ligne 3 : Morts
  const row3Y = row2Y + lineH;
  if (bvPhase >= 3) {
    ctx.font = `${fontSize}px "Courier New"`;
    ctx.shadowColor = '#f55'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#f55';
    const deathVal = bvPhase === 3 ? bvCompteur : deaths;
    const deathTxt = `MORTS ............... ${String(deathVal).padStart(3, ' ')}`;
    ctx.fillText(deathTxt, centreX + jitterX, row3Y + jitterY);
  }

  // Séparateur bas
  if (bvPhase >= 4) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(80,255,200,0.3)';
    ctx.fillRect(mx + 30, row3Y + 18, modalW - 60, 1);
  }

  // Message "Appuyez sur ESPACE" — clignotant
  const row4Y = row3Y + lineH + 5;
  if (bvPhase >= 4) {
    const blinkAlpha = 0.5 + Math.sin(bvTimer * 0.08) * 0.5;
    ctx.font = `${Math.min(14, vw * 0.022)}px "Courier New"`;
    ctx.shadowColor = '#8ff'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#8ff';
    ctx.globalAlpha = blinkAlpha;
    ctx.fillText('[ APPUYEZ SUR ESPACE ]', centreX + jitterX, row4Y + jitterY);
    ctx.globalAlpha = 1;
  }

  // Horodatage style vidéosurveillance en bas à droite
  ctx.font = `${Math.min(10, vw * 0.015)}px "Courier New"`;
  ctx.fillStyle = 'rgba(80,255,200,0.4)';
  ctx.shadowBlur = 0;
  ctx.textAlign = 'right';
  const now = new Date();
  const ts = `REC ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  ctx.fillText(ts, mx + modalW - 10, my + modalH - 10);

  // Petit point rouge "REC" clignotant
  if (Math.sin(bvTimer * 0.1) > 0) {
    ctx.fillStyle = '#f22';
    ctx.beginPath();
    ctx.arc(mx + modalW - ctx.measureText(ts).width - 18, my + modalH - 14, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'start';
  ctx.shadowBlur = 0;
  ctx.restore();
}

function draw() {
  const vw = canvas.width, vh = canvas.height;
  const theme = THEMES[salleIdx] || THEMES[0];

  // Calcul de l'échelle : les 30 lignes remplissent toute la hauteur
  echelle = vh / (LIGNES * TILE);
  vueW = vw / echelle;

  // Fond (plein écran, avant scaling)
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, vw, vh);
  if (!started) return;

  mettreAJourCamera();
  ctx.save();

  // Mise à l'échelle : le monde logique remplit le viewport
  ctx.scale(echelle, echelle);

  // Screen shake (tremblement, en unités logiques)
  if (tremblement > 0) ctx.translate((Math.random() - 0.5) * tremblement, (Math.random() - 0.5) * tremblement);
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

  // Plage de colonnes des salles actives (courante ± 1)
  salleMin = Math.max(0, salleIdx - 1);
  salleMax = Math.min(nbSalles - 1, salleIdx + 1);
  const colActifDebut = offsetsSalles[salleMin];
  const colActifFin = offsetsSalles[salleMax] + largeursSalles[salleMax];

  // Calcul des tiles visibles à l'écran (croisement vue caméra × salles actives)
  const colDebut = Math.max(colActifDebut, Math.floor(camera.x / TILE) - 1);
  const colFin = Math.min(colActifFin, Math.ceil((camera.x + vueW) / TILE) + 1);
  const ligDebut = Math.max(0, Math.floor(camera.y / TILE) - 1);
  const ligFin = Math.min(LIGNES, Math.ceil((camera.y + MONDE_H) / TILE) + 1);

  // --- Parallaxe ---
  dessinerParallaxe(theme, camera.x);

  // --- Grille de fond (désactivée) ---
  // for (let c = colDebut; c <= colFin; c++) {
  //   ctx.beginPath(); ctx.moveTo(c * TILE, ligDebut * TILE); ctx.lineTo(c * TILE, ligFin * TILE); ctx.stroke();
  // }
  // for (let r = ligDebut; r <= ligFin; r++) {
  //   ctx.beginPath(); ctx.moveTo(colDebut * TILE, r * TILE); ctx.lineTo(colFin * TILE, r * TILE); ctx.stroke();
  // }

  // --- Téléporteurs ---
  for (const tp of teleporteurs) {
    if (tp.salle < salleMin || tp.salle > salleMax) continue;
    const col = TP_COLORS[(parseInt(tp.digit) - 1) % TP_COLORS.length];
    const p = 0.5 + 0.5 * Math.sin(time * 0.06 + parseInt(tp.digit));
    for (const [px, py] of [[tp.ax, tp.ay], [tp.bx, tp.by]]) {
      if (px + TILE < camera.x - 50 || px > camera.x + vueW + 50) continue;
      ctx.shadowColor = col; ctx.shadowBlur = 10 * p;
      ctx.fillStyle = `${col}30`;
      ctx.fillRect(px, py, TILE, TILE);
      // Contour lumineux
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
      ctx.setLineDash([]);
      // Chiffre au centre
      ctx.fillStyle = col; ctx.font = `${TILE * 0.6}px "Courier New"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tp.digit, px + TILE / 2, py + TILE / 2);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      ctx.shadowBlur = 0;
    }
  }

  // Index rapide pour les lookups par position (évite les find() dans la boucle de rendu)
  const cpMap = new Map();
  for (const cp of checkpoints) cpMap.set(`${Math.floor(cp.y / TILE)},${Math.floor(cp.x / TILE)}`, cp);
  const ephMap = new Map();
  for (const eph of ephemeres) ephMap.set(`${eph.r},${eph.c}`, eph);

  // --- Tiles ---
  for (let r = ligDebut; r < ligFin; r++) {
    for (let c = colDebut; c < colFin; c++) {
      const tile = monde[r][c], x = c * TILE, y = r * TILE;

      if (tile === 1) {
        // Mur : fond sombre + bordures lumineuses sur les côtés exposés
        ctx.fillStyle = '#0c0c1a'; ctx.fillRect(x, y, TILE, TILE);
        const tp = r > 0 && monde[r - 1] && monde[r - 1][c] !== 1;
        const bt = r < LIGNES - 1 && monde[r + 1] && monde[r + 1][c] !== 1;
        const lf = c > 0 && !estSolide(monde[r][c - 1]);
        const rt = c < MONDE_COLS - 1 && !estSolide(monde[r][c + 1]);
        if (tp || bt || lf || rt) {
          ctx.strokeStyle = theme.wall; ctx.shadowColor = theme.wall;
          ctx.shadowBlur = 4; ctx.lineWidth = 1; ctx.beginPath();
          if (tp) { ctx.moveTo(x, y + 0.5); ctx.lineTo(x + TILE, y + 0.5); }
          if (bt) { ctx.moveTo(x, y + TILE - 0.5); ctx.lineTo(x + TILE, y + TILE - 0.5); }
          if (lf) { ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + TILE); }
          if (rt) { ctx.moveTo(x + TILE - 0.5, y); ctx.lineTo(x + TILE - 0.5, y + TILE); }
          ctx.stroke(); ctx.shadowBlur = 0;
        }
      } else if (estDangereux(tile)) {
        dessinerPic(x, y, tile);
      } else if (tile === 4) {
        // Checkpoint : drapeau, vert vif si activé
        const cp = cpMap.get(`${r},${c}`);
        const act = cp && cp.activated;
        const auPlafond = graviteInverseeA(x, y);
        const p = 0.5 + 0.5 * Math.sin(time * 0.06);

        // Couleurs
        const coulMat = act ? '#0f0' : `rgba(0,200,80,${0.4 + 0.3 * p})`;
        const coulDrap = act ? '#0f0' : `rgba(0,160,60,${0.5 + 0.3 * p})`;
        const coulGlow = act ? '#0f0' : '#0a4';

        ctx.shadowColor = coulGlow;
        ctx.shadowBlur = act ? 12 : 6 * p;

        // Mât (ligne verticale fine)
        const matX = x + 8;
        const matW = 2;
        ctx.fillStyle = coulMat;
        ctx.fillRect(matX, y + 2, matW, TILE - 4);

        // Drapeau triangulaire avec ondulation
        const onde = act ? Math.sin(time * 0.08) * 2 : Math.sin(time * 0.04) * 1;
        ctx.fillStyle = coulDrap;
        ctx.beginPath();
        if (auPlafond) {
          // Checkpoint au plafond : drapeau en bas du mât (près de la boule qui pend)
          const dy = y + TILE - 13;
          ctx.moveTo(matX + matW, dy);
          ctx.lineTo(matX + matW + 12, dy + 5 + onde);
          ctx.lineTo(matX + matW, dy + 10);
        } else {
          // Checkpoint au sol : drapeau en haut du mât
          const dy = y + 3;
          ctx.moveTo(matX + matW, dy);
          ctx.lineTo(matX + matW + 12, dy + 5 + onde);
          ctx.lineTo(matX + matW, dy + 10);
        }
        ctx.fill();

        // Petite boule au sommet du mât
        ctx.beginPath();
        const bouleY = auPlafond ? y + TILE - 2 : y + 2;
        ctx.arc(matX + 1, bouleY, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
      } else if (tile === 5) {
        // Ligne de gravité : ligne fine ~4px, arc-en-ciel spatial défilant
        const ly = y + TILE / 2 - 2;
        const grad = ctx.createLinearGradient(x, 0, x + TILE, 0);
        for (let s = 0; s <= 4; s++) {
          const hue = ((x / TILE * 30 + s * 90 + time * 3) % 360);
          grad.addColorStop(s / 4, `hsl(${hue},100%,60%)`);
        }
        ctx.fillStyle = grad;
        ctx.shadowColor = `hsl(${(time * 3) % 360},100%,60%)`;
        ctx.shadowBlur = 12;
        ctx.fillRect(x, ly, TILE, 4);
        ctx.shadowBlur = 0;
      } else if (tile === 9 || tile === 10 || tile === 6 || tile === 15) {
        // Tapis roulant : on ne dessine que si c'est la première tile du segment
        const prevTile = c > 0 ? monde[r][c - 1] : 0;
        if (prevTile !== tile) {
          // Calculer la longueur totale du segment contigu
          let longueur = 1;
          while (c + longueur < MONDE_COLS && monde[r][c + longueur] === tile) longueur++;
          const rapide = tile === 6 || tile === 15;
          const droite = tile === 9 || tile === 6;
          const couleur = rapide ? '#f22' : '#f80';
          const totalW = longueur * TILE;
          // Fond + bordures pour tout le segment d'un coup
          ctx.fillStyle = '#1a1a0a'; ctx.fillRect(x, y, totalW, TILE);
          ctx.fillStyle = couleur;
          ctx.fillRect(x, y, totalW, 2);
          ctx.fillRect(x, y + TILE - 2, totalW, 2);
          // Flèche animée glissant sur toute la longueur
          const vitesseTapis = rapide ? BOOST_TAPIS_RAPIDE : BOOST_TAPIS_LENT;
          const dir = droite ? 1 : -1;
          const nbFleches = longueur <= 4 ? 1 : 2;
          const espacement = totalW / nbFleches;
          const offsetBrut = (dir * vitesseTapis * time) % totalW;
          const offset = ((offsetBrut % totalW) + totalW) % totalW;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, totalW, TILE);
          ctx.clip();
          const cy2 = y + TILE / 2;
          const flecheW = 10, flecheH = 7;
          ctx.fillStyle = couleur;
          ctx.globalAlpha = 0.8;
          for (let i = 0; i < nbFleches; i++) {
            const px = x + (offset + i * espacement) % totalW;
            ctx.beginPath();
            if (droite) {
              ctx.moveTo(px - flecheW / 2, cy2 - flecheH);
              ctx.lineTo(px + flecheW / 2, cy2);
              ctx.lineTo(px - flecheW / 2, cy2 + flecheH);
            } else {
              ctx.moveTo(px + flecheW / 2, cy2 - flecheH);
              ctx.lineTo(px - flecheW / 2, cy2);
              ctx.lineTo(px + flecheW / 2, cy2 + flecheH);
            }
            ctx.fill();
          }
          ctx.globalAlpha = 1.0;
          ctx.restore();
        }
      } else if (tile === 11) {
        // Clé : cercle jaune pulsant + tige
        const p = 0.5 + 0.5 * Math.sin(time * 0.1);
        ctx.shadowColor = '#ff0'; ctx.shadowBlur = 12 * p;
        ctx.fillStyle = `rgba(255,255,0,${0.7 + 0.3 * p})`;
        ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2 - 2, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x + TILE / 2 - 2, y + TILE / 2 + 2, 4, 8);
        ctx.fillRect(x + TILE / 2, y + TILE / 2 + 6, 4, 3);
        ctx.shadowBlur = 0;
      } else if (tile === 12) {
        // Porte : bloc brun avec cadre orange
        ctx.fillStyle = '#420'; ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = '#f80'; ctx.shadowColor = '#f80';
        ctx.shadowBlur = 6; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#f80'; ctx.fillRect(x + TILE / 2 - 2, y + TILE / 2 - 2, 4, 4);
        ctx.shadowBlur = 0;
      } else if (tile === 16) {
        // Trinket : losange cyan pulsant et tournant
        dessinerTrinket(x + TILE / 2, y + TILE / 2);
      } else if (tile === 17) {
        // Plateforme éphémère : style nuage avec scintillement
        const eph = ephMap.get(`${r},${c}`);
        let alpha = 1, dx = 0, dy = 0;
        if (eph && eph.etat === 'disparition') {
          const progression = 1 - eph.timer / EPH_DELAI; // 0 → 1
          alpha = 1 - progression * 0.8;
          dx = (Math.random() - 0.5) * progression * 4;
          dy = (Math.random() - 0.5) * progression * 4;
        }
        // Scintillement de fragilité (oscillation d'alpha)
        const scintil = 0.92 + 0.08 * Math.sin(time * 0.12 + c * 1.7 + r * 2.3);
        ctx.globalAlpha = alpha * scintil;

        // Détection des voisins éphémères ou murs
        const adjHaut = r > 0 && (monde[r - 1][c] === 17 || monde[r - 1][c] === 1);
        const adjBas  = r < LIGNES - 1 && (monde[r + 1][c] === 17 || monde[r + 1][c] === 1);
        const adjGauche = c > 0 && (monde[r][c - 1] === 17 || monde[r][c - 1] === 1);
        const adjDroite = c < MONDE_COLS - 1 && (monde[r][c + 1] === 17 || monde[r][c + 1] === 1);

        // Calcul du rayon arrondi par coin (arrondi si le coin est exposé)
        const rd = 5;
        const rTL = (!adjHaut && !adjGauche) ? rd : 0;
        const rTR = (!adjHaut && !adjDroite) ? rd : 0;
        const rBR = (!adjBas && !adjDroite) ? rd : 0;
        const rBL = (!adjBas && !adjGauche) ? rd : 0;

        // Fond arrondi
        ctx.fillStyle = '#0c0c2a';
        ctx.beginPath();
        const bx = x + dx, by = y + dy;
        ctx.moveTo(bx + rTL, by);
        ctx.lineTo(bx + TILE - rTR, by);
        if (rTR) ctx.arcTo(bx + TILE, by, bx + TILE, by + rTR, rTR);
        else ctx.lineTo(bx + TILE, by);
        ctx.lineTo(bx + TILE, by + TILE - rBR);
        if (rBR) ctx.arcTo(bx + TILE, by + TILE, bx + TILE - rBR, by + TILE, rBR);
        else ctx.lineTo(bx + TILE, by + TILE);
        ctx.lineTo(bx + rBL, by + TILE);
        if (rBL) ctx.arcTo(bx, by + TILE, bx, by + TILE - rBL, rBL);
        else ctx.lineTo(bx, by + TILE);
        ctx.lineTo(bx, by + rTL);
        if (rTL) ctx.arcTo(bx, by, bx + rTL, by, rTL);
        else ctx.lineTo(bx, by);
        ctx.closePath();
        ctx.fill();

        // Bordures lumineuses arrondies sur les côtés exposés
        if (!adjHaut || !adjBas || !adjGauche || !adjDroite) {
          ctx.strokeStyle = '#88f'; ctx.shadowColor = '#88f';
          ctx.shadowBlur = 5; ctx.lineWidth = 1.5;
          ctx.beginPath();
          // Reproduire le même chemin arrondi mais uniquement les côtés exposés
          if (!adjHaut) {
            ctx.moveTo(bx + rTL, by + 0.5);
            ctx.lineTo(bx + TILE - rTR, by + 0.5);
          }
          if (!adjDroite) {
            ctx.moveTo(bx + TILE - 0.5, by + rTR);
            ctx.lineTo(bx + TILE - 0.5, by + TILE - rBR);
          }
          if (!adjBas) {
            ctx.moveTo(bx + TILE - rBR, by + TILE - 0.5);
            ctx.lineTo(bx + rBL, by + TILE - 0.5);
          }
          if (!adjGauche) {
            ctx.moveTo(bx + 0.5, by + TILE - rBL);
            ctx.lineTo(bx + 0.5, by + rTL);
          }
          ctx.stroke(); ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- Plateformes mobiles (salles actives uniquement) ---
  for (const pl of plateformesMobiles) {
    if (pl.salle < salleMin || pl.salle > salleMax) continue;
    if (pl.x + pl.w < camera.x - 50 || pl.x > camera.x + vueW + 50) continue;
    const rapide = pl.speed > 1;
    const coulPlat = rapide ? '#f44' : '#f80';
    ctx.fillStyle = coulPlat; ctx.shadowColor = coulPlat; ctx.shadowBlur = 8;
    ctx.fillRect(pl.x, pl.y, pl.w, pl.h); ctx.shadowBlur = 0;
    ctx.strokeStyle = rapide ? '#f66' : '#fa0'; ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(pl.x + 1, pl.y + 1, pl.w - 2, pl.h - 2);
    ctx.setLineDash([]);
  }

  // --- Traînée du joueur ---
  for (const t of joueur.trainee) {
    ctx.fillStyle = `${theme.acc}${Math.round(t.life / 12 * 64).toString(16).padStart(2, '0')}`;
    ctx.fillRect(t.x - 4, t.y - 4, 8, 8);
  }

  // --- Ennemis (salles actives uniquement) ---
  for (const e of ennemis) {
    if (e.salle < salleMin || e.salle > salleMax) continue;
    if (e.x + e.w < camera.x - 50 || e.x > camera.x + vueW + 50) continue;
    const p = 0.7 + 0.3 * Math.sin(time * 0.1);
    ctx.shadowColor = e.color; ctx.shadowBlur = 10 * p;
    ctx.fillStyle = e.color;

    if (e.type === 'green' || e.type === 'dgreen') {
      // Les ennemis verts pulsent en taille avec leur accélération
      const sc = 1 + 0.15 * Math.sin(e.timer * 0.07);
      const dx = (e.w - e.w * sc) / 2, dy = (e.h - e.h * sc) / 2;
      ctx.fillRect(e.x + dx, e.y + dy, e.w * sc, e.h * sc);
    } else {
      ctx.fillRect(e.x, e.y, e.w, e.h);
    }
    ctx.shadowBlur = 0;

    // Traînée fantôme pour les ennemis à trajectoire sinusoïdale
    if (e.type === 'purple' || e.type === 'dgreen') {
      ctx.globalAlpha = 0.25; ctx.fillStyle = e.color;
      ctx.fillRect(
        e.x + (e.isH ? -Math.sign(e.speed) * 6 : 0),
        e.y + (e.isH ? 0 : -Math.sign(e.speed) * 6),
        e.w, e.h
      );
      ctx.globalAlpha = 1;
    }

    // Yeux
    ctx.fillStyle = '#fff';
    ctx.fillRect(e.x + 3, e.y + 4, 3, 3);
    ctx.fillRect(e.x + 10, e.y + 4, 3, 3);
  }

  dessinerBoss();

  // --- Joueur ---
  if (joueur.alive) {
    const px = joueur.x, py = joueur.y;
    const inv = joueur.inverse;
    ctx.shadowColor = theme.acc; ctx.shadowBlur = 18;
    ctx.fillStyle = theme.acc;

    // Tête (16×12) — bloc principal
    const headY = inv ? py + 8 : py;
    ctx.fillRect(px, headY, 16, 12);

    // Corps (10×4, centré)
    const bodyY = inv ? py + 4 : py + 12;
    ctx.fillRect(px + 3, bodyY, 10, 4);

    // Jambes (4×4 chacune, animation de marche)
    const marchant = joueur.vx !== 0 && joueur.auSol;
    const frameJambe = marchant ? Math.floor(time * 0.15) % 2 : 0;
    const legY = inv ? py : py + 16;
    if (frameJambe === 0) {
      ctx.fillRect(px + 3, legY, 4, 4);
      ctx.fillRect(px + 9, legY, 4, 4);
    } else {
      ctx.fillRect(px + 2, legY, 4, 4);
      ctx.fillRect(px + 10, legY, 4, 4);
    }
    ctx.shadowBlur = 0;

    // Visage (dans la zone de la tête)
    ctx.fillStyle = theme.bg;
    if (!inv) {
      // Yeux
      ctx.fillRect(px + 3, headY + 2, 3, 3);
      ctx.fillRect(px + 10, headY + 2, 3, 3);
      // Sourire en V (pointe vers le bas = content)
      ctx.fillRect(px + 4, headY + 6, 2, 1);
      ctx.fillRect(px + 10, headY + 6, 2, 1);
      ctx.fillRect(px + 5, headY + 7, 2, 1);
      ctx.fillRect(px + 9, headY + 7, 2, 1);
      ctx.fillRect(px + 6, headY + 8, 4, 1);
    } else {
      // Yeux (en bas de la tête inversée)
      ctx.fillRect(px + 3, headY + 7, 3, 3);
      ctx.fillRect(px + 10, headY + 7, 3, 3);
      // Moue en V inversé (pointe vers le haut = triste)
      ctx.fillRect(px + 6, headY + 2, 4, 1);
      ctx.fillRect(px + 5, headY + 3, 2, 1);
      ctx.fillRect(px + 9, headY + 3, 2, 1);
      ctx.fillRect(px + 4, headY + 4, 2, 1);
      ctx.fillRect(px + 10, headY + 4, 2, 1);
    }
  }

  // --- Particules ---
  for (const p of particules) {
    ctx.globalAlpha = p.life / p.ml;
    ctx.shadowColor = p.color; ctx.shadowBlur = 5;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // --- Brouillard progressif aux bords des salles actives ---
  const fogW = FOG_TILES * TILE;
  if (salleMin > 0) {
    // Brouillard à gauche : opaque (bord) → transparent (intérieur)
    const fx = colActifDebut * TILE;
    const gradL = ctx.createLinearGradient(fx, 0, fx + fogW, 0);
    gradL.addColorStop(0, theme.bg);
    gradL.addColorStop(1, bgAvecAlpha(theme.bg, 0));
    ctx.fillStyle = gradL;
    ctx.fillRect(fx, 0, fogW, MONDE_H);
  }
  if (salleMax < nbSalles - 1) {
    // Brouillard à droite : transparent (intérieur) → opaque (bord)
    const fx = colActifFin * TILE;
    const gradR = ctx.createLinearGradient(fx - fogW, 0, fx, 0);
    gradR.addColorStop(0, bgAvecAlpha(theme.bg, 0));
    gradR.addColorStop(1, theme.bg);
    ctx.fillStyle = gradR;
    ctx.fillRect(fx - fogW, 0, fogW, MONDE_H);
  }

  ctx.restore();

  dessinerHUD(theme, vw, vh);

  if (bossVaincuAffiche) dessinerModaleBossVaincu(vw, vh);
}

// Gestion clavier (un seul listener pour toutes les actions)
function _onKeydownActions(e) {
  if (!jeuActif) return;
  // Touche R : restart / respawn
  if (e.code === 'KeyR' && started) {
    respawn();
  }

  // Dismiss de l'écran "Boss Vaincu" → retour au menu via callback SPA
  if (e.code === 'Space' && bossVaincuAffiche) {
    if (bvPhase >= 4) {
      bossVaincuAffiche = false;
      // Signaler au SPA que le monde est terminé
      if (_callbackBossVaincu) {
        _callbackBossVaincu();
      }
    } else {
      // Accélérer : sauter directement à la fin de l'animation
      bvPhase = 4; bvPhaseDelai = 0;
    }
  }

  // Pavé numérique 1-9 : téléportation vers la salle correspondante
  if (!started) return;
  const match = e.code.match(/^Numpad(\d)$/);
  if (!match) return;
  const num = parseInt(match[1]);
  if (num < 1 || num > nbSalles) return;
  const idx = num - 1;

  // Trouver le checkpoint le plus à gauche dans cette salle
  const salleDebut = offsetsSalles[idx] * TILE;
  const salleFin = (offsetsSalles[idx] + largeursSalles[idx]) * TILE;
  let meilleurCp = null;
  for (const cp of checkpoints) {
    if (cp.x >= salleDebut && cp.x < salleFin) {
      if (!meilleurCp || cp.x < meilleurCp.x) meilleurCp = cp;
    }
  }
  if (!meilleurCp) return;

  // Téléporter le joueur
  joueur.x = meilleurCp.x + 4; joueur.y = meilleurCp.y;
  joueur.vx = 0; joueur.vy = 0;
  joueur.inverse = graviteInverseeA(meilleurCp.x, meilleurCp.y);
  joueur.auSol = false; joueur.alive = true;
  joueur.checkX = joueur.x; joueur.checkY = joueur.y;
  joueur.trainee = [];
  flipBuf = 0; coyote = 0; gravLineCooldown = 0;

  // Activer le checkpoint cible
  meilleurCp.activated = true;

  // Réinitialiser les entités
  initEnnemis(); initPlateformes(); initEphemeres();
  boss.bullets = []; boss.beams = [];
  if (boss.active) {
    boss.active = false; boss.timer = 0; boss.pat = 0;
    boss.state = 'idle'; boss.atkTimer = 0;
    boss.spdMul = 1; boss.preTimer = 0;
  }

  salleIdx = idx;
  salleMin = Math.max(0, salleIdx - 1);
  salleMax = Math.min(nbSalles - 1, salleIdx + 1);
}

// =============================================
// MUSIQUE
// =============================================

/** Convertit un nom de note (ex: 'C4', 'F#5') en fréquence Hz */
function noteVersHz(n) {
  if (!n || n === '_') return 0;
  const N = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const s = n.includes('#');
  const o = parseInt(n[s ? 2 : 1]);
  return 440 * Math.pow(2, (N[n[0]] + (s ? 1 : 0) - 9) / 12 + (o - 4));
}

// Données musicales construites depuis les salles
let MUSIC_DATA = [];

function startMusic() {
  if (musiqueActive) return;
  musiqueActive = true;

  MUSIC_DATA = SALLES.map(l => l.music);

  const ac = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx = ac;

  // Chaîne audio : instruments → compresseur → master gain → sortie
  const master = ac.createGain();
  master.gain.value = 0.35;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 4;
  comp.connect(master); master.connect(ac.destination);

  const SLEN = 32;    // Longueur d'une section musicale (couplet ou refrain)
  let step = 0;
  let nextT = ac.currentTime + 0.05;
  const bpmInitial = MUSIC_DATA[0] ? MUSIC_DATA[0].bpm : 120;
  let lastBpm = bpmInitial, s16 = 60 / bpmInitial / 4;

  // --- Instruments ---

  /** Lead : double oscillateur désaccordé pour la richesse */
  function pLead(t, f, d, v) {
    if (!f) return;
    for (const det of [-3, 3]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = f + det;
      g.gain.setValueAtTime(v * 0.5, t);
      g.gain.setValueAtTime(v * 0.6, t + d * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(comp); o.start(t); o.stop(t + d + 0.02);
    }
  }

  /** Arpège : oscillateur triangle */
  function pArp(t, f, d, v) {
    if (!f) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(comp); o.start(t); o.stop(t + d + 0.02);
  }

  /** Basse : sawtooth + sine sub pour le poids */
  function pBass(t, f, d, v) {
    if (!f) return;
    const o1 = ac.createOscillator(), g1 = ac.createGain();
    o1.type = 'sawtooth'; o1.frequency.value = f;
    g1.gain.setValueAtTime(v * 0.7, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + d);
    o1.connect(g1); g1.connect(comp); o1.start(t); o1.stop(t + d + 0.02);

    const o2 = ac.createOscillator(), g2 = ac.createGain();
    o2.type = 'sine'; o2.frequency.value = f;
    g2.gain.setValueAtTime(v * 0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + d * 0.8);
    o2.connect(g2); g2.connect(comp); o2.start(t); o2.stop(t + d + 0.02);
  }

  /** Pad : accord soutenu (sine, volume bas) */
  function pPad(t, notes, d, v) {
    for (const n of notes) {
      const f = noteVersHz(n); if (!f) continue;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + d * 0.2);
      g.gain.linearRampToValueAtTime(v * 0.6, t + d * 0.8);
      g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(g); g.connect(comp); o.start(t); o.stop(t + d + 0.05);
    }
  }

  /** Kick : oscillateur avec sweep de fréquence descendant */
  function pKick(t, hard) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(hard ? 180 : 150, t);
    o.frequency.exponentialRampToValueAtTime(hard ? 30 : 25, t + 0.1);
    g.gain.setValueAtTime(hard ? 0.4 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (hard ? 0.15 : 0.12));
    o.connect(g); g.connect(comp); o.start(t); o.stop(t + 0.2);

    // Transitoire d'attaque (click)
    const o2 = ac.createOscillator(), g2 = ac.createGain();
    o2.type = 'square'; o2.frequency.value = hard ? 400 : 300;
    g2.gain.setValueAtTime(hard ? 0.08 : 0.05, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    o2.connect(g2); g2.connect(comp); o2.start(t); o2.stop(t + 0.02);
  }

  /** Snare : bruit (oscillateurs désaccordés) + corps tonal */
  function pSnare(t, hard) {
    for (let i = 0; i < (hard ? 4 : 3); i++) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = 200 + Math.random() * 8000;
      g.gain.setValueAtTime(hard ? 0.04 : 0.025, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (hard ? 0.09 : 0.07));
      o.connect(g); g.connect(comp); o.start(t); o.stop(t + 0.1);
    }
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hard ? 250 : 200, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.05);
    g.gain.setValueAtTime(hard ? 0.12 : 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(comp); o.start(t); o.stop(t + 0.1);
  }

  /** Hi-hat : bruit haute fréquence */
  function pHH(t, open) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = 7000 + Math.random() * 5000;
    g.gain.setValueAtTime(open ? 0.018 : 0.012, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.06 : 0.025));
    o.connect(g); g.connect(comp); o.start(t); o.stop(t + (open ? 0.08 : 0.03));
  }

  /** Stab synthé : accord sawtooth court pour les accents du refrain */
  function pStab(t, f, d) {
    if (!f) return;
    for (const det of [-5, 0, 5]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = f + det;
      g.gain.setValueAtTime(0.03, t);
      g.gain.setValueAtTime(0.04, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(comp); o.start(t); o.stop(t + d + 0.02);
    }
  }

  // --- Séquenceur ---

  function sched(t) {
    const z = Math.min(salleIdx, MUSIC_DATA.length - 1);
    const md = MUSIC_DATA[z];

    const isBoss = (z === nbSalles - 1);

    // Mise à jour du tempo — le BPM converge vers la cible avec une interpolation lisse (lerp)
    const BPM_LERP = 0.02; // Vitesse de convergence (~1.2s pour atteindre 90% de la cible)
    let bpmCible;
    if (isBoss && boss.active && !boss.defeated) {
      const bossVitesse = bossVitesseActuelle();
      // Vitesse min ~1.2 → 110 BPM, vitesse max ~9.4 → 150 BPM
      bpmCible = 110 + (150 - 110) * Math.min(1, (bossVitesse - 1.2) / (9.4 - 1.2));
    } else if (isBoss && boss.defeated) {
      // Boss vaincu : retour progressif au tempo initial (110 BPM)
      bpmCible = 110;
    } else {
      bpmCible = md.bpm;
    }
    if (Math.abs(bpmCible - lastBpm) > 0.05) {
      lastBpm += (bpmCible - lastBpm) * BPM_LERP;
      s16 = 60 / lastBpm / 4;
    }
    // Cycle de 64 steps : 0-31 = couplet, 32-63 = refrain
    const cycle = step % 64;
    const isChorus = cycle >= 32;
    const s = cycle % SLEN;

    // Mélodie
    const melArr = isChorus ? md.mel2 : md.mel;
    pLead(t, noteVersHz(melArr[s]), s16 * (isBoss ? 1.5 : 1.8), isBoss ? 0.07 : 0.055);

    // Arpèges
    const arpArr = isChorus ? md.arp2 : md.arp;
    pArp(t, noteVersHz(arpArr[s]), s16 * 0.7, isBoss ? 0.04 : 0.032);

    // Basse
    const basArr = isChorus ? md.bas2 : md.bas;
    pBass(t, noteVersHz(basArr[s]), s16 * (isBoss ? 2 : 2.5), isBoss ? 0.25 : 0.09);

    // Couche de sub-basse supplémentaire pour le boss (renforcée)
    if (isBoss) {
      const bf = noteVersHz(basArr[s]);
      if (bf) {
        // Sub-basse principale (octave -1)
        const ob = ac.createOscillator(), gb = ac.createGain();
        ob.type = 'sine'; ob.frequency.value = bf / 2;
        gb.gain.setValueAtTime(0.18, t);
        gb.gain.exponentialRampToValueAtTime(0.001, t + s16 * 2);
        ob.connect(gb); gb.connect(comp); ob.start(t); ob.stop(t + s16 * 2 + 0.02);
        // Sub-basse profonde (octave -2, très grave)
        const ob2 = ac.createOscillator(), gb2 = ac.createGain();
        ob2.type = 'sine'; ob2.frequency.value = bf / 4;
        gb2.gain.setValueAtTime(0.08, t);
        gb2.gain.exponentialRampToValueAtTime(0.001, t + s16 * 3);
        ob2.connect(gb2); gb2.connect(comp); ob2.start(t); ob2.stop(t + s16 * 3 + 0.02);
      }
    }

    // Pad : joué toutes les 8 steps
    if (s % 8 === 0) pPad(t, md.pad, s16 * 8, isBoss ? 0.025 : 0.015);

    // Stab synthé sur les accents du refrain
    if (isChorus && s % 4 === 0) {
      const sf = noteVersHz(arpArr[s]);
      if (sf) pStab(t, sf * 2, s16 * 2);
    }

    // Batterie
    const kickArr = isChorus ? md.kick2 : md.kick;
    const snrArr = isChorus ? md.snr2 : md.snr;
    const hhArr = isChorus ? md.hh2 : md.hh;
    if (kickArr[s]) pKick(t, isChorus || isBoss);
    if (snrArr[s]) pSnare(t, isChorus || isBoss);
    if (hhArr[s]) pHH(t, s % 4 === 2);

    // Boss : wobble bass sur les croches (s%2) — sawtooth grave avec balayage 45→70/100 Hz,
    // crée une pulsation grave oppressante qui double le tempo perçu
    if (isBoss && s % 2 === 0) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(45, t);
      o.frequency.exponentialRampToValueAtTime(isChorus ? 100 : 70, t + s16);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + s16 * 0.9);
      o.connect(g); g.connect(comp); o.start(t); o.stop(t + s16 + 0.02);
    }

    // Boss : crash/ride sur les noires (s%4) — bruit métallique aigu (4-8 kHz)
    // marque les temps forts pour ancrer le rythme du combat
    if (isBoss && s % 4 === 0) {
      const oh = ac.createOscillator(), gh = ac.createGain();
      oh.type = 'square'; oh.frequency.value = 4000 + Math.random() * 4000;
      gh.gain.setValueAtTime(0.02, t);
      gh.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      oh.connect(gh); gh.connect(comp); oh.start(t); oh.stop(t + 0.14);
    }

    // Boss : floor tom sur le contretemps de la mesure (step 4 sur 8, soit le "et" du 2e temps)
    // — balayage 100→40 Hz, accentue la tension en cassant la régularité du kick
    if (isBoss && s % 8 === 4) {
      const ot = ac.createOscillator(), gt2 = ac.createGain();
      ot.frequency.setValueAtTime(100, t);
      ot.frequency.exponentialRampToValueAtTime(40, t + 0.1);
      gt2.gain.setValueAtTime(0.2, t);
      gt2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      ot.connect(gt2); gt2.connect(comp); ot.start(t); ot.stop(t + 0.17);
    }

    step++;
  }

  function scheduler() {
    while (nextT < audioCtx.currentTime + 0.1) {
      sched(nextT);
      nextT += s16 || 0.1;
    }
    if (musiqueActive) requestAnimationFrame(scheduler);
  }
  scheduler();
}

// =============================================
// EFFETS SONORES (SFX)
// =============================================

function sfx(type) {
  if (!audioCtx) return;
  const ac = audioCtx, t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.connect(g); g.connect(ac.destination);

  switch (type) {
    case 'flip':
      // Inversion de gravité : sweep rapide montant
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.08);
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.start(t); o.stop(t + 0.16);
      break;

    case 'checkpoint':
      // Checkpoint : arpège ascendant chaud (Do-Mi-Sol)
      o.type = 'sine';
      o.frequency.setValueAtTime(523, t);
      o.frequency.setValueAtTime(659, t + 0.08);
      o.frequency.setValueAtTime(784, t + 0.16);
      g.gain.setValueAtTime(0.15, t);
      g.gain.setValueAtTime(0.12, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
      break;

    case 'key':
      // Ramassage de clé : scintillement aigu ascendant
      o.type = 'square';
      o.frequency.setValueAtTime(1200, t);
      o.frequency.setValueAtTime(1600, t + 0.06);
      o.frequency.setValueAtTime(2400, t + 0.12);
      g.gain.setValueAtTime(0.08, t);
      g.gain.setValueAtTime(0.1, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
      break;

    case 'door': {
      // Ouverture de porte : bruit grave de déverrouillage + confirmation
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
      const o2 = ac.createOscillator(), g2 = ac.createGain();
      o2.connect(g2); g2.connect(ac.destination);
      o2.type = 'square';
      o2.frequency.setValueAtTime(400, t + 0.1);
      o2.frequency.exponentialRampToValueAtTime(600, t + 0.2);
      g2.gain.setValueAtTime(0, t);
      g2.gain.setValueAtTime(0.08, t + 0.1);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o2.start(t); o2.stop(t + 0.27);
      break;
    }

    case 'trigger': {
      // Bouton-laser du boss : zap laser puissant
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(2000, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(100, t + 0.2);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.27);
      const o3 = ac.createOscillator(), g3 = ac.createGain();
      o3.connect(g3); g3.connect(ac.destination);
      o3.type = 'square'; o3.frequency.value = 80;
      g3.gain.setValueAtTime(0.1, t);
      g3.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o3.start(t); o3.stop(t + 0.17);
      break;
    }

    case 'bossAlarm': {
      // Alarme d'entrée dans la salle du boss : sirène montante/descendante
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(200, t);
      o.frequency.linearRampToValueAtTime(600, t + 0.4);
      o.frequency.linearRampToValueAtTime(200, t + 0.8);
      o.frequency.linearRampToValueAtTime(600, t + 1.2);
      o.frequency.linearRampToValueAtTime(200, t + 1.6);
      g.gain.setValueAtTime(0.04, t);
      g.gain.setValueAtTime(0.05, t + 0.4);
      g.gain.setValueAtTime(0.04, t + 0.8);
      g.gain.setValueAtTime(0.05, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
      o.start(t); o.stop(t + 2.02);
      // Couche de sub-basse pour l'impact
      const oa = ac.createOscillator(), ga = ac.createGain();
      oa.connect(ga); ga.connect(ac.destination);
      oa.type = 'sine'; oa.frequency.value = 50;
      ga.gain.setValueAtTime(0.05, t);
      ga.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
      oa.start(t); oa.stop(t + 2.02);
      break;
    }

    case 'bossCharge':
      // Boss en charge : grondement grave tremblant (rapide, volume réduit)
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(60, t);
      o.frequency.setValueAtTime(80, t + 0.15);
      o.frequency.setValueAtTime(50, t + 0.3);
      o.frequency.setValueAtTime(90, t + 0.45);
      g.gain.setValueAtTime(0.03, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.start(t); o.stop(t + 0.62);
      break;

    case 'bossChargeIdle':
      // Boss en charge sans tir : grondement sourd descendant (sawtooth atténué)
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.5);
      g.gain.setValueAtTime(0.03, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.start(t); o.stop(t + 0.57);
      break;

    case 'bossShoot': {
      // Boss tire : burst agressive descendante
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(400, t);
      o.frequency.exponentialRampToValueAtTime(100, t + 0.15);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
      const o5 = ac.createOscillator(), g5 = ac.createGain();
      o5.connect(g5); g5.connect(ac.destination);
      o5.type = 'square';
      o5.frequency.setValueAtTime(200, t);
      o5.frequency.exponentialRampToValueAtTime(50, t + 0.1);
      g5.gain.setValueAtTime(0.12, t);
      g5.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o5.start(t); o5.stop(t + 0.17);
      break;
    }

    case 'death': {
      // Mort : souffle doux descendant, subtil et éthéré
      o.type = 'sine';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.4);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t); o.stop(t + 0.52);
      // Harmonique aiguë en fondu — donne un aspect "dissolution"
      const o4 = ac.createOscillator(), g4 = ac.createGain();
      o4.connect(g4); g4.connect(ac.destination);
      o4.type = 'sine';
      o4.frequency.setValueAtTime(1200, t);
      o4.frequency.exponentialRampToValueAtTime(400, t + 0.45);
      g4.gain.setValueAtTime(0.06, t);
      g4.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o4.start(t); o4.stop(t + 0.47);
      // Souffle léger (bruit blanc filtré simulé par oscillateur désaccordé)
      const o5 = ac.createOscillator(), g5 = ac.createGain();
      o5.connect(g5); g5.connect(ac.destination);
      o5.type = 'triangle';
      o5.frequency.setValueAtTime(90, t);
      o5.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      g5.gain.setValueAtTime(0.05, t + 0.05);
      g5.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o5.start(t); o5.stop(t + 0.52);
      break;
    }

    case 'teleport': {
      // Téléporteur : sweep aigu aller-retour avec résonance sci-fi
      o.type = 'sine';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(1800, t + 0.07);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.15);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
      // Couche bruit de phase (texture spatiale)
      const oTp = ac.createOscillator(), gTp = ac.createGain();
      oTp.connect(gTp); gTp.connect(ac.destination);
      oTp.type = 'square';
      oTp.frequency.setValueAtTime(1200, t);
      oTp.frequency.exponentialRampToValueAtTime(200, t + 0.12);
      gTp.gain.setValueAtTime(0.05, t);
      gTp.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      oTp.start(t); oTp.stop(t + 0.17);
      break;
    }

    case 'ephDestroy':
      // Plateforme éphémère qui se brise : craquement court descendant
      o.type = 'square';
      o.frequency.setValueAtTime(400, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.12);
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.start(t); o.stop(t + 0.17);
      break;

    case 'trinket': {
      // Trinket : arpège ascendant brillant (Do-Mi-Sol-Do aigu)
      o.type = 'sine';
      o.frequency.setValueAtTime(1047, t);        // Do6
      o.frequency.setValueAtTime(1319, t + 0.06);  // Mi6
      o.frequency.setValueAtTime(1568, t + 0.12);  // Sol6
      o.frequency.setValueAtTime(2093, t + 0.18);  // Do7
      g.gain.setValueAtTime(0.12, t);
      g.gain.setValueAtTime(0.15, t + 0.06);
      g.gain.setValueAtTime(0.12, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.42);
      // Couche harmonique scintillante
      const o6 = ac.createOscillator(), g6 = ac.createGain();
      o6.connect(g6); g6.connect(ac.destination);
      o6.type = 'triangle';
      o6.frequency.setValueAtTime(2093, t + 0.1);
      o6.frequency.setValueAtTime(2637, t + 0.2);
      g6.gain.setValueAtTime(0.06, t + 0.1);
      g6.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o6.start(t); o6.stop(t + 0.37);
      break;
    }

    case 'bossGem': {
      // Boss Gem : fanfare triomphale multi-couches
      // Couche 1 — arpège majeur ascendant large (Do5-Mi5-Sol5-Do6-Mi6)
      o.type = 'sine';
      o.frequency.setValueAtTime(523, t);         // Do5
      o.frequency.setValueAtTime(659, t + 0.08);  // Mi5
      o.frequency.setValueAtTime(784, t + 0.16);  // Sol5
      o.frequency.setValueAtTime(1047, t + 0.24); // Do6
      o.frequency.setValueAtTime(1319, t + 0.32); // Mi6
      g.gain.setValueAtTime(0.15, t);
      g.gain.setValueAtTime(0.18, t + 0.16);
      g.gain.setValueAtTime(0.20, t + 0.32);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.start(t); o.stop(t + 0.72);
      // Couche 2 — octave brillante qui suit l'arpège
      const oG2 = ac.createOscillator(), gG2 = ac.createGain();
      oG2.connect(gG2); gG2.connect(ac.destination);
      oG2.type = 'triangle';
      oG2.frequency.setValueAtTime(1047, t + 0.04);
      oG2.frequency.setValueAtTime(1319, t + 0.12);
      oG2.frequency.setValueAtTime(1568, t + 0.20);
      oG2.frequency.setValueAtTime(2093, t + 0.28);
      oG2.frequency.setValueAtTime(2637, t + 0.36);
      gG2.gain.setValueAtTime(0.08, t + 0.04);
      gG2.gain.setValueAtTime(0.12, t + 0.28);
      gG2.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      oG2.start(t + 0.04); oG2.stop(t + 0.67);
      // Couche 3 — accord tenu majestueux (Do+Mi+Sol)
      const oG3a = ac.createOscillator(), gG3a = ac.createGain();
      oG3a.connect(gG3a); gG3a.connect(ac.destination);
      oG3a.type = 'sine'; oG3a.frequency.setValueAtTime(523, t + 0.3);
      gG3a.gain.setValueAtTime(0.10, t + 0.3);
      gG3a.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      oG3a.start(t + 0.3); oG3a.stop(t + 1.02);
      const oG3b = ac.createOscillator(), gG3b = ac.createGain();
      oG3b.connect(gG3b); gG3b.connect(ac.destination);
      oG3b.type = 'sine'; oG3b.frequency.setValueAtTime(659, t + 0.3);
      gG3b.gain.setValueAtTime(0.08, t + 0.3);
      gG3b.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      oG3b.start(t + 0.3); oG3b.stop(t + 1.02);
      const oG3c = ac.createOscillator(), gG3c = ac.createGain();
      oG3c.connect(gG3c); gG3c.connect(ac.destination);
      oG3c.type = 'sine'; oG3c.frequency.setValueAtTime(784, t + 0.3);
      gG3c.gain.setValueAtTime(0.08, t + 0.3);
      gG3c.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      oG3c.start(t + 0.3); oG3c.stop(t + 1.02);
      // Couche 4 — shimmer scintillant aigu
      const oG4 = ac.createOscillator(), gG4 = ac.createGain();
      oG4.connect(gG4); gG4.connect(ac.destination);
      oG4.type = 'square';
      oG4.frequency.setValueAtTime(3136, t + 0.35);  // Sol7
      oG4.frequency.setValueAtTime(4186, t + 0.45);  // Do8
      gG4.gain.setValueAtTime(0.03, t + 0.35);
      gG4.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      oG4.start(t + 0.35); oG4.stop(t + 0.72);
      break;
    }

    case 'countTick': {
      // Tick de compteur — bip court style terminal/vidéosurveillance
      o.type = 'square';
      o.frequency.setValueAtTime(1800, t);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.03);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.start(t); o.stop(t + 0.06);
      break;
    }

    case 'countDone': {
      // Fin de compteur — confirmation montante
      o.type = 'sine';
      o.frequency.setValueAtTime(800, t);
      o.frequency.setValueAtTime(1200, t + 0.06);
      o.frequency.setValueAtTime(1600, t + 0.12);
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.27);
      break;
    }

    case 'perfectTrinkets': {
      // Tous les trinkets collectés — fanfare dorée triomphale
      // Couche 1 — arpège majeur rapide ascendant (Sol4-Si4-Ré5-Sol5-Si5-Ré6)
      o.type = 'sine';
      o.frequency.setValueAtTime(392, t);          // Sol4
      o.frequency.setValueAtTime(494, t + 0.06);   // Si4
      o.frequency.setValueAtTime(587, t + 0.12);   // Ré5
      o.frequency.setValueAtTime(784, t + 0.18);   // Sol5
      o.frequency.setValueAtTime(988, t + 0.24);   // Si5
      o.frequency.setValueAtTime(1175, t + 0.30);  // Ré6
      g.gain.setValueAtTime(0.14, t);
      g.gain.setValueAtTime(0.18, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.start(t); o.stop(t + 0.62);
      // Couche 2 — octave scintillante en triangle
      const oP2 = ac.createOscillator(), gP2 = ac.createGain();
      oP2.connect(gP2); gP2.connect(ac.destination);
      oP2.type = 'triangle';
      oP2.frequency.setValueAtTime(1568, t + 0.15); // Sol6
      oP2.frequency.setValueAtTime(1976, t + 0.22); // Si6
      oP2.frequency.setValueAtTime(2349, t + 0.29); // Ré7
      oP2.frequency.setValueAtTime(3136, t + 0.36); // Sol7
      gP2.gain.setValueAtTime(0.06, t + 0.15);
      gP2.gain.setValueAtTime(0.10, t + 0.29);
      gP2.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      oP2.start(t + 0.15); oP2.stop(t + 0.67);
      // Couche 3 — accord majeur tenu (Sol+Si+Ré)
      const accNotes = [784, 988, 1175];
      for (const freq of accNotes) {
        const oA = ac.createOscillator(), gA = ac.createGain();
        oA.connect(gA); gA.connect(ac.destination);
        oA.type = 'sine'; oA.frequency.setValueAtTime(freq, t + 0.35);
        gA.gain.setValueAtTime(0.08, t + 0.35);
        gA.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        oA.start(t + 0.35); oA.stop(t + 1.12);
      }
      // Couche 4 — brillance finale aiguë
      const oP4 = ac.createOscillator(), gP4 = ac.createGain();
      oP4.connect(gP4); gP4.connect(ac.destination);
      oP4.type = 'square';
      oP4.frequency.setValueAtTime(3136, t + 0.38);  // Sol7
      oP4.frequency.setValueAtTime(3951, t + 0.48);  // Si7
      gP4.gain.setValueAtTime(0.025, t + 0.38);
      gP4.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      oP4.start(t + 0.38); oP4.stop(t + 0.72);
      break;
    }
  }
}

// =============================================
// LANCEMENT / ARRÊT (API SPA)
// =============================================

function _loop() {
  if (!jeuActif) return;
  update();
  draw();
  loopId = requestAnimationFrame(_loop);
}

/** Démarre le jeu avec les salles chargées dans SALLES[].
 *  callbackRetour : fonction appelée quand le joueur appuie sur ESC.
 *  callbackBossVaincu : fonction appelée quand le joueur dismiss la modale boss vaincu. */
window.demarrerJeu = function(callbackRetour, callbackBossVaincu) {
  if (jeuActif) window.arreterJeu();

  _callbackRetour = callbackRetour || null;
  _callbackBossVaincu = callbackBossVaincu || null;
  jeuActif = true;
  started = true;

  // Canvas
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  resize();

  // Enregistrer les event listeners
  _listenersActifs = [
    ['resize', resize],
    ['keydown', _onKeydownPrincipal],
    ['keyup', _onKeyup],
    ['keydown', _onKeydownParallaxe],
    ['keydown', _onKeydownActions]
  ];
  for (const [evt, fn] of _listenersActifs) addEventListener(evt, fn);

  // Initialiser le monde
  _initialiserMonde();
  _initCheckpoints();
  ephemeresOriginales = null;
  initEphemeres();
  _initTeleporteurs();
  genererParallaxe();

  // Réinitialiser l'état
  deaths = 0; time = 0; tremblement = 0; flashMort = 0;
  clesEnPoche = 0; trinketsCollectes = 0; trinketsRamasses.clear();
  bossGemsCollectes = 0; bossVaincuAffiche = false; bossLoots = [];
  particules = [];
  parallaxeVisible = [true, true, true];
  musiqueInitialisee = false;

  // Lancer le joueur et les entités
  initJoueur();
  initEnnemis();
  initPlateformes();

  // Caméra
  echelle = canvas.height / (LIGNES * TILE);
  vueW = canvas.width / echelle;
  camera.x = joueur.x + joueur.w / 2 - vueW / 2;
  camera.y = 0;

  // Démarrer la musique immédiatement (en SPA, le geste utilisateur a déjà eu lieu)
  startMusic();

  // Boucle de jeu
  _loop();
};

/** Arrête le jeu proprement.
 *  skipCallback : si true, ne pas appeler le callback retour (le boss vaincu gère le retour lui-même). */
window.arreterJeu = function(skipCallback) {
  jeuActif = false;
  started = false;

  // Arrêter la boucle de jeu
  if (loopId) { cancelAnimationFrame(loopId); loopId = null; }

  // Arrêter la musique
  stopMusic();

  // Nettoyer les event listeners
  for (const [evt, fn] of _listenersActifs) removeEventListener(evt, fn);
  _listenersActifs = [];

  // Vider l'état des touches
  for (const k in keys) delete keys[k];

  // Appeler le callback de retour (sauf si skipCallback)
  if (!skipCallback && _callbackRetour) _callbackRetour();
};

// Fermer l'IIFE
})();
