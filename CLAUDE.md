# Jeu de plateforme WWWWWW

## Vue d'ensemble
WWWWWW est un jeu inspiré du jeu VVVVVV créé par Terry Cavanagh en 2010.
C'est un jeu de plateforme 2D dont la mécanique centrale repose sur l'inversion de gravité, à travers un monde ouvert composé de salles interconnectées.

## 1. Mécanique principale — Inversion de gravité
- **Pas de saut** : le seul mouvement vertical est l'inversion de gravité (barre espace).
- Le joueur ne peut inverser la gravité que **lorsqu'il touche une surface solide** (sol ou plafond). Il est impossible d'inverser en plein vol.
- La gravité est **binaire** : totalement vers le bas ou totalement vers le haut. Pas d'états intermédiaires.
- Les contrôles sont **gauche, droite, et espace** — trois inputs seulement.
- Le mouvement est **précis et sans inertie** : l'arrêt est immédiat, pas de glissement. Cette réactivité est essentielle pour le niveau de précision demandé.
- Le sprite du personnage s'inverse visuellement : le sourire en "V" devient une moue inversée.

## 2. Structure du monde

### 2.0 Organisation multi-monde
- Le jeu est composé de **8 mondes**, chacun contenant **8 salles** (64 salles au total).
- Chaque monde est un ensemble autonome avec ses propres salles, thèmes et musiques.
- Le **monde 1 est terminé** (salles 001 à 008, incluant le boss).
- Les mondes sont séparés en **dossiers distincts** (`salles/monde1/`, `salles/monde2/`, etc.).
- La **page d'accueil** est indépendante des mondes : elle permet de sélectionner un monde avant de lancer le jeu.
- La progression entre mondes est séquentielle : terminer le boss d'un monde débloque le suivant.

### 2.1 Système de salles
- Chaque monde est découpé en **8 salles** reliées, dans lesquelles il est possible de naviguer (le joueur peut naviguer dans les grandes salles, qui défilent à l'écran).
- Chaque salle a son propre thème de couleur et sa musique.
- Le plateau des salles est proposé en "String Art". D'autres sont à génération procédurale.
- La **dernière salle de chaque monde** (salle 8) comporte un boss avec des mécaniques avancées.
- **Chargement dynamique** : seule la salle courante et ses deux voisines (avant/après) sont actives. Les salles lointaines sont déchargées (ennemis/plateformes gelés, tiles non rendues) pour préserver les performances. Un **brouillard progressif** masque les bords des salles chargées pour éviter un changement brutal.
- **Confinement des ennemis** : chaque ennemi est lié à sa salle d'origine et fait demi-tour à ses frontières — il ne peut jamais passer dans une salle voisine.

### 2.2 Noms de salles
- Chaque salle possède un **nom unique** affiché en haut à gauche, à côté de la progression générale et du nombre de clés.
- Les noms sont en français, humoristiques, référentiels ou thématiques.
- Ces noms servent à la fois de repères de navigation et de personnalité au jeu.

## 3. Obstacles, mécaniques et ennemis

### 3.1 Plateformes solides
- Le joueur marche sur des plateformes solides fixes `#`.
- Face à un mur, le joueur doit utiliser espace pour inverser la gravité et le contourner.
- Certaines plateformes peuvent être mobiles, éphémères (voir ci-dessous).

### 3.2 Plateformes mobiles (`=`, `~`)
Plateformes solides qui se déplacent le long de rails.
- **`=`** : plateforme lente (0.8 px/frame). **`~`** : plateforme rapide (1.6 px/frame).
- La **largeur** est définie par le nombre de caractères consécutifs : `===` = 3 tiles.
- La **direction** est déterminée par les **rails** adjacents :
  - Rails `|` verticaux (au-dessus/en-dessous) → déplacement **vertical**. La plateforme oscille entre la ligne du premier `|` et la ligne du dernier `|`.
  - Rails `-` horizontaux (à gauche/droite, même ligne) → déplacement **horizontal**. La plateforme oscille entre la colonne du premier `-` et la colonne du dernier `-`.
- Les rails sont **invisibles en jeu** (consommés par le parser).
- Le joueur est **porté** par la plateforme (déplacement horizontal et/ou vertical appliqué).
- Exemples dans le string design :
```
Vertical :          Horizontal :
##...|...##        ##..--===--..##
##...|...##
##...===.##
##...|...##
##...|...##
```

### 3.3 Plateformes éphémères (`@`)
- Blocs solides qui **disparaissent ~0.8s après contact** avec le joueur.
- Pendant la phase de disparition : **fondu progressif + tremblement** visuel.
- Après disparition, la plateforme **réapparaît ~3s plus tard** (permet des puzzles rythmiques).
- Se comportent comme un mur solide (`#`) tant qu'elles sont actives.
- Toutes les plateformes éphémères sont **réinitialisées au respawn**.

### 3.4 Pics (obstacles fixes)

- Des pics rouges `!` tuent instantanément au contact. Le joueur respawn au dernier checkpoint activé.
- Les pics sont souvent adjacents à des murs (`#!` ou `!#`). Leur orientation dépend du mur adjacent :
  - Mur en dessous → pic pointant vers le haut
  - Mur au-dessus → pic pointant vers le bas
  - Mur latéral unique → pic pointant dans la direction opposée
  - Pas de mur ou ambiguïté latérale → "losange" (pic volant)
- **Priorité de résolution** : mur du bas > mur du haut > latéral > losange.

### 3.5 Tapis roulants
- Surfaces qui poussent le joueur vers la gauche ou la droite.
- Tapis roulant lent : `]` (droite) et `[` (gauche) — vitesse inférieure au déplacement du joueur.
- Tapis roulant rapide : `)` (droite) et `(` (gauche) — vitesse supérieure au déplacement du joueur.

### 3.6 Lignes de gravité (`G`)
- Lignes horizontales fines (~4px) **traversables** (non solides), affichant un arc-en-ciel spatial défilant.
- Traverser une ligne inverse **automatiquement** la gravité du joueur, même en plein vol (sans contact avec le sol).
- Un **cooldown de 15 frames** (~0.25s) empêche les doubles inversions accidentelles lors d'un passage lent.
- Rendu : dégradé HSL le long de la tile avec glow lumineux.

### 3.7 Clés et portes
- Clés `K` : collectibles que le joueur ramasse.
- Portes `P` : blocs destructibles. Toucher une porte avec une clé en poche la détruit, ainsi que les blocs adjacents en cascade (animation).

### 3.8 Téléporteurs (`1`–`9`)
- **Paires** de téléporteurs identifiées par un chiffre (`1` à `9`) dans le string design de la salle.
- Chaque chiffre doit apparaître **exactement 2 fois** dans une salle. S'il apparaît 1 ou 3+ fois, la paire est ignorée.
- Maximum **9 paires** par salle (chiffres 1 à 9).
- Les téléporteurs sont **intra-salle uniquement** : pas de téléportation entre salles.
- Quand le joueur touche un téléporteur, il est **instantanément déplacé** à l'autre téléporteur de la paire. Sa vitesse est conservée (il peut poursuivre sa chute).
- Un **cooldown de 20 frames** empêche les boucles de téléportation.
- Visuellement, chaque paire a un **code couleur unique** et affiche son chiffre au centre.

### 3.9 Ennemis mobiles
Quatre types d'ennemis, définis par couleur et comportement :

| Code | Type | Mouvement | Vitesse |
|------|------|-----------|---------|
| `r` | Alien rose | Linéaire | Constante |
| `R` | Alien rose foncé | Sinusoïdal | Constante |
| `v` | Alien vert | Linéaire | Variable (accélérations/décélérations) |
| `V` | Alien vert foncé | Sinusoïdal | Variable (accélérations/décélérations) |

- Un ennemi placé seul (sans indicateur de direction) se déplace en cercle (rayon de 4 blocs).
- Les ennemis peuvent se déplacer en **ligne droite** selon 4 axes, avec un indicateur de direction adjacent :
  - `r>` ou `<r` : direction horizontale
  - `^` au-dessus ou `v` en dessous : direction verticale (les directions `^` et `v` sont placées sur la ligne au-dessus ou en dessous de l'alien)
- Lorsqu'un ennemi rencontre un mur, sa direction s'inverse.

### 3.10 Autres obstacles (à implémenter)
- **Murs mobiles / Broyeurs** : blocs qui se déplacent pour écraser ou bloquer le joueur. *(Non encore implémenté.)*

## 4. Système de difficulté

### 4.1 Mort instantanée
- Tout contact avec un pic, un ennemi ou un obstacle = **mort immédiate**. Pas de points de vie, pas de dégâts, pas de frames d'invincibilité.

### 4.2 Checkpoints généreux
- Les checkpoints sont représentés par `C` (petit terminal/pôle) et s'activent au toucher.
- Placement **extrêmement fréquent** : au moins un au début de chaque salle, et avant chaque passage difficile.
- Le respawn est **instantané** : un bref flash, et le joueur est de retour. Aucun écran de mort, aucun chargement.
- **Gravité automatique** : au respawn, la gravité est ajustée selon la plateforme accolée au checkpoint (sol en dessous → gravité normale, sol au-dessus → gravité inversée). La fonction `graviteInverseeA()` est utilisée.
- **Checkpoints au plafond** : un checkpoint peut être placé au plafond. Son dessin est alors inversé (pilier pendant vers le bas).
- **Spawn initial** : le joueur apparaît au checkpoint le plus à gauche de la première salle en début de partie (pas de tile de spawn dédiée).

### 4.3 Pas de système de vies
- **Vies infinies**. Le joueur peut mourir autant de fois que nécessaire sans pénalité.
- Un **compteur de morts** global comptabilise les décès. Les joueurs accumulent typiquement **500 à 1500+ morts** lors d'une première partie.
- Ce compteur est un badge d'honneur, pas une punition.

### 4.4 Boucle de gameplay
- La combinaison mort instantanée + respawn instantané + checkpoints fréquents crée une boucle **"encore un essai"** qui maintient la frustration basse malgré la difficulté élevée.

### 4.5 Courbe de difficulté
- Les premières zones enseignent la mécanique en douceur.
- La difficulté monte significativement dans les zones avancées et les défis optionnels (trinkets).
- Le chemin principal est exigeant mais accessible grâce aux checkpoints.

## 5. Collectibles — Trinkets

- **20 trinkets** disséminés dans le monde, dans des emplacements difficiles d'accès ou cachés.
- Certains trinkets exigent des prouesses de précision extrême.

## 6. Direction artistique

### 6.1 Style visuel et couleurs
- Pixel art rétro inspiré du **Commodore 64** et du **ZX Spectrum** (années 80). Ce n'est **pas** un style NES.
- Graphismes simples et en blocs. Apparence "néon".
- Chaque zone utilise une **palette limitée et distincte**. Fonds sombres unis, couleurs vives contrastées.

### 6.2 Design du joueur
- Petit humanoïde cyan avec un large **sourire en V** qui s'inverse avec la gravité.

### 6.3 Bande-son
- Inspirée de **Magnus Pålsson (SoulEye)**.
- Style **chiptune/synthétique** : sons MIDI/MOD, synthétiseur, game boy. Chaque salle a sa propre musique.

### 6.4 Effets sonores
- Minimalistes, style rétro : bleeps et bloops. Son de mort distinctif, carillon de checkpoint, signal d'inversion de gravité.

## 7. Architecture technique

### 7.1 Stack
- **HTML5 Canvas 2D** pour le rendu — tout est dessiné en primitives, aucune image externe.
- **Web Audio API** pour le son — toute la musique et les effets sont synthétisés procéduralement, aucun fichier audio.
- **Zéro dépendance externe**. Pas de framework, pas de bibliothèque, pas de bundler.

### 7.2 Affichage plein écran et mise à l'échelle
Le jeu occupe **100 % de la fenêtre du navigateur** en permanence. Les 30 lignes (`LIGNES`) de chaque salle remplissent toujours toute la hauteur disponible.
- Le moteur utilise un **système de coordonnées logiques** interne (basé sur `TILE = 24`). Toute la physique, les collisions et le positionnement opèrent dans cet espace logique.
- Au rendu, un **facteur d'échelle** (`echelle = viewport_height / (LIGNES × TILE)`) est appliqué via `ctx.scale()` pour projeter le monde logique sur le canvas physique.
- La **largeur visible** (`vueW = viewport_width / echelle`) est dynamique et dépend des dimensions de la fenêtre. La caméra défile horizontalement dans le monde ; verticalement, toutes les lignes sont toujours visibles (pas de défilement vertical).
- Le **HUD** (texte, barres de progression) est dessiné après `ctx.restore()`, directement en coordonnées écran physiques, et n'est donc pas affecté par le scaling.

### 7.3 Chargement dynamique des salles
Seules **3 salles au maximum** sont actives simultanément : la salle courante (`salleIdx`) et ses deux voisines (`salleMin = salleIdx - 1`, `salleMax = salleIdx + 1`).
- **Mise à jour** : les ennemis et plateformes mobiles des salles inactives ne sont ni mis à jour ni testés en collision. Cela allège la boucle de jeu.
- **Rendu** : seules les tiles dans la plage `[colActifDebut, colActifFin]` sont dessinées. Les colonnes hors de cette plage sont ignorées.
- **Brouillard progressif** : un dégradé de `FOG_TILES = 4` tiles de large est dessiné aux extrémités de la zone active (sauf au tout début et à la toute fin du monde). Le dégradé va de la couleur de fond (opaque, côté extérieur) à transparent (côté intérieur), masquant la frontière de chargement.
- **Confinement des ennemis** : chaque ennemi porte un attribut `salle` (index de sa salle d'origine). Ses bornes de patrouille horizontales sont clampées aux frontières de cette salle (`offsetsSalles[salle] * TILE` à `(offsetsSalles[salle] + largeursSalles[salle]) * TILE`). Il fait demi-tour à la frontière et ne peut jamais passer dans une salle voisine.

### 7.4 Fichiers

| Fichier | Rôle |
|---------|------|
| `index.html` | Page d'accueil globale. Affiche l'écran titre et la sélection de monde. Indépendante du moteur de jeu. |
| `WWWWWW.html` | Point d'entrée d'un monde. Charge les scripts dans l'ordre (salles du monde courant puis moteur), déclare le registre global `SALLES = []`. Reçoit le monde à charger via paramètre URL (`?monde=1`). |
| `css/style.css` | Styles de l'écran titre (glow cyan, animation pulsante) et du canvas (rendu pixelisé). |
| `scripts/engine.js` | Moteur complet : boucle de jeu, physique, collisions, rendu, caméra, ennemis, boss, particules, musique, SFX. |
| `scripts/title-vortex.js` | Effet visuel vortex de l'écran titre. |
| `scripts/jukebox.js` | Jukebox : définition des morceaux musicaux référencés par les salles via `window.JUKEBOX_PAR_NOM`. |
| `salles/monde1/salle_001_nom.js` | Définition d'une salle du monde 1. Chaque fichier fait `SALLES.push({...})`. |
| `salles/monde2/salle_001_nom.js` | Idem pour le monde 2, etc. (8 dossiers `monde1/` à `monde8/`). |

### 7.5 Séquence de démarrage
1. Le joueur arrive sur `index.html` (page d'accueil) et sélectionne un monde
2. Redirection vers `WWWWWW.html?monde=N`
3. Le HTML charge dynamiquement les 8 `salle_*.js` du monde N → remplissage du tableau global `SALLES[]`
4. `engine.js` se charge en dernier : fusionne toutes les salles en un monde contigu via `assemblerMonde()`, initialise le joueur, les ennemis, les plateformes
5. La boucle `requestAnimationFrame` démarre, attend ESPACE pour commencer

## 8. Format des salles

### 8.1 Structure d'un fichier salle
Chaque fichier appelle `SALLES.push()` avec un objet contenant :
```js
{
  map: [/* tableau de strings : la grille */],
  theme: { wall: '#couleur', bg: '#couleur', acc: '#couleur', name: 'Nom' },
  music: { bpm, mel, mel2, arp, arp2, bas, bas2, pad, kick, kick2, snr, snr2, hh, hh2 },
  buildRoom: function(LIGNES) { ... }  // optionnel, pour les salles procédurales (boss)
}
```

### 8.2 Grille (map)
- Tableau de strings, chaque string étant une ligne de la grille.
- **30 lignes** de hauteur (constante `LIGNES = 30`).
- **Largeur dynamique** : déduite automatiquement de la longueur de la première string (`rows[0].length`). Chaque salle peut avoir un nombre de colonnes différent.
- Les salles sont fusionnées bout à bout par `assemblerMonde()` avec **chevauchement d'une colonne** pour assurer la continuité des passages.

### 8.3 Thème
Chaque salle définit un thème visuel :
- `wall` : couleur des murs
- `bg` : couleur de fond
- `acc` : couleur d'accent (joueur, particules, HUD)
- `name` : nom affiché en jeu

### 8.4 Musique procédurale
Les morceaux sont définis dans `scripts/jukebox.js` et référencés par les salles via `window.JUKEBOX_PAR_NOM['Nom du morceau']`. Seule la salle du boss (salle 8) définit sa musique inline.

Chaque morceau contient ces patterns :
- `mel`/`mel2` : mélodie couplet/refrain (32 notes en notation scientifique, `'_'` = silence)
- `arp`/`arp2` : arpège couplet/refrain
- `bas`/`bas2` : basse couplet/refrain
- `pad` : accord soutenu (tableau de 3 notes)
- `kick`/`kick2`, `snr`/`snr2`, `hh`/`hh2` : patterns rythmiques (tableaux de 32 × 0/1)
- Le séquenceur alterne couplet (steps 0–31) et refrain (steps 32–63) en boucle.

## 9. Référence des codes tuiles

### 9.1 Caractères de la grille → codes numériques

| Caractère | Code | Signification |
|-----------|------|---------------|
| `.` ou ` ` | 0 | Vide |
| `#` | 1 | Mur solide (bloque le mouvement) |
| `!` | 13 → 2/3/7/8/14 | Pic non résolu (orienté automatiquement au build) |
| `C` | 4 | Checkpoint |
| `G` | 5 | Ligne de gravité (traversable, inverse la gravité au passage, cooldown 15 frames) |
| `)` | 6 | Tapis roulant rapide → droite (boost 3.2, emporte le joueur) |
| `]` | 9 | Tapis roulant lent → droite (boost 1.5) |
| `[` | 10 | Tapis roulant lent → gauche (boost 1.5) |
| `(` | 15 | Tapis roulant rapide → gauche (boost 3.2, emporte le joueur) |
| `K` | 11 | Clé |
| `P` | 12 | Porte (destructible avec une clé, cascade aux portes adjacentes) |
| `T` | 16 | Trinket (collectible, persiste au respawn) |
| `@` | 17 | Plateforme éphémère (disparaît ~0.8s après contact, réapparaît ~3s) |
| `=` | *(pas de tile)* | Plateforme mobile lente (0.8 px/frame). Largeur = nb de `=` consécutifs |
| `~` | *(pas de tile)* | Plateforme mobile rapide (1.6 px/frame). Largeur = nb de `~` consécutifs |
| `|` | *(pas de tile)* | Rail vertical (borne de déplacement d'une plateforme mobile) |
| `-` | *(pas de tile)* | Rail horizontal (borne de déplacement d'une plateforme mobile) |
| `1`–`9` | *(pas de tile)* | Téléporteurs : paires intra-salle, exactement 2 par chiffre |

### 9.2 Codes de pics résolus

| Code | Orientation | Condition |
|------|-------------|-----------|
| 2 | Pointe vers le haut | Mur en dessous |
| 3 | Pointe vers le bas | Mur au-dessus |
| 7 | Pointe vers la gauche | Mur à droite uniquement |
| 8 | Pointe vers la droite | Mur à gauche uniquement |
| 14 | Losange (pic volant) | Aucun mur adjacent clair |

### 9.3 Codes ennemis
Les caractères `r`, `R`, `v`, `V` définissent des ennemis (voir §3.6). Les caractères `<`, `>`, `^` servent d'indicateurs de direction adjacents. Le parsing est en trois phases :
1. **Phase horizontale** : paires `type>` ou `<type` (prioritaire, non ambiguë)
2. **Phase verticale** : `^` au-dessus ou `v` en dessous du type (uniquement si non consommé en phase 1)
3. **Phase circulaire** : tout ennemi restant sans direction adjacente reçoit `dir: 'circle'` et se déplace en orbite circulaire de rayon 4 blocs autour de sa position d'origine

## 10. Constantes du moteur

### 10.1 Physique
| Constante | Valeur | Description |
|-----------|--------|-------------|
| Gravité | 0.28 px/frame² | Accélération verticale |
| Vitesse max chute | 5 px/frame | Vitesse terminale |
| Vitesse joueur | 2.2 px/frame | Déplacement horizontal |
| Boost convoyeur lent | ±1.5 px/frame | Ajout au mouvement horizontal (joueur peut résister) |
| Boost convoyeur rapide | ±3.2 px/frame | Emporte le joueur (supérieur à sa vitesse de 2.2) |
| Coyote time | 6 frames | Délai de grâce après avoir quitté une surface |
| Buffer d'input | 12 frames | Durée de mémorisation d'un appui espace |
| Cooldown ligne de gravité | 15 frames | Anti-double inversion après traversée d'une ligne G |

### 10.2 Dimensions
| Élément | Taille |
|---------|--------|
| Tile | 24×24 px |
| Joueur (hitbox) | 16×20 px |
| Ennemi (hitbox) | 16×16 px |
| Boss (hitbox) | 72×72 px |
| Hauteur du monde | 30 lignes (constante `LIGNES`) |

### 10.3 Mise à l'échelle
| Variable | Formule | Description |
|----------|---------|-------------|
| `echelle` | `canvas.height / (LIGNES × TILE)` | Facteur de scaling monde → écran |
| `vueW` | `canvas.width / echelle` | Largeur visible en unités logiques |

### 10.4 Caméra
| Paramètre | Valeur |
|-----------|--------|
| Interpolation horizontale | 0.08 |
| Lead-ahead horizontal | `joueur.vx × 20` px |
| Défilement vertical | Aucun (`camera.y = 0`, les 30 lignes sont toujours visibles) |

### 10.5 Ennemis
| Paramètre | Valeur |
|-----------|--------|
| Vitesse de base (rose/rose foncé) | 0.85 px/frame |
| Vitesse de base (vert/vert foncé) | 2.4 px/frame |
| Oscillation vitesse (vert) | `sin(timer × 0.025)` |
| Oscillation perpendiculaire (foncé) | `sin(timer × 0.04) × 25` px |

## 11. Système de boss

### 11.1 Arène
- Générée procéduralement par `buildBossRoom(LIGNES)` dans la salle 8.
- 50 colonnes × 30 lignes. Murs au plafond (lignes 0–1), au sol (ligne 28) et à droite (colonne 49). Entrée ouverte à gauche.

### 11.2 Triggers laser
- 9 boutons : 4 au sol (ligne 28, colonnes 8/18/28/38 → tir vers le haut) et 5 au plafond (ligne 1, colonnes 5/13/23/33/43 → tir vers le bas).
- Chaque trigger est large de 2 tiles. Cooldown de 90 frames après activation.
- Le joueur marche dessus pour déclencher un laser vertical. Si le laser touche le boss → dégâts.

### 11.3 Boss
- **5 HP**. Invincible 60 frames après chaque hit.
- Déplacement en courbe de Lissajous à travers l'arène.
- Après un hit, le multiplicateur de vitesse passe à 6.0 puis décroît progressivement.

### 11.4 Patterns d'attaque (cycle de 6 phases)
| Phase | Couleur | Attaque |
|-------|---------|---------|
| 0 | Violet | Mur horizontal de projectiles avec un trou aléatoire |
| 2 | Orange | 3–10 projectiles ciblés vers le joueur (nombre croissant avec les dégâts subis) |
| 4 | Jaune | 18 projectiles en cercle (radial) |
| 1, 3, 5 | — | Pauses entre les attaques |

- Avant chaque attaque : phase de charge de 2 temps musicaux (boss immobile, tremblement visuel).

## 12. Conventions de nommage

Le code utilise un vocabulaire **français uniforme** aligné sur ce document. Lexique de correspondance :

| Concept | Variable/fonction dans le code |
|---------|-------------------------------|
| Salle (unité de niveau) | `SALLES`, `salles/salle_*.js`, `parserSalle()`, `salleIdx`, `nbSalles`, `offsetsSalles` |
| Monde (toutes salles assemblées) | `monde`, `assemblerMonde()`, `MONDE_COLS`, `MONDE_W`, `MONDE_H` |
| Grille (tiles du monde) | `grille` (variable locale dans `assemblerMonde()`, propriété retournée) |
| Joueur | `joueur` (objet global) |
| Propriétés joueur | `.inverse`, `.auSol`, `.gravite`, `.maxChute`, `.spawnX/Y`, `.checkX/Y`, `.trainee`, `.surPlateforme` |
| Tile | `TILE` (constante 24px) |
| Lignes | `LIGNES` (constante 30) |
| Canvas | `canvas`, `ctx` |
| Ennemis | `ennemis`, `initEnnemis()` |
| Plateformes mobiles | `plateformesMobiles`, `initPlateformes()` |
| Particules | `particules`, `emettreParticules()` |
| Clés en poche | `clesEnPoche` |
| Tremblement (screen shake) | `tremblement` |
| Caméra | `camera`, `mettreAJourCamera()` |
| Helpers tiles | `getTile()`, `estSolide()`, `estDangereux()`, `chevauche()` |
| Pic (obstacle) | `dessinerPic()` |
| Redémarrage | `recommencer()` |
| Constantes de timing | `FLIP_BUFFER`, `COYOTE_FRAMES` |
| Mise à l'échelle | `echelle`, `vueW` |
| Chargement dynamique | `largeursSalles`, `salleMin`, `salleMax`, `salleDeColonne()`, `FOG_TILES`, `bgAvecAlpha()` |
| Salle d'ennemi | `ennemi.salle` (attribut sur chaque ennemi/plateforme) |
| Mouvement circulaire | `ennemi.isCircle` |
| Trinkets | `trinketsCollectes`, `TRINKETS_TOTAL`, `trinketsRamasses` (Set) |
| Cascade portes | `detruirePorteCascade()` |
| Plateformes éphémères | `ephemeres[]`, `initEphemeres()`, `EPH_DELAI`, `EPH_REAPPEAR` |
| Lignes de gravité | `gravLineCooldown`, `GRAV_LINE_CD` |
| Détection gravité | `graviteInverseeA(px, py)` — retourne `true` si sol au-dessus |
| Téléporteurs | `teleporteurs[]`, `TP_COOLDOWN`, `TP_COLORS` |
| Audio | `audioCtx`, `musiqueActive`, `noteVersHz()` |

**Règles** :
- Les **noms de fonctions et variables** utilisent le français quand le terme est un concept de gameplay (salle, joueur, ennemi, pic, etc.) ou un helper (estSolide, chevauche, etc.).
- Les **termes musicaux universels** restent en anglais : `pLead`, `pArp`, `pBass`, `pPad`, `pKick`, `pSnare`, `pHH`, `pStab`.
- Les **propriétés internes de bas niveau** (coordonnées `x`, `y`, `vx`, `vy`, `w`, `h`, `speed`, `timer`, etc.) restent en anglais par convention.
- Les **commentaires** sont systématiquement en français.
