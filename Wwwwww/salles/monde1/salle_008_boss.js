(function() {
/* =============================================
   Salle 8 — Coucou, je suis en rose !
   Salle générée procéduralement (pas de map
   string). Arène de 50 colonnes avec 9
   boutons-lasers (4 au sol, 5 au plafond)
   pour infliger des dégâts au boss (5 HP).
   ============================================= */

// Thème visuel : rouge sang, ambiance de combat final
const THEME = {
  wall: '#f22',
  bg: '#0a0305',
  acc: '#f44',
  name: 'Coucou, je suis en rose !'
};

/**
 * Génère procéduralement la salle du boss.
 *
 * Structure :
 * - 50 colonnes de large, 30 lignes de haut
 * - Murs : lignes 0-1 (plafond, 2 tiles), ligne 29 (sous-sol), ligne 28 (sol), colonne 49 (mur droit)
 * - Colonne 0 ouverte (entrée depuis le niveau précédent)
 * - 9 boutons-lasers (triggers) : 4 au sol (colonnes 8, 18, 28, 38) tirant vers le haut,
 *   5 au plafond (colonnes 5, 13, 23, 33, 43) tirant vers le bas
 * - Le boss spawn à la colonne 40, ligne 12
 *
 * @param {number} ROWS - Nombre de lignes (constante LIGNES = 30)
 * @returns {object} Section parsée avec bossInfo
 */
function buildBossRoom(ROWS) {
  const W = 50;
  const tiles = Array.from({ length: ROWS }, () => new Array(W).fill(0));

  // Bordures : plafond (lignes 0-1, descendu d'un cran pour aligner avec les triggers),
  // sol (ligne 28), sous-sol (ligne 29), mur droit
  for (let c = 0; c < W; c++) {
    tiles[0][c] = 1;
    tiles[1][c] = 1;  // Plafond étendu à la ligne 1
    tiles[ROWS - 1][c] = 1;
  }
  for (let c = 1; c < W; c++) {
    tiles[28][c] = 1;
  }
  for (let r = 0; r < ROWS; r++) {
    tiles[r][W - 1] = 1;
  }

  // Boutons-lasers (triggers)
  // Sol (ligne 28) : tirent vers le haut
  // Plafond (ligne 1) : tirent vers le bas
  const triggers = [];

  // Triggers au sol — couvrent toute la largeur (+ 1 à droite)
  for (const c of [8, 18, 28, 38]) {
    tiles[28][c] = 1;
    tiles[28][c + 1] = 1;
    triggers.push({ col: c, row: 28, dir: 'up' });
  }

  // Triggers au plafond — couvrent toute la largeur (+ 1 à gauche, + 1 à droite)
  for (const c of [5, 13, 23, 33, 43]) {
    tiles[1][c] = 1;
    tiles[1][c + 1] = 1;
    triggers.push({ col: c, row: 1, dir: 'down' });
  }

  // Checkpoint à l'entrée de l'arène (côté gauche, au sol)
  tiles[27][3] = 4;

  // Porte de sortie (mur droit, lignes 25-27 — passage vers le niveau 8)
  tiles[25][W - 1] = 12;
  tiles[26][W - 1] = 12;
  tiles[27][W - 1] = 12;

  return {
    tiles, w: W, en: [], cp: [{ r: 27, c: 3 }], plats: [],
    bossInfo: {
      roomCol: 0,       // Début de la salle du boss (colonne relative)
      roomW: W,          // Largeur de la salle en colonnes
      bossCol: W - 10,  // Position X initiale du boss (colonne 40)
      bossRow: 12,       // Position Y initiale du boss (ligne 12)
      gateCol: 0,        // Colonne de la porte d'entrée (se ferme à l'activation)
      triggers
    }
  };
}

// Musique : Am, 138 BPM — Fièvre Acide, acid techno nerveux et hypnotique
const MUSIC = {
  bpm: 138,
  mel:  ['A4','_','A4','C5','_','A4','E4','_','A4','_','G4','_','A4','C5','E5','_',
         'A4','_','A4','D5','_','A4','G4','_','E4','_','D4','_','E4','G4','A4','_'],
  mel2: ['A5','_','G5','E5','_','G5','A5','_','C6','_','A5','_','G5','E5','D5','_',
         'E5','_','G5','A5','_','C6','D6','_','C6','_','A5','_','G5','_','E5','_'],
  arp:  ['A3','A3','C4','C4','E4','E4','A4','A4','A3','A3','C4','C4','E4','E4','A4','A4',
         'D3','D3','F3','F3','A3','A3','D4','D4','E3','E3','G3','G3','B3','B3','E4','E4'],
  arp2: ['A3','C4','A3','E4','A3','C4','A3','E4','D3','F3','D3','A3','D3','F3','D3','A3',
         'E3','G3','E3','B3','E3','G3','E3','B3','A3','C4','A3','E4','A3','C4','A3','E4'],
  bas:  ['A1','_','A1','A1','_','_','A1','_','A1','_','A1','A1','_','_','A2','_',
         'D1','_','D1','D1','_','_','D1','_','E1','_','E1','E1','_','_','E2','_'],
  bas2: ['A1','A1','_','A1','A2','_','A1','A1','A1','A1','_','A1','A2','_','A1','E1',
         'D1','D1','_','D1','D2','_','D1','A1','E1','E1','_','E1','E2','_','E1','B1'],
  pad:  ['A2','C3','E3'],
  kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
  kick2:[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
  snr:  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
  snr2: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,1],
  hh:   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
  hh2:  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
};

SALLES.push({
  map: null,              // Pas de map string — généré par buildBossRoom()
  theme: THEME,
  music: MUSIC,
  buildRoom: buildBossRoom // Fonction de génération exportée
});
})();
