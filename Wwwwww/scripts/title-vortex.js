// =============================================
// VORTEX DIGITAL — Effet parallaxe écran titre
// Chute de caractères style Matrix + effet vortex
// Synchronisé au BPM du jukebox
// =============================================

(function() {
  const canvas = document.getElementById('title-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // --- Configuration ---
  const CHAR_SET = 'WWWWWWWWWWWWWWWWWWWW01<>{}[]|/\\=+-*&@#$%!?~^';
  const NEON_COLORS = [
    '#0ff', '#f0f', '#0f0', '#ff0', '#f44', '#88f',
    '#f80', '#4ff', '#a0f', '#8f8', '#fa0', '#4fa',
  ];
  const BG_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--couleur-fond').trim() || '#050510';
  const COL_SIZE = 18;        // Largeur d'une colonne en px
  const FONT_SIZE = 16;       // Taille des caractères
  const BASE_SPEED = 2.5;     // Vitesse de base des colonnes
  const NB_LAYERS = 3;        // Couches de profondeur
  const VORTEX_FORCE = 0.3;   // Intensité du vortex
  const PULSE_INTENSITY = 0.4;// Intensité du pulse BPM

  let columns = [];
  let w = 0, h = 0;
  let time = 0;
  let beatPhase = 0;
  let lastBeat = 0;
  let running = true;

  // --- Redimensionnement ---
  function resize() {
    w = canvas.width = innerWidth;
    h = canvas.height = innerHeight;
    initColumns();
  }

  // --- Générateur de colonnes ---
  function initColumns() {
    columns = [];
    const nbCols = Math.ceil(w / COL_SIZE) + 4;

    for (let layer = 0; layer < NB_LAYERS; layer++) {
      const depth = (layer + 1) / NB_LAYERS; // 0.33, 0.66, 1.0
      const speed = BASE_SPEED * (0.3 + depth * 0.7);
      const opacity = 0.15 + depth * 0.55;
      const fontSize = FONT_SIZE * (0.5 + depth * 0.5);

      const count = Math.floor(nbCols * (0.3 + depth * 0.3));
      for (let i = 0; i < count; i++) {
        const baseX = (i / count) * w + (Math.random() - 0.5) * COL_SIZE * 3;
        // Certaines colonnes sont géantes (plus longues, plus grosses, plus lentes)
        const isGiant = Math.random() < 0.08;
        const giantMult = isGiant ? 1.8 : 1;
        const col = {
          x: baseX,
          baseX: baseX,
          y: Math.random() * h * 2 - h,
          speed: speed * (0.6 + Math.random() * 0.8) * (isGiant ? 0.6 : 1),
          layer: layer,
          depth: depth,
          opacity: opacity * (isGiant ? 1.2 : 1),
          fontSize: fontSize * giantMult,
          color: NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)],
          chars: [],
          length: isGiant ? (25 + Math.floor(Math.random() * 20)) : (8 + Math.floor(Math.random() * 18)),
          phase: Math.random() * Math.PI * 2,
          giant: isGiant,
        };
        // Pré-générer les caractères de la traînée
        for (let j = 0; j < col.length; j++) {
          col.chars.push(CHAR_SET[Math.floor(Math.random() * CHAR_SET.length)]);
        }
        columns.push(col);
      }
    }
  }

  // --- BPM sync ---
  function getBPM() {
    return window.jukeboxBPM ? window.jukeboxBPM() : 120;
  }

  function getBeatPulse() {
    const bpm = getBPM();
    const beatDuration = 60 / bpm;
    const phase = (time / 60) % beatDuration / beatDuration;
    // Pulse aigu sur le beat (front raide, décroissance exponentielle)
    return Math.exp(-phase * 6);
  }

  // --- Rendu ---
  function draw() {
    if (!running) return;
    time++;

    const pulse = getBeatPulse();
    const centerX = w / 2;
    const centerY = h / 2;

    // Fond avec traînée (motion blur)
    ctx.fillStyle = `rgba(5,5,16,${0.12 + pulse * 0.06})`;
    ctx.fillRect(0, 0, w, h);

    // Flash de beat subtil
    if (pulse > 0.7) {
      ctx.fillStyle = `rgba(100,100,255,${(pulse - 0.7) * 0.04})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Position du titre "WWWWWW" (centre du h1 ou #titre-w)
    const h1 = document.querySelector('#title h1') || document.getElementById('titre-w');
    let haloX = centerX, haloY = centerY;
    if (h1) {
      const rect = h1.getBoundingClientRect();
      haloX = rect.left + rect.width / 2;
      haloY = rect.top + rect.height / 2;
    }

    // Halo centré derrière le titre (respire avec le beat)
    const haloSize = 120 + pulse * 80;
    const haloGrad = ctx.createRadialGradient(haloX, haloY, 0, haloX, haloY, haloSize);
    const hue = (time * 0.5) % 360;
    haloGrad.addColorStop(0, `hsla(${hue},100%,80%,${0.08 + pulse * 0.12})`);
    haloGrad.addColorStop(0.4, `hsla(${hue + 60},100%,60%,${0.03 + pulse * 0.06})`);
    haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = haloGrad;
    ctx.fillRect(haloX - haloSize, haloY - haloSize, haloSize * 2, haloSize * 2);

    // Vortex : lignes radiales sur le beat, centrées sur le titre
    if (pulse > 0.3) {
      const nbRays = 16;
      ctx.save();
      ctx.translate(haloX, haloY);
      ctx.globalAlpha = (pulse - 0.3) * 0.15;
      for (let i = 0; i < nbRays; i++) {
        const angle = (i / nbRays) * Math.PI * 2 + time * 0.002;
        ctx.strokeStyle = NEON_COLORS[i % NEON_COLORS.length];
        ctx.lineWidth = 1 + pulse * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * w, Math.sin(angle) * h);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- Colonnes de caractères ---
    for (const col of columns) {
      // Vitesse boostée par le beat
      const speedMult = 1 + pulse * PULSE_INTENSITY;
      col.y += col.speed * speedMult;

      // Effet vortex : déviation horizontale en spirale autour du centre
      const dy = (col.y % h + h) % h - centerY;
      const dx = col.baseX - centerX;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const angle = Math.atan2(dy, dx);
      const vortexOffset = Math.sin(angle + time * 0.015 * (1.5 - col.depth)) * VORTEX_FORCE * (300 / dist);
      col.x = col.baseX + vortexOffset * col.depth * 40;

      // Reset quand la colonne sort de l'écran
      if (col.y - col.length * col.fontSize > h) {
        col.y = -col.length * col.fontSize - Math.random() * h * 0.5;
        col.color = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
      }

      // Mutation continue des caractères dans la queue (effet Matrix)
      const nbMut = col.giant ? 5 : 3;
      for (let m = 0; m < nbMut; m++) {
        const idx = 1 + Math.floor(Math.random() * (col.length - 1));
        col.chars[idx] = CHAR_SET[Math.floor(Math.random() * CHAR_SET.length)];
      }

      // Dessiner la traînée de caractères
      ctx.font = `${col.fontSize}px 'Courier New', monospace`;
      for (let j = 0; j < col.length; j++) {
        const charY = col.y - j * col.fontSize;
        if (charY < -col.fontSize || charY > h + col.fontSize) continue;

        // Opacité : tête brillante, queue qui s'efface
        const headFactor = j === 0 ? 1.4 : (1 - j / col.length);
        const finalOpacity = col.opacity * headFactor * (0.7 + pulse * 0.3);

        if (j === 0) {
          // Tête de colonne : toujours un W blanc brillant
          col.chars[0] = 'W';
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, finalOpacity)})`;
        } else if (j <= 2) {
          // Juste après la tête : couleur vive
          ctx.fillStyle = hexToRgba(col.color, Math.min(1, finalOpacity));
        } else {
          // Corps : couleur avec opacité décroissante
          ctx.fillStyle = hexToRgba(col.color, Math.min(1, finalOpacity * 0.7));
        }

        ctx.fillText(col.chars[j], col.x, charY);
      }
    }

    // --- Scanlines CRT ---
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let sy = 0; sy < h; sy += 3) {
      ctx.fillRect(0, sy, w, 1);
    }

    // --- Vignette sombre aux bords ---
    const grad = ctx.createRadialGradient(centerX, centerY, h * 0.3, centerX, centerY, h * 0.9);
    grad.addColorStop(0, 'rgba(5,5,16,0)');
    grad.addColorStop(1, 'rgba(5,5,16,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    requestAnimationFrame(draw);
  }

  // --- Utilitaire hex → rgba ---
  function hexToRgba(hex, alpha) {
    let r, g, b;
    if (hex.length === 4) {
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

  // --- Démarrage / arrêt ---
  function start() {
    running = true;
    canvas.style.display = 'block';
    resize();
    draw();
  }

  function stop() {
    running = false;
    canvas.style.display = 'none';
  }

  // Exposer globalement pour engine.js
  window.titleVortexStart = start;
  window.titleVortexStop = stop;

  // Écouter le resize
  addEventListener('resize', () => { if (running) resize(); });

  // Ne pas démarrer automatiquement — c'est l'appelant qui décide via titleVortexStart()
  // L'ancien comportement (start immédiat) est remplacé par un démarrage explicite.
})();
