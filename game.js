// Minimal but featureful game.js
// - Player fires only in facing direction unless omni power-up is active
// - Enemies have varied speed and HP
// - Enemies can drop power-ups on death
// - Spawn rate scales with score, and active enemies are capped at 20

const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 600;
canvas.style.width = '800px';
canvas.style.height = '600px';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

// Create retry button (hidden until game over)
const retryButton = document.createElement('button');
retryButton.textContent = 'Retry';
retryButton.style.position = 'fixed';
retryButton.style.left = '50%';
retryButton.style.transform = 'translateX(-50%)';
retryButton.style.top = '60%';
retryButton.style.padding = '12px 24px';
retryButton.style.fontSize = '20px';
retryButton.style.zIndex = 9999;
retryButton.style.display = 'none';
retryButton.style.cursor = 'pointer';
retryButton.style.background = '#222';
retryButton.style.color = 'white';
retryButton.style.border = '2px solid white';
retryButton.style.borderRadius = '8px';
document.body.appendChild(retryButton);
retryButton.addEventListener('click', () => {
  retryButton.style.display = 'none';
  resetGame();
  requestAnimationFrame(gameLoop);
});

// Dash on-screen button (shows ready/cooldown and triggers dash)
const dashButton = document.createElement('button');
dashButton.textContent = 'Dash';
dashButton.style.position = 'fixed';
dashButton.style.right = '18px';
dashButton.style.bottom = '18px';
dashButton.style.padding = '10px 14px';
dashButton.style.fontSize = '16px';
dashButton.style.zIndex = 9999;
dashButton.style.cursor = 'pointer';
dashButton.style.borderRadius = '8px';
dashButton.style.background = '#333';
dashButton.style.color = 'white';
dashButton.style.border = '2px solid white';
dashButton.addEventListener('click', () => { tryDash(); });
document.body.appendChild(dashButton);

function resizeCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.min(w / canvas.width, h / canvas.height, 1);
  canvas.style.width = Math.round(canvas.width * scale) + 'px';
  canvas.style.height = Math.round(canvas.height * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// State
const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 18,
  speed: 4,
  color: 'deepskyblue',
  baseCooldown: 12,
  shootCooldown: 0,
  bulletDamage: 1,
  facing: { x: 0, y: -1 },
  omniShot: false,
  fireRateModifier: 1
};
// dash state defaults
player.isDashing = false;
player.dashTimer = 0;
player.dashDuration = 18; // frames
player.dashSpeed = 14; // dash velocity magnitude
player.dashDir = { x: 0, y: -1 };
player.dashCooldown = 0;
player.chargeMode = false;
player.chargeHold = 0;
player.lastSpaceDown = false;

// track enemies passed during a dash for dash-kill/damage bonus
player.dashEnemiesPassed = new Set();
player.lastDashFrame = 0;

const bullets = [];
const enemies = [];
const powerUps = [];
const activePowerUps = [];
const orbitals = []; // rotating orbitals around player
const clones = [];
const lasers = []; // temporary laser visuals
const turrets = []; // temporary player turrets
const walls = []; // rectangular obstacles that spawn periodically
const explosions = []; // bomb explosions
const swordArcs = []; // active sword arcs (melee swings)
const particles = []; // visual particles (used for invincibility)
const enemyProjectiles = []; // projectiles fired by enemies/boss
// Boss state
let boss = null;
let bossWarning = null;
let bossTimer = 3600; // 60s at 60fps
// screen shake state
const screenShake = { time: 0, duration: 0, intensity: 0 };

function triggerScreenShake(intensity = 6, duration = 12) {
  screenShake.time = duration;
  screenShake.duration = duration;
  screenShake.intensity = intensity;
}
// particles already present (declared above)
let keys = {};
let shootRequested = false; // request a single shot when true (set from key or mouse)
let score = 0;
let enemySpawnTimer = 90;
let isGameOver = false;
let wallSpawnTimer = 1800; // 30s at 60fps
const cornerBoxes = []; // special guaranteed power-up boxes that appear in corners
let cornerBoxTimer = randomInt(1200, 2400); // 20-40s
let elapsedFrames = 0;
let enemyIdCounter = 0;
let permanentBoostGranted = false;
let bossEncounterCount = 0;

// helper: revert a power-up's effect immediately
function revertPowerUp(type) {
  switch (type) {
    case 'omni': player.omniShot = false; break;
    case 'rapid': player.fireRateModifier = 1; break;
    case 'damage': player.bulletDamage = Math.max(1, player.bulletDamage - 1); break;
    case 'trishot': player.triShot = false; break;
    case 'boomerang': player.boomerang = false; break;
    case 'orbital': orbitals.length = 0; break;
    case 'speed': player.speed = Math.max(1, player.speed - 2); break;
    case 'clone': /* clones expire on their own */ break;
    case 'halfomni': player.halfOmni = false; break;
    case 'laser': player.laser = false; break;
    case 'charge': player.chargeMode = false; player.chargeHold = 0; player.lastSpaceDown = false; break;
    case 'invincible': player.invincible = false; break;
    case 'bombs': player.bombMode = false; break;
    case 'sword': player.swordMode = false; break;
    case 'knives': player.knivesMode = false; break;
    case 'permanent_boost': /* permanent marker, no revert */ break;
    case 'dash_damage': player.bulletDamage = Math.max(1, player.bulletDamage - 1); break;
    default: break;
  }
}

// Navigation grid for simple A* pathfinding around walls
let navGrid = null;
let navCols = 0, navRows = 0;
const navCellSize = 36; // tile size for pathfinding (adjustable)
let navNeedsRebuild = true;

function buildNavGrid() {
  navCols = Math.ceil(canvas.width / navCellSize);
  navRows = Math.ceil(canvas.height / navCellSize);
  navGrid = new Array(navCols);
  for (let gx = 0; gx < navCols; gx++) {
    navGrid[gx] = new Array(navRows);
    for (let gy = 0; gy < navRows; gy++) {
      const cx = gx * navCellSize + navCellSize / 2;
      const cy = gy * navCellSize + navCellSize / 2;
      // consider cell blocked if center overlaps a wall rectangle (use a small radius)
      let blocked = false;
      for (const w of walls) {
        if (rectCircleCollide(w.x, w.y, w.w, w.h, cx, cy, navCellSize * 0.45)) { blocked = true; break; }
      }
      navGrid[gx][gy] = !blocked;
    }
  }
  navNeedsRebuild = false;
}

// Simple A* on the grid (4-neighbor). Returns array of grid coords [{x,y},...] or null if no path.
function findPath(sx, sy, tx, ty) {
  if (navNeedsRebuild || !navGrid) buildNavGrid();
  const startX = Math.max(0, Math.min(navCols - 1, Math.floor(sx / navCellSize)));
  const startY = Math.max(0, Math.min(navRows - 1, Math.floor(sy / navCellSize)));
  const endX = Math.max(0, Math.min(navCols - 1, Math.floor(tx / navCellSize)));
  const endY = Math.max(0, Math.min(navRows - 1, Math.floor(ty / navCellSize)));
  if (!navGrid[startX] || !navGrid[startX][startY] || !navGrid[endX] || !navGrid[endX][endY]) return null;

  const open = new Map();
  const closed = new Set();
  function key(x,y){return x+','+y}
  const startKey = key(startX,startY);
  open.set(startKey, { x:startX, y:startY, g:0, h:Math.abs(endX-startX)+Math.abs(endY-startY), f:0, parent: null });
  open.get(startKey).f = open.get(startKey).g + open.get(startKey).h;

  while (open.size > 0) {
    // pick node with lowest f
    let bestK = null; let bestNode = null;
    for (const [k,node] of open) {
      if (!bestNode || node.f < bestNode.f) { bestK = k; bestNode = node; }
    }
    open.delete(bestK);
    closed.add(bestK);
    const node = bestNode;
    if (node.x === endX && node.y === endY) {
      // reconstruct path
      const path = [];
      let cur = node;
      while (cur) { path.push({ x: cur.x, y: cur.y }); cur = cur.parent; }
      path.reverse(); return path;
    }
    // neighbors (4-dir)
    const dirs = [ [1,0],[-1,0],[0,1],[0,-1] ];
    for (const d of dirs) {
      const nx = node.x + d[0], ny = node.y + d[1];
      if (nx < 0 || ny < 0 || nx >= navCols || ny >= navRows) continue;
      const k = key(nx,ny);
      if (closed.has(k)) continue;
      if (!navGrid[nx][ny]) continue; // blocked
      const g = node.g + 1;
      const h = Math.abs(endX - nx) + Math.abs(endY - ny);
      const f = g + h;
      if (open.has(k)) {
        const existing = open.get(k);
        if (g < existing.g) { existing.g = g; existing.f = f; existing.parent = node; }
      } else {
        open.set(k, { x:nx, y:ny, g, h, f, parent: node });
      }
    }
  }
  return null; // no path
}

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Helpers: rectangle-circle collision
function rectCircleCollide(rx, ry, rw, rh, cx, cy, cr) {
  // find closest point to circle center within rectangle
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) <= (cr * cr);
}

function rectCircleCollideAny(cx, cy, cr) {
  for (const w of walls) {
    if (rectCircleCollide(w.x, w.y, w.w, w.h, cx, cy, cr)) return true;
  }
  return false;
}

// draw a simple star shape
function drawStar(x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  // small 4-point star (cross)
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.25, -size * 0.25);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * 0.25, size * 0.25);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.25, size * 0.25);
  ctx.lineTo(-size, 0);
  ctx.lineTo(-size * 0.25, -size * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// spawn a few particles around the player while invincible
function spawnInvincibleParticles() {
  if (!player.invincible) return;
  // spawn a couple per frame, but cap total
  if (particles.length > 120) return;
  const count = randomInt(1, 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.4 + Math.random() * 1.6;
    particles.push({
      x: player.x + Math.cos(angle) * randomInt(6, player.radius + 6),
      y: player.y + Math.sin(angle) * randomInt(6, player.radius + 6),
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      life: randomInt(24, 60),
      size: randomInt(3, 7),
      color: Math.random() < 0.5 ? 'white' : 'gold'
    });
  }
}

function updateParticles() {
  // spawn when invincible
  spawnInvincibleParticles();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.dx; p.y += p.dy; p.life--;
    // slight attraction to player center so they orbit briefly
    const ax = (player.x - p.x) * 0.02; const ay = (player.y - p.y) * 0.02;
    p.dx += ax; p.dy += ay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// Apply a power-up effect consistently and push to activePowerUps when appropriate
function applyPowerUp(type, duration = 600) {
  const active = { type, duration };
  switch (type) {
    case 'omni': player.omniShot = true; break;
    case 'rapid': player.fireRateModifier = 2; break;
    case 'damage': player.bulletDamage += 1; break;
    case 'trishot': player.triShot = true; break;
    case 'boomerang': player.boomerang = true; break;
    case 'orbital':
      // create a ring of orbiting bullets around player
      orbitals.length = 0;
      const ringCount = 8;
      for (let k = 0; k < ringCount; k++) orbitals.push({ angle: (k * Math.PI * 2) / ringCount, dist: 60, color: '#88ff88', radius: 5 });
      break;
    case 'speed': player.speed += 2; break;
    case 'clone': clones.push({ x: player.x + 20, y: player.y + 20, life: duration }); break;
    case 'halfomni': player.halfOmni = true; break;
    case 'laser': player.laser = true; break;
      case 'charge': player.chargeMode = true; break;
    case 'invincible': player.invincible = true; break;
    case 'bombs': player.bombMode = true; break;
    case 'sword': player.swordMode = true; break;
    case 'turret':
      // spawn a temporary turret that follows player and auto-targets enemies
      turrets.push({ x: player.x, y: player.y, life: duration, fireTimer: 0 });
      break;
    case 'dash_damage':
      // temporary damage boost from dashing through enemies
      player.bulletDamage += 1;
      break;
    case 'knives':
      if (player.knivesMode) {
        const exist = activePowerUps.find(x => x.type === 'knives'); if (exist) exist.duration = Math.min(1800, exist.duration + duration);
      } else { player.knivesMode = true; }
      break;
    case 'heal':
      player.health = Math.min(player.maxHealth || 3, (player.health || 3) + 1);
      break;
    case 'nuke':
      // instantaneous effect: clear all enemies
      for (let i = enemies.length - 1; i >= 0; i--) { enemies.splice(i,1); }
      // small score bonus
      score += 5;
      return; // don't push to activePowerUps
    default: break;
  }
  activePowerUps.push(active);
}

// Input
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const prev = !!keys[k];
  // set key state
  keys[k] = true;
  // update facing when movement keys pressed
  if (k === 'w' || k === 'arrowup') player.facing = { x: 0, y: -1 };
  if (k === 's' || k === 'arrowdown') player.facing = { x: 0, y: 1 };
  if (k === 'a' || k === 'arrowleft') player.facing = { x: -1, y: 0 };
  if (k === 'd' || k === 'arrowright') player.facing = { x: 1, y: 0 };
  // (space will fire while held; mouse/touch still uses shootRequested)
  // shift initiates dash
  if (e.key === 'Shift') tryDash();
  // allow Escape to reset the game immediately
  if (e.key === 'Escape') {
    retryButton.style.display = 'none';
    resetGame();
    requestAnimationFrame(gameLoop);
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// allow mouse click (or touch) on canvas to request a single shot
canvas.addEventListener('mousedown', (e) => { shootRequested = true; });
canvas.addEventListener('touchstart', (e) => { shootRequested = true; e.preventDefault(); }, { passive: false });

// Drawing
function drawBackground() { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

function draw() {
  // apply screen shake translation if active
  if (screenShake.time > 0) {
    const t = screenShake.time / screenShake.duration;
    const mag = screenShake.intensity * t;
    const sx = (Math.random() * 2 - 1) * mag;
    const sy = (Math.random() * 2 - 1) * mag;
    ctx.save();
    ctx.translate(sx, sy);
    drawBackground();
  } else {
    drawBackground();
  }

  // Walls (draw before entities so walls appear under entities)
  for (const w of walls) {
    ctx.fillStyle = 'rgba(120,120,120,0.95)';
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  // Corner boxes (draw on top of walls but under entities)
  for (const b of cornerBoxes) {
    ctx.fillStyle = 'rgba(255,215,0,0.95)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    // small timer text
    ctx.fillStyle = '#111'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
    const s = Math.max(0, (b.life / 60)).toFixed(1) + 's';
    ctx.fillText(s, b.x + b.w/2, b.y + b.h/2 + 4);
  }

  // boss warning
  if (bossWarning) {
    const a = bossWarning;
    const alpha = Math.max(0.1, a.life / 120);
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + Math.cos(a.angle) * 400, a.y + Math.sin(a.angle) * 400); ctx.stroke();
  }

  // Player
  ctx.fillStyle = player.color;
  ctx.beginPath(); ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2); ctx.fill();

  // dash wind visual
  if (player.isDashing) {
    ctx.save(); ctx.translate(player.x, player.y);
    const ang = Math.atan2(player.dashDir.y, player.dashDir.x);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(200,240,255,0.35)';
    ctx.beginPath(); ctx.ellipse(-player.radius - 18, 0, player.radius*1.6, player.radius*0.8, 0, -0.9, 0.9); ctx.fill();
    ctx.restore();
  }

  // Bullets
  for (const b of bullets) { ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill(); }

  // Enemies (draw aura visual for aura-type enemies)
  for (const e of enemies) {
    if (e.type === 'aura') {
      // pulsing aura circle
      const pulse = 0.6 + 0.4 * Math.sin((elapsedFrames || 0) * 0.08 + (e.id || 0));
      ctx.beginPath(); ctx.fillStyle = `rgba(136,68,255,${0.06 * pulse})`; ctx.arc(e.x, e.y, 80 * pulse, 0, Math.PI*2); ctx.fill();
      // inner glow
      ctx.beginPath(); ctx.fillStyle = `rgba(136,68,255,${0.12 * pulse})`; ctx.arc(e.x, e.y, e.radius + 8, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = e.color || '#ff66cc'; ctx.beginPath(); ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2); ctx.fill();
  }

  // Power-ups
  for (const p of powerUps) { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); }

  // Orbitals
  for (const o of orbitals) { ctx.fillStyle = o.color || '#88ff88'; ctx.beginPath(); ctx.arc(o.x, o.y, 6, 0, Math.PI * 2); ctx.fill(); }

  // Clones
  for (const c of clones) { ctx.fillStyle = '#ffaa88'; ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill(); }

  // Lasers (visuals)
  for (const L of lasers) {
    const alpha = L.life > (L.visibleLife || 60) ? 1 : (L.life / (L.visibleLife || 60));
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.strokeStyle = L.color || '#ff6666'; ctx.lineWidth = L.w || 6; ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(L.x + L.dx * 2000, L.y + L.dy * 2000); ctx.stroke();
    ctx.restore();
  }

  // enemy projectiles
  for (const p of enemyProjectiles) { ctx.fillStyle = '#ff4444'; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius || 6, 0, Math.PI*2); ctx.fill(); }

  // Explosions visuals
  drawExplosions();

  // Sword arcs
  drawSwordArcs();

  // UI
  ctx.fillStyle = 'white'; ctx.font = '20px Arial'; ctx.textAlign = 'left';
  ctx.fillText('Score: ' + score, 10, 28);
  // Player health bar (now under score)
  const hbX = 10, hbY = 38, hbW = 140, hbH = 18;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(hbX-2, hbY-2, hbW+4, hbH+4);
  const hp = player.health || 3; const maxH = player.maxHealth || 3;
  ctx.fillStyle = 'red'; ctx.fillRect(hbX, hbY, Math.round(hbW * (hp/maxH)), hbH);
  ctx.strokeStyle = 'white'; ctx.strokeRect(hbX, hbY, hbW, hbH);
  ctx.fillStyle = 'white'; ctx.font = '12px Arial'; ctx.fillText('HP: ' + hp + '/' + maxH, hbX + hbW + 8, hbY + hbH - 4);
  ctx.font = '20px Arial';
  ctx.fillText('Enemies: ' + enemies.length, 10, 68);

  // Active power-up indicators (top-right)
  const indicatorX = canvas.width - 160;
  let indicatorY = 10;
  ctx.textAlign = 'left';
  ctx.font = '14px Arial';
  for (let i = 0; i < activePowerUps.length; i++) {
    const a = activePowerUps[i];
    // remaining seconds (one decimal)
    const seconds = Math.max(0, (a.duration / 60)).toFixed(1);
    // label
    const label = a.type === 'omni' ? 'OMNI' : (a.type === 'rapid' ? 'RAPID' : (a.type === 'damage' ? 'DAMAGE' : a.type.toUpperCase()));
    // color mapping
    const color = a.type === 'omni' ? 'orange' : (a.type === 'rapid' ? 'cyan' : (a.type === 'damage' ? 'lightgreen' : 'white'));

    // background box
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(indicatorX - 6, indicatorY - 2, 150, 24);

    // colored dot
    ctx.beginPath(); ctx.fillStyle = color; ctx.arc(indicatorX + 6, indicatorY + 10, 6, 0, Math.PI * 2); ctx.fill();

    // text
    ctx.fillStyle = 'white';
    ctx.fillText(label + '  ' + seconds + 's', indicatorX + 18, indicatorY + 14);

    indicatorY += 30;
  }

  // Dash cooldown UI (bottom-left)
  ctx.textAlign = 'left'; ctx.font = '14px Arial';
  const dashText = player.dashCooldown > 0 ? 'Dash CD: ' + Math.ceil(player.dashCooldown / 60) + 's' : 'Dash Ready (Shift)';
  ctx.fillStyle = player.dashCooldown > 0 ? 'orange' : 'lightgreen';
  ctx.fillText(dashText, 10, canvas.height - 10);

  // Charge meter (when charge power-up active and holding space)
  if (player.chargeMode && player.chargeHold > 0) {
    const cx = canvas.width/2 - 60; const cy = canvas.height - 28; const cw = 120; const ch = 10;
    const pct = Math.min(1, player.chargeHold / 60);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx-2, cy-2, cw+4, ch+4);
    ctx.fillStyle = '#66ff66'; ctx.fillRect(cx, cy, Math.round(cw * pct), ch);
    ctx.strokeStyle = 'white'; ctx.strokeRect(cx, cy, cw, ch);
  }

  // (health bar now drawn under score)
  // if screen shake active, decrement timer and restore canvas transform
  if (screenShake.time > 0) {
    screenShake.time--;
    ctx.restore();
  }
}

// Player update
function updatePlayer() {
  // if dashing, propel tightly in dash direction; stop immediately if hitting a wall
  if (player.isDashing && player.dashTimer > 0) {
    const vx = player.dashDir.x * player.dashSpeed;
    const vy = player.dashDir.y * player.dashSpeed;
    const tryX = player.x + vx;
    const tryY = player.y + vy;
    // if either axis collides separately, stop movement on that axis (tighter movement)
    if (!rectCircleCollideAny(player.x + vx, player.y, player.radius)) {
      player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x + vx));
    }
    if (!rectCircleCollideAny(player.x, player.y + vy, player.radius)) {
      player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y + vy));
    }
    player.dashTimer--;
    if (player.dashTimer <= 0) {
      player.isDashing = false;
    }
  } else {
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy = -player.speed;
    if (keys['s'] || keys['arrowdown']) dy = player.speed;
    if (keys['a'] || keys['arrowleft']) dx = -player.speed;
    if (keys['d'] || keys['arrowright']) dx = player.speed;
    // axis-separated movement with wall collision checks
    const tryX = player.x + dx;
    const tryY = player.y; // test X move
    if (!rectCircleCollideAny(tryX, tryY, player.radius)) {
      player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, tryX));
    }
    const tryX2 = player.x;
    const tryY2 = player.y + dy; // test Y move
    if (!rectCircleCollideAny(tryX2, tryY2, player.radius)) {
      player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, tryY2));
    }
  }
  // ensure player isn't embedded in a wall after movement
  if (rectCircleCollideAny(player.x, player.y, player.radius)) resolvePlayerWallOverlap();
}

// Shooting behavior
function getShootDirections() {
  if (player.omniShot) return [ {x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0} ];
  return [ { x: player.facing.x, y: player.facing.y } ];
}

function shoot() {
  if (player.shootCooldown > 0) return;
  const dirs = getShootDirections();
  if (!dirs || dirs.length === 0) return;

  // Laser: fires a penetrating beam in facing direction
  if (player.laser) {
    // create a laser visual (lasting a few frames), and damage enemies along the line
    const dir = dirs[0];
    // longer visual life and increased width
  lasers.push({ x: player.x, y: player.y, dx: dir.x, dy: dir.y, life: 120, visibleLife: 60, w: 12, color: '#ff6666' });
    // hit enemies along the ray
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      // project enemy onto laser line and check distance
      const vx = e.x - player.x, vy = e.y - player.y;
      const proj = vx * dir.x + vy * dir.y;
      if (proj > 0 && proj < Math.max(canvas.width, canvas.height)) {
        const closestX = player.x + dir.x * proj;
        const closestY = player.y + dir.y * proj;
        const dist = Math.hypot(e.x - closestX, e.y - closestY);
        if (dist < e.radius + 6) {
          e.hp -= 2; // laser deals heavier damage
          if (e.hp <= 0) { enemies.splice(i,1); score++; }
        }
      }
    }
  }

  for (const dir of dirs) {
  // bombs mode: fire arcing bombs (slower, with gravity-like curve) that explode
    if (player.bombMode) {
      const angle = Math.atan2(dir.y, dir.x);
      const spread = 0.35;
      for (const a of [angle - spread, angle, angle + spread]) {
        const speed = 6;
        bullets.push({ x: player.x, y: player.y, dx: Math.cos(a) * speed, dy: Math.sin(a) * speed - 1.5, radius: 6, color: '#ff4444', damage: player.bulletDamage, bomb: true, life: 60 });
      }
  } else if (player.swordMode) {
      // sword swings create a short-lived arc around the player that damages enemies
    // create a half-circle sweep (180 degrees) that tracks which enemies it already hit this swing
    swordArcs.push({ x: player.x, y: player.y, angle: Math.atan2(dir.y, dir.x), arc: Math.PI, life: 18, damage: 3, hits: new Set() });
    } else {
      // primary bullet (knives apply bleed but less damage)
      if (player.knivesMode) {
        bullets.push({ x: player.x, y: player.y, dx: dir.x * 8, dy: dir.y * 8, radius: 4, color: '#cccccc', damage: Math.max(1, player.bulletDamage - 1), bleed: 120 });
      } else {
        bullets.push({ x: player.x, y: player.y, dx: dir.x * 8, dy: dir.y * 8, radius: 5, color: 'yellow', damage: player.bulletDamage });
      }
    }

    // trishot: add two angled bullets
    if (player.triShot) {
      const angle = Math.atan2(dir.y, dir.x);
      const spread = 0.35;
      for (const a of [angle - spread, angle + spread]) {
        bullets.push({ x: player.x, y: player.y, dx: Math.cos(a) * 8, dy: Math.sin(a) * 8, radius: 5, color: '#ff88ff', damage: player.bulletDamage });
      }
    }

    // half-omni: fire a perpendicular pair
    if (player.halfOmni) {
      if (Math.abs(dir.x) > 0) {
        bullets.push({ x: player.x, y: player.y, dx: 0, dy: -8, radius: 5, color: '#bbbbff', damage: player.bulletDamage });
        bullets.push({ x: player.x, y: player.y, dx: 0, dy: 8, radius: 5, color: '#bbbbff', damage: player.bulletDamage });
      } else {
        bullets.push({ x: player.x, y: player.y, dx: -8, dy: 0, radius: 5, color: '#bbbbff', damage: player.bulletDamage });
        bullets.push({ x: player.x, y: player.y, dx: 8, dy: 0, radius: 5, color: '#bbbbff', damage: player.bulletDamage });
      }
    }

    // boomerang: bullets that slow and return after some frames
    if (player.boomerang) {
      bullets.push({ x: player.x, y: player.y, dx: dir.x * 6, dy: dir.y * 6, radius: 6, color: '#ffaa00', damage: player.bulletDamage, boomerang: true, life: 60 });
    }
  }
  player.shootCooldown = Math.max(2, Math.round(player.baseCooldown / player.fireRateModifier));

  // Mirror player's shot for each clone: clones fire the same non-laser, non-charge shots
  for (const c of clones) {
    for (const dir of dirs) {
      // bombs
      if (player.bombMode) {
        const angle = Math.atan2(dir.y, dir.x);
        const spread = 0.35;
        for (const a of [angle - spread, angle, angle + spread]) {
          const speed = 6;
          bullets.push({ x: c.x, y: c.y, dx: Math.cos(a) * speed, dy: Math.sin(a) * speed - 1.5, radius: 6, color: '#ff4444', damage: player.bulletDamage, bomb: true, life: 60, source: 'clone' });
        }
      } else if (player.swordMode) {
        // clone creates a sword arc centered on clone
        swordArcs.push({ x: c.x, y: c.y, angle: Math.atan2(dir.y, dir.x), arc: Math.PI, life: 18, damage: 3, hits: new Set() });
      } else {
        // primary bullet
        if (player.knivesMode) {
          bullets.push({ x: c.x, y: c.y, dx: dir.x * 8, dy: dir.y * 8, radius: 4, color: '#cccccc', damage: Math.max(1, player.bulletDamage - 1), bleed: 120, source: 'clone' });
        } else {
          bullets.push({ x: c.x, y: c.y, dx: dir.x * 8, dy: dir.y * 8, radius: 5, color: 'yellow', damage: player.bulletDamage, source: 'clone' });
        }
      }
      // trishot and halfomni for clones too
      if (player.triShot) {
        const angle = Math.atan2(dir.y, dir.x);
        const spread = 0.35;
        for (const a of [angle - spread, angle + spread]) {
          bullets.push({ x: c.x, y: c.y, dx: Math.cos(a) * 8, dy: Math.sin(a) * 8, radius: 5, color: '#ff88ff', damage: player.bulletDamage, source: 'clone' });
        }
      }
      if (player.halfOmni) {
        if (Math.abs(dir.x) > 0) {
          bullets.push({ x: c.x, y: c.y, dx: 0, dy: -8, radius: 5, color: '#bbbbff', damage: player.bulletDamage, source: 'clone' });
          bullets.push({ x: c.x, y: c.y, dx: 0, dy: 8, radius: 5, color: '#bbbbff', damage: player.bulletDamage, source: 'clone' });
        } else {
          bullets.push({ x: c.x, y: c.y, dx: -8, dy: 0, radius: 5, color: '#bbbbff', damage: player.bulletDamage, source: 'clone' });
          bullets.push({ x: c.x, y: c.y, dx: 8, dy: 0, radius: 5, color: '#bbbbff', damage: player.bulletDamage, source: 'clone' });
        }
      }
      if (player.boomerang) {
        bullets.push({ x: c.x, y: c.y, dx: dir.x * 6, dy: dir.y * 6, radius: 6, color: '#ffaa00', damage: player.bulletDamage, boomerang: true, life: 60, source: 'clone' });
      }
    }
  }
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.x += b.dx; b.y += b.dy;
    // bullets are blocked by walls
    // wall collision handling: bombs bounce, other bullets are removed
    let collided = false;
    for (const w of walls) {
      if (rectCircleCollide(w.x, w.y, w.w, w.h, b.x, b.y, b.radius)) { collided = true;
        if (b.bomb) {
          // approximate collision normal: if center outside left/right of wall bounds, flip dx, else flip dy
          if (b.x < w.x || b.x > w.x + w.w) { b.dx = -b.dx * 0.7; b.x += Math.sign(b.dx || 1) * 2; }
          else { b.dy = -b.dy * 0.7; b.y += Math.sign(b.dy || 1) * 2; }
          b.bounces = (b.bounces || 0) + 1;
          // small life penalty per bounce so bombs eventually explode
          b.life -= 8;
        } else {
          bullets.splice(i,1); collided = true; break;
        }
      }
    }
    if (collided && (!b.bomb)) continue;
    // screen edge collision for bombs
    if (b.bomb) {
      if (b.x - b.radius <= 0 || b.x + b.radius >= canvas.width) { b.dx = -b.dx * 0.7; b.bounces = (b.bounces || 0) + 1; b.life -= 8; }
      if (b.y - b.radius <= 0 || b.y + b.radius >= canvas.height) { b.dy = -b.dy * 0.7; b.bounces = (b.bounces || 0) + 1; b.life -= 8; }
    }
    // bomb physics
    if (b.bomb) {
      b.dy += 0.18; // gravity-like
      b.life--;
      // explode on life end or after enough bounces
      if (b.life <= 0 || (b.bounces && b.bounces >= 4)) {
        explosions.push({ x: b.x, y: b.y, r: 2, maxR: 120, life: 22, damage: Math.max(2, b.damage || 1) });
        bullets.splice(i,1); continue;
      }
    }
    // boomerang logic
    if (b.boomerang) {
      b.life--;
      if (b.life <= 0) {
        // reverse towards player
        const vx = player.x - b.x; const vy = player.y - b.y; const d = Math.hypot(vx, vy) || 1;
        b.dx = (vx / d) * 6; b.dy = (vy / d) * 6;
        delete b.boomerang; // no longer in boomerang forward phase
      }
    }
    if (b.x < -40 || b.x > canvas.width + 40 || b.y < -40 || b.y > canvas.height + 40) bullets.splice(i, 1);
  }
}

function updateExplosions() {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    ex.life--; ex.r += (ex.maxR / 18);
    // damage enemies within r
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (Math.hypot(e.x - ex.x, e.y - ex.y) < ex.r + e.radius) {
        e.hp -= ex.damage || 1;
        if (e.hp <= 0) { enemies.splice(j,1); score++; }
      }
    }
    if (ex.life <= 0) explosions.splice(i,1);
  }
}

function drawExplosions() {
  for (const ex of explosions) {
    const alpha = Math.max(0, ex.life / 18);
    ctx.beginPath(); ctx.fillStyle = `rgba(255,140,0,${0.12 * alpha})`; ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.strokeStyle = `rgba(255,200,100,${0.7 * alpha})`; ctx.lineWidth = 2; ctx.arc(ex.x, ex.y, ex.r * 0.6, 0, Math.PI*2); ctx.stroke();
  }
}

function updateSwordArcs() {
  for (let i = swordArcs.length - 1; i >= 0; i--) {
    const s = swordArcs[i]; s.life--; // arc stays relative to player
    s.x = player.x; s.y = player.y;
    // damage enemies in arc
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      let da = Math.abs(normalizeAngle(ang - s.angle));
      if (da <= s.arc / 2 && Math.hypot(e.x - s.x, e.y - s.y) < 80) {
        // only hit once per swing
        if (!s.hits.has(e)) {
          s.hits.add(e);
          e.hp -= s.damage;
          // small hit particle
          explosions.push({ x: e.x, y: e.y, r: 6, life: 12 });
          if (e.hp <= 0) { enemies.splice(j,1); score++; }
        }
      }
    }
    if (s.life <= 0) swordArcs.splice(i,1);
  }
}

function drawSwordArcs() {
  for (const s of swordArcs) {
    // arc glow
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.angle);
    const alpha = Math.max(0.08, s.life / 18 * 0.18);
    ctx.beginPath(); ctx.fillStyle = `rgba(255,255,220,${alpha})`; ctx.arc(0, 0, 80, -s.arc/2, s.arc/2); ctx.lineTo(0,0); ctx.fill();
    // rim stroke
    ctx.lineWidth = 3; ctx.strokeStyle = `rgba(255,220,160,${alpha*1.2})`; ctx.beginPath(); ctx.arc(0,0,80, -s.arc/2, s.arc/2); ctx.stroke();
    ctx.restore();
    // brief hit flash at center when active
    if (s.life > 12) {
      ctx.beginPath(); ctx.fillStyle = `rgba(255,200,100,${(s.life-12)/6 * 0.6})`; ctx.arc(s.x, s.y, 8, 0, Math.PI*2); ctx.fill();
    }
  }
}

function normalizeAngle(a) { while (a > Math.PI) a -= Math.PI*2; while (a < -Math.PI) a += Math.PI*2; return a; }

// Dash handling: a short invincibility with cooldown
player.dashCooldown = 0; player.dashAvailable = true;
function tryDash() {
  if (player.dashCooldown > 0 || player.isDashing) return;
  // start dash in facing direction
  player.isDashing = true;
  player.dashTimer = player.dashDuration;
  player.dashDir = { x: player.facing.x || 0, y: player.facing.y || -1 };
  // normalize dir
  const mag = Math.hypot(player.dashDir.x, player.dashDir.y) || 1;
  player.dashDir.x /= mag; player.dashDir.y /= mag;
  player.dashCooldown = 180; // 3s cooldown
  // briefly make player invincible during dash
  applyPowerUp('invincible', player.dashDuration);
  // wind impulse: push nearby enemies and bullets away from dash direction
  const windRadius = 160;
  for (const e of enemies) {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < windRadius) {
      const push = (1 - d / windRadius) * 6;
      e.x += player.dashDir.x * push;
      e.y += player.dashDir.y * push;
    }
  }
  for (const b of bullets) {
    const d = Math.hypot(b.x - player.x, b.y - player.y);
    if (d < windRadius) {
      const push = (1 - d / windRadius) * 8;
      b.x += player.dashDir.x * push;
      b.y += player.dashDir.y * push;
      // slightly alter bullet velocity so they scatter
      b.dx += player.dashDir.x * 0.6; b.dy += player.dashDir.y * 0.6;
    }
  }
  // spawn a burst of wind particles
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2;
    particles.push({ x: player.x, y: player.y, dx: player.dashDir.x * (4 + Math.random()*4) + Math.cos(ang)*1.5, dy: player.dashDir.y * (4 + Math.random()*4) + Math.sin(ang)*1.5, life: randomInt(18,36), size: randomInt(2,5), color: 'white' });
  }
  // reset dash tracking and record frame for this dash
  player.dashEnemiesPassed.clear();
  player.lastDashFrame = elapsedFrames;
}

// update orbitals and clones
function updateOrbitalsAndClones() {
  // orbitals rotate
  for (let oi = orbitals.length - 1; oi >= 0; oi--) {
    const o = orbitals[oi];
    o.angle += 0.06;
    o.x = player.x + Math.cos(o.angle) * o.dist;
    o.y = player.y + Math.sin(o.angle) * o.dist;
    // orbitals can damage nearby enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (Math.hypot(e.x - o.x, e.y - o.y) < e.radius + 6) {
        e.hp -= 1;
        // Remove orbital on hit
        orbitals.splice(oi, 1);
        if (e.hp <= 0) { enemies.splice(i,1); score++; }
        break; // Only one hit per orbital per frame
      }
    }
  }

  // clones follow and shoot occasionally
  for (let ci = clones.length - 1; ci >= 0; ci--) {
    const c = clones[ci];
    c.life--;
    // ensure each clone has a small consistent offset so they don't overlap player
    if (typeof c.offsetX === 'undefined') c.offsetX = 20 + (ci % 2 ? -20 : 20);
    if (typeof c.offsetY === 'undefined') c.offsetY = 20 + ((ci % 3) - 1) * 8;
    const targetX = player.x + c.offsetX;
    const targetY = player.y + c.offsetY;
    // smooth follow (snappier than before)
    c.x += (targetX - c.x) * 0.22;
    c.y += (targetY - c.y) * 0.22;
    // if player is dashing, give clones a similar dash impulse
    if (player.isDashing && player.dashTimer > 0) {
      c.x += player.dashDir.x * (player.dashSpeed * 0.6);
      c.y += player.dashDir.y * (player.dashSpeed * 0.6);
    }
    if (c.life <= 0) clones.splice(ci,1);
  }

  // update lasers visuals
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i]; L.life--; if (L.life <= 0) lasers.splice(i,1);
  }
}

// Simple wall spawn: create 1-3 rectangular obstacles not overlapping player's immediate area
function spawnWalls() {
  // create 1-2 bisecting walls that span across the screen with a passage gap
  walls.length = 0;
  const count = randomInt(1, 2);
  for (let i = 0; i < count; i++) {
    const vertical = Math.random() < 0.5;
    if (vertical) {
      // vertical wall spanning full height with a gap
      const gapSize = randomInt(80, 180);
      let gapCenter = randomInt(80, canvas.height - 80);
      const x = randomInt(80, canvas.width - 80);
      // ensure we don't trap the player inside a solid column: if wall x is near player, make the gap include player
      if (Math.abs(x - player.x) < 32 + player.radius) {
        gapCenter = Math.max( Math.floor(gapSize/2) + 8, Math.min(canvas.height - Math.floor(gapSize/2) - 8, Math.round(player.y)) );
      }
      // create two rects: top and bottom around the gap
      const topH = Math.max(0, gapCenter - Math.floor(gapSize/2));
      const bottomY = gapCenter + Math.floor(gapSize/2);
      const bottomH = canvas.height - bottomY;
      if (topH > 8) walls.push({ x: x - 16, y: 0, w: 32, h: topH });
      if (bottomH > 8) walls.push({ x: x - 16, y: bottomY, w: 32, h: bottomH });
    } else {
      // horizontal wall spanning full width with a gap
      const gapSize = randomInt(80, 180);
        let gapCenter = randomInt(80, canvas.width - 80);
      const y = randomInt(80, canvas.height - 80);
        // ensure we don't trap the player: if wall y is near player, make the gap include player
        if (Math.abs(y - player.y) < 32 + player.radius) {
          gapCenter = Math.max( Math.floor(gapSize/2) + 8, Math.min(canvas.width - Math.floor(gapSize/2) - 8, Math.round(player.x)) );
        }
      const leftW = Math.max(0, gapCenter - Math.floor(gapSize/2));
      const rightX = gapCenter + Math.floor(gapSize/2);
      const rightW = canvas.width - rightX;
      if (leftW > 8) walls.push({ x: 0, y: y - 16, w: leftW, h: 32 });
      if (rightW > 8) walls.push({ x: rightX, y: y - 16, w: rightW, h: 32 });
    }
  }
  // mark nav grid to be rebuilt since walls changed
  navNeedsRebuild = true;
}

// If player somehow ends up overlapping a wall, nudge them out along the shortest axis
function resolvePlayerWallOverlap() {
  // try small nudges up/down/left/right until not colliding
  let attempts = 0;
  while (rectCircleCollideAny(player.x, player.y, player.radius) && attempts < 20) {
    attempts++;
    // find direction to move the least: test offsets
    const off = 6 + attempts; // increasing step
    const candidates = [ {dx: off, dy:0}, {dx:-off, dy:0}, {dx:0, dy:off}, {dx:0, dy:-off} ];
    let moved = false;
    for (const c of candidates) {
      const nx = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x + c.dx));
      const ny = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y + c.dy));
      if (!rectCircleCollideAny(nx, ny, player.radius)) {
        player.x = nx; player.y = ny; moved = true; break;
      }
    }
    if (!moved) {
      // as a last resort, nudge opposite of center
      if (player.x > canvas.width/2) player.x = Math.min(canvas.width - player.radius, player.x + off);
      else player.x = Math.max(player.radius, player.x - off);
      if (player.y > canvas.height/2) player.y = Math.min(canvas.height - player.radius, player.y + off);
      else player.y = Math.max(player.radius, player.y - off);
    }
  }
}

// corner boxes: guaranteed powerups placed in one of four corners, last for a limited time
function spawnCornerBox() {
  cornerBoxes.length = 0;
  const margin = 8;
  const size = 44;
  const corners = [
    { x: margin, y: margin },
    { x: canvas.width - margin - size, y: margin },
    { x: margin, y: canvas.height - margin - size },
    { x: canvas.width - margin - size, y: canvas.height - margin - size }
  ];
  // choose 1-2 corners to spawn boxes
  const count = randomInt(1, 2);
  for (let i = 0; i < count; i++) {
    const c = corners.splice(randomInt(0, corners.length - 1), 1)[0];
    cornerBoxes.push({ x: c.x, y: c.y, w: size, h: size, life: 900 }); // 15 seconds
  }
}

// check corner boxes pickup
function updateCornerBoxes() {
  for (let i = cornerBoxes.length - 1; i >= 0; i--) {
    const b = cornerBoxes[i];
    b.life--;
    // pickup when player overlaps box
    if (rectCircleCollide(b.x, b.y, b.w, b.h, player.x, player.y, player.radius)) {
      // decide powerup type: guaranteed random from list, with 5% chance invincibility
      if (Math.random() < 0.05) {
        applyPowerUp('invincible', 300); // invincible for 5s
      } else {
  const types = ['omni','rapid','damage','trishot','boomerang','orbital','speed','clone','halfomni','laser','bombs','sword','knives','heal','nuke'];
  // pick a type not already active
  const pool = types.filter(tt => !activePowerUps.find(a => a.type === tt));
  const t = pool.length ? pool[randomInt(0, pool.length - 1)] : types[randomInt(0, types.length - 1)];
        // make bombs/sword/laser last 5s
        if (t === 'bombs' || t === 'sword' || t === 'laser') applyPowerUp(t, 300);
        else applyPowerUp(t, 600);
      }
      cornerBoxes.splice(i, 1);
      continue;
    }
    if (b.life <= 0) cornerBoxes.splice(i, 1);
  }
}

// Enemies: varied speed and HP, cap at 20
function spawnEnemy() {
  // if boss active, prevent normal spawns unless boss allows minions
  if (boss && !boss.allowMinions) return;
  const CAP = 20; if (enemies.length >= CAP) return;
  const side = randomInt(0,3); let x = 0, y = 0;
  if (side === 0) { x = -20; y = randomInt(0, canvas.height); }
  if (side === 1) { x = canvas.width + 20; y = randomInt(0, canvas.height); }
  if (side === 2) { x = randomInt(0, canvas.width); y = -20; }
  if (side === 3) { x = randomInt(0, canvas.width); y = canvas.height + 20; }
  // choose variant: normal, ranged, weakFast, aura
  const variantRoll = Math.random();
  let type = 'normal';
  if (variantRoll < 0.18) type = 'ranged';
  else if (variantRoll < 0.30) type = 'weakFast';
  else if (variantRoll < 0.36) type = 'aura';
  const speed = type === 'weakFast' ? +(1.6 + Math.random() * 1.4).toFixed(2) : +(0.6 + Math.random() * 1.8).toFixed(2);
  const hp = type === 'weakFast' ? 1 : randomInt(1, 3);
  // ensure spawn isn't inside a wall and not too close to player; retry a few times
  const radius = 14 + hp * 2;
  let spawnX = x, spawnY = y;
  for (let a = 0; a < 60; a++) {
    if (!rectCircleCollideAny(spawnX, spawnY, radius) && Math.hypot(spawnX - player.x, spawnY - player.y) > 120) break;
    // try shifting along the spawn edge or random nearby
    if (side === 0 || side === 1) spawnY = randomInt(0, canvas.height);
    else spawnX = randomInt(0, canvas.width);
  }
  const color = type === 'ranged' ? '#66aaff' : (type === 'weakFast' ? '#ffee88' : (type === 'aura' ? '#8844ff' : (hp === 1 ? 'tomato' : (hp === 2 ? 'orangered' : 'darkred'))));
  enemies.push({ id: ++enemyIdCounter, x: spawnX, y: spawnY, radius, speed, color, hp, stuckTimer: 0, ranged: type === 'ranged', shootCooldown: type === 'ranged' ? randomInt(90, 240) : 0, type });
}

// helper: move an existing enemy to a random spawn edge (used for respawning stuck enemies)
function respawnEnemyAtEdge(e) {
  const side = randomInt(0,3);
  if (side === 0) { e.x = -20; e.y = randomInt(0, canvas.height); }
  else if (side === 1) { e.x = canvas.width + 20; e.y = randomInt(0, canvas.height); }
  else if (side === 2) { e.x = randomInt(0, canvas.width); e.y = -20; }
  else { e.x = randomInt(0, canvas.width); e.y = canvas.height + 20; }
  // reset some properties so enemy behaves normally after respawn
  e.stuckTimer = 0;
}

function spawnBoss() {
  // choose side spawn
  const side = randomInt(0,3); let x = 0, y = 0;
  if (side === 0) { x = -80; y = randomInt(0, canvas.height); }
  if (side === 1) { x = canvas.width + 80; y = randomInt(0, canvas.height); }
  if (side === 2) { x = randomInt(0, canvas.width); y = -80; }
  if (side === 3) { x = randomInt(0, canvas.width); y = canvas.height + 80; }
  boss = { x, y, radius: 50, hp: 60 + bossEncounterCount * 20, speed: 3.5 + bossEncounterCount * 0.6, angle: Math.random() * Math.PI*2, changeTimer: 0, spawnMinionTimer: 0, spawnedMinions: 0, allowMinions: bossEncounterCount > 0, shootCooldown: 300 };
}

function updateBoss() {
  if (!boss) return;
  // erratic steering: random direction changes
  boss.changeTimer--;
  if (boss.changeTimer <= 0) { boss.angle += (Math.random() - 0.5) * Math.PI; boss.changeTimer = randomInt(20, 60); }
  // move
  boss.x += Math.cos(boss.angle) * boss.speed;
  boss.y += Math.sin(boss.angle) * boss.speed;
  // keep on screen
  boss.x = Math.max(boss.radius, Math.min(canvas.width - boss.radius, boss.x));
  boss.y = Math.max(boss.radius, Math.min(canvas.height - boss.radius, boss.y));
  // occasionally spawn minions if allowed (limit to 5)
  if (boss.allowMinions && boss.spawnedMinions < 5) {
    boss.spawnMinionTimer--;
    if (boss.spawnMinionTimer <= 0) {
      boss.spawnMinionTimer = randomInt(120, 240);
        // spawn a small enemy near boss, avoid spawning inside walls
        let mx = boss.x + randomInt(-40,40);
        let my = boss.y + randomInt(-40,40);
        const mRadius = 12;
        for (let a = 0; a < 30; a++) {
          if (!rectCircleCollideAny(mx, my, mRadius)) break;
          mx = boss.x + randomInt(-80,80);
          my = boss.y + randomInt(-80,80);
        }
        enemies.push({ x: mx, y: my, radius: mRadius, speed: 1 + Math.random()*1.5, color: 'orangered', hp: 1, stuckTimer: 0 });
      boss.spawnedMinions++;
    }
  }
  // collision with player
  if (Math.hypot(boss.x - player.x, boss.y - player.y) < boss.radius + player.radius) {
    if (!player.invincible) isGameOver = true;
  }
    // boss shooting: line of projectiles every ~5s
  boss.shootCooldown--;
  if (boss.shootCooldown <= 0) {
    boss.shootCooldown = 300; // 5s
    // fire a line of projectiles in facing direction
    const count = 8;
    const baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (i - (count-1)/2) * 0.06;
      enemyProjectiles.push({ x: boss.x, y: boss.y, dx: Math.cos(a) * 6, dy: Math.sin(a) * 6, life: 240, radius: 6 });
    }
  }
}

function drawBoss() {
  if (!boss) return;
  // draw predicted path line
  ctx.strokeStyle = 'rgba(255,0,0,0.6)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(boss.x, boss.y);
  const px = boss.x + Math.cos(boss.angle) * 300; const py = boss.y + Math.sin(boss.angle) * 300;
  ctx.lineTo(px, py); ctx.stroke();
  // draw boss circle
  ctx.fillStyle = 'darkred'; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'purple'; ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.radius - 6, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'white'; ctx.font = '14px Arial'; ctx.fillText('BOSS', boss.x, boss.y - boss.radius - 8);
}

function updateEnemies() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    // process bleed damage over time
    if (e.bleed && e.bleed.time > 0) {
      e.bleed.time--;
      if (e.bleed.tick-- <= 0) { e.hp -= e.bleed.dps; e.bleed.tick = 30; }
      if (e.hp <= 0) { enemies.splice(i,1); score++; continue; }
    }
    // basic steering towards player with simple wall avoidance: if next step collides, try a small sidestep
    const dx = player.x - e.x; const dy = player.y - e.y; const dist = Math.hypot(dx, dy) || 1;
    let nx = e.x + (dx / dist) * e.speed;
    let ny = e.y + (dy / dist) * e.speed;
    if (rectCircleCollideAny(nx, ny, e.radius)) {
      // try offset directions to go around
      const sidestep = 1.2;
      const ang = Math.atan2(dy, dx);
      const try1x = e.x + Math.cos(ang + Math.PI/2) * sidestep * e.speed;
      const try1y = e.y + Math.sin(ang + Math.PI/2) * sidestep * e.speed;
      const try2x = e.x + Math.cos(ang - Math.PI/2) * sidestep * e.speed;
      const try2y = e.y + Math.sin(ang - Math.PI/2) * sidestep * e.speed;
      if (!rectCircleCollideAny(try1x, try1y, e.radius)) { nx = try1x; ny = try1y; }
      else if (!rectCircleCollideAny(try2x, try2y, e.radius)) { nx = try2x; ny = try2y; }
      else { nx = e.x; ny = e.y; }
      // if both tries failed, consider the enemy 'stuck' for this frame
      if (nx === e.x && ny === e.y) {
        e.stuckTimer = (e.stuckTimer || 0) + 1;
        // attempt pathfinding as a fallback to navigate around big walls
        const path = findPath(e.x, e.y, player.x, player.y);
        if (path && path.length > 1) {
          // step towards the next cell center
          const next = path[1];
          const tx = next.x * navCellSize + navCellSize / 2;
          const ty = next.y * navCellSize + navCellSize / 2;
          const vdx = tx - e.x; const vdy = ty - e.y; const vd = Math.hypot(vdx, vdy) || 1;
          nx = e.x + (vdx / vd) * e.speed;
          ny = e.y + (vdy / vd) * e.speed;
          // if path step is still blocked, don't overwrite stuckTimer
          if (rectCircleCollideAny(nx, ny, e.radius)) {
            nx = e.x; ny = e.y;
          } else {
            e.stuckTimer = 0; // moving along path
          }
        }
      } else {
        e.stuckTimer = 0;
      }
    }
    e.x = Math.max(e.radius, Math.min(canvas.width - e.radius, nx));
    e.y = Math.max(e.radius, Math.min(canvas.height - e.radius, ny));
    // if stuck for 600 frames (~10s at 60fps), respawn the enemy at an edge
    if ((e.stuckTimer || 0) >= 180) {
      respawnEnemyAtEdge(e);
    }
      // collision with player: apply hit logic with brief invulnerability
      if (Math.hypot(e.x - player.x, e.y - player.y) < e.radius + player.radius) {
        // if currently dashing, record this enemy as passed-through
        if (player.isDashing && (elapsedFrames - (player.lastDashFrame || 0)) <= player.dashDuration + 6) {
          player.dashEnemiesPassed.add(e.id || (e.x+','+e.y));
          // if passed through 3 unique enemies, grant brief damage boost
          if (player.dashEnemiesPassed.size >= 3) {
            applyPowerUp('dash_damage', 60); // 1s boost
            player.dashEnemiesPassed.clear();
          }
        }
        if (!player.invincible && player.hitInvincible <= 0) {
          player.health = Math.max(0, (player.health || 3) - 1);
          player.hitInvincible = 60; // 1s invulnerability between hits
          triggerScreenShake(8, 18);
          if (player.health <= 0) isGameOver = true;
        }
      }
      // ranged enemy behavior: blink 3 times before shooting to telegraph
      if (e.ranged) {
        e.shootCooldown = (typeof e.shootCooldown === 'number') ? e.shootCooldown : randomInt(90, 240);
        e.shootCooldown--;
        // when within 36 frames of firing, blink (toggle every 6 frames) => ~3 visible blinks
        if (e.shootCooldown <= 36 && e.shootCooldown > 0) {
          const t = 36 - e.shootCooldown;
          e.color = (Math.floor(t / 6) % 2 === 0) ? '#aaddff' : '#66aaff';
        }
        if (e.shootCooldown <= 0) {
          // fire a projectile from the enemy toward the player
          const a = Math.atan2(player.y - e.y, player.x - e.x);
          const speed = 5;
          enemyProjectiles.push({ x: e.x + Math.cos(a) * (e.radius + 6), y: e.y + Math.sin(a) * (e.radius + 6), dx: Math.cos(a) * speed, dy: Math.sin(a) * speed, life: 240, radius: 6, sourceId: e.id });
          e.shootCooldown = randomInt(90, 240);
          e.color = '#66aaff';
        }
      }
      // aura enemy behavior: remove nearby power-ups within a small radius
      if (e.type === 'aura') {
        const auraR = 80;
        for (let pi = powerUps.length - 1; pi >= 0; pi--) {
          const p = powerUps[pi];
          if (Math.hypot(p.x - e.x, p.y - e.y) < auraR) {
            // remove power-up from the ground (aura steals it)
            powerUps.splice(pi, 1);
            // optional: spawn a small particle to indicate absorption
            particles.push({ x: e.x, y: e.y, dx: (Math.random()-0.5)*2, dy: (Math.random()-0.5)*2, life: randomInt(12,28), size: 3, color: '#8844ff' });
          }
        }
      }
  }
}

function handleCollisions() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.radius + b.radius) {
        e.hp -= b.damage || 1;
        // apply bleed if bullet carried it
        if (b.bleed) {
          e.bleed = { time: b.bleed, dps: 1, tick: 30 };
        }
        bullets.splice(j, 1);
        if (e.hp <= 0) {
          // chance to drop power-up
          if (Math.random() < 0.6) {
            const types = [
              {type:'omni', color:'orange'},
              {type:'rapid', color:'cyan'},
              {type:'damage', color:'lightgreen'},
              {type:'trishot', color:'#ff88ff'},
              {type:'boomerang', color:'#ffaa00'},
              {type:'orbital', color:'#88ff88'},
              {type:'speed', color:'#88aaff'},
              {type:'clone', color:'#ffaa88'},
              {type:'charge', color:'#66ff66'},
              {type:'halfomni', color:'#bbbbff'},
              {type:'laser', color:'#ff4444'},
              {type:'bombs', color:'#cc3333'},
              {type:'sword', color:'#dddddd'}
            ];
            // pick a power-up that isn't already active or on the ground
            const available = types.filter(t => {
              const onGround = powerUps.find(pp => pp.type === t.type);
              const active = activePowerUps.find(ap => ap.type === t.type);
              return !onGround && !active;
            });
            if (available.length > 0) {
              const p = available[randomInt(0, available.length - 1)];
              const dur = (p.type === 'laser') ? 60 : ((p.type === 'bombs' || p.type === 'sword') ? 300 : 600);
              powerUps.push({ x: e.x, y: e.y, radius: 10, color: p.color, type: p.type, duration: dur });
            }
          }
          enemies.splice(i, 1); score += 1;
        }
        break;
      }
    }
  }
}

// enemy projectiles update & collision with player
function updateEnemyProjectiles() {
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i]; p.x += p.dx; p.y += p.dy; p.life--;
    if (Math.hypot(p.x - player.x, p.y - player.y) < (p.radius || 6) + player.radius) {
      if (!player.invincible && player.hitInvincible <= 0) {
        player.health = Math.max(0, (player.health || 3) - 1);
        player.hitInvincible = 60;
        triggerScreenShake(8, 18);
        if (player.health <= 0) isGameOver = true;
      }
      enemyProjectiles.splice(i,1); continue;
    }
    if (p.life <= 0 || p.x < -50 || p.x > canvas.width + 50 || p.y < -50 || p.y > canvas.height + 50) enemyProjectiles.splice(i,1);
  }
}

function updatePowerUpsState() {
  for (let i = powerUps.length - 1; i >= 0; i--) {
    const p = powerUps[i];
    const dist = Math.hypot(player.x - p.x, player.y - p.y);
    if (dist < player.radius + p.radius) {
      // ignore if same type already active
      if (activePowerUps.find(a => a.type === p.type)) { powerUps.splice(i,1); continue; }
      const active = { type: p.type, duration: p.duration };
      switch (p.type) {
        case 'omni': player.omniShot = true; break;
        case 'rapid': player.fireRateModifier = 2; break;
        case 'damage': player.bulletDamage += 1; break;
        case 'trishot': player.triShot = true; break;
        case 'boomerang': player.boomerang = true; break;
        case 'orbital':
          // create 3 orbitals
          orbitals.length = 0;
          for (let k = 0; k < 3; k++) orbitals.push({ angle: (k * Math.PI * 2) / 3, dist: 40, color: p.color });
          break;
        case 'speed': player.speed += 2; break;
        case 'clone':
          // spawn a temporary clone that will follow and shoot
          clones.push({ x: player.x + 20, y: player.y + 20, life: 600 });
          break;
        case 'halfomni': player.halfOmni = true; break;
        case 'laser': player.laser = true; break;
        case 'charge': player.chargeMode = true; break;
      }
      activePowerUps.push(active); powerUps.splice(i, 1);
    }
  }
  for (let i = activePowerUps.length - 1; i >= 0; i--) {
    const a = activePowerUps[i]; a.duration--; if (a.duration <= 0) {
      // revert effects for all power-up types
      switch (a.type) {
        case 'omni': player.omniShot = false; break;
        case 'rapid': player.fireRateModifier = 1; break;
        case 'damage': player.bulletDamage = Math.max(1, player.bulletDamage - 1); break;
        case 'trishot': player.triShot = false; break;
        case 'boomerang': player.boomerang = false; break;
        case 'orbital': orbitals.length = 0; break;
        case 'speed': player.speed = Math.max(1, player.speed - 2); break;
        case 'clone': /* clones are temporary and will expire on their own */ break;
        case 'halfomni': player.halfOmni = false; break;
        case 'laser': player.laser = false; break;
  case 'charge': player.chargeMode = false; player.chargeHold = 0; player.lastSpaceDown = false; break;
        case 'bombs': player.bombMode = false; break;
        case 'sword': player.swordMode = false; break;
        case 'invincible': player.invincible = false; break;
        default: break;
      }
      activePowerUps.splice(i, 1);
    }
  }
}

function resetGame() {
  enemies.length = 0;
  bullets.length = 0;
  powerUps.length = 0;
  activePowerUps.length = 0;
  orbitals.length = 0;
  clones.length = 0;
  lasers.length = 0;
  explosions.length = 0;
  swordArcs.length = 0;
  score = 0;
  isGameOver = false;
  player.x = canvas.width / 2;
  player.y = canvas.height / 2;
  player.shootCooldown = 0;
  // reset player flags
  player.omniShot = false;
  player.fireRateModifier = 1;
  player.bulletDamage = 1;
  player.triShot = false;
  player.boomerang = false;
  player.halfOmni = false;
  player.laser = false;
  player.speed = 4;
  player.invincible = false;
  player.bombMode = false;
  player.swordMode = false;
  player.dashCooldown = 0;
  player.health = 3;
  player.maxHealth = 3;
  player.hitInvincible = 0;
  enemyProjectiles.length = 0;
  // initialize walls and timer
  walls.length = 0;
  wallSpawnTimer = 1800;
  // spawn initial walls so map isn't empty at start (optional)
  spawnWalls();
  // ensure player isn't overlapped by initial walls
  resolvePlayerWallOverlap();
  // brief invulnerability on reset to prevent instant game over
  player.invincible = true;
  activePowerUps.push({ type: 'invincible', duration: 60 });
  // spawn a few enemies at start
  for (let i = 0; i < 3; i++) spawnEnemy();
  // rebuild navigation grid
  navNeedsRebuild = true;
  // clear particles and corner boxes
  if (typeof particles !== 'undefined') particles.length = 0;
  if (typeof cornerBoxes !== 'undefined') cornerBoxes.length = 0;
}

function gameLoop() {
  if (isGameOver) {
    drawBackground();
    // Show game over message
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = "48px Impact, Charcoal, sans-serif";
    ctx.fillText('Game Over', canvas.width/2, canvas.height/2 - 10);
    ctx.font = '20px Arial';
    ctx.fillText('Score: ' + score, canvas.width/2, canvas.height/2 + 30);
    // Show retry button
    retryButton.style.display = 'block';
    return; // stop the loop until player clicks retry
  }

  updatePlayer();
  if (player.shootCooldown > 0) player.shootCooldown--;
  // Handle shooting and charge shots
  if (player.chargeMode) {
    // charging logic: track hold time while space is down
    if (keys[' ']) {
      player.chargeHold = (player.chargeHold || 0) + 1;
      player.lastSpaceDown = true;
    } else if (player.lastSpaceDown) {
      // space was released; fire charged if held long enough
      if (player.chargeHold >= 30) {
        // big charged bullet
        const angle = Math.atan2(player.facing.y, player.facing.x);
        bullets.push({ x: player.x + player.facing.x * 8, y: player.y + player.facing.y * 8, dx: Math.cos(angle) * 12, dy: Math.sin(angle) * 12, radius: 10, color: '#66ff66', damage: 4 });
        player.shootCooldown = 18;
      } else {
        // small tap shot
        shoot();
      }
      player.chargeHold = 0; player.lastSpaceDown = false; shootRequested = false;
    } else if (shootRequested) {
      // allow tap from mouse/touch to fire normally
      shoot(); shootRequested = false;
    }
  } else {
    // Fire while space is held, or on a single requested shot (mouse/tap)
    if (keys[' '] || shootRequested) {
      // shoot() checks cooldown and will only fire when allowed
      shoot();
      shootRequested = false;
    }
  }
  updateBullets(); updateEnemies(); handleCollisions(); updatePowerUpsState();
  // update turrets
  for (let ti = turrets.length - 1; ti >= 0; ti--) {
    const T = turrets[ti]; T.life--; T.x = player.x + 30; T.y = player.y - 30; // simple offset
    if (T.life <= 0) { turrets.splice(ti,1); continue; }
    T.fireTimer--; if (T.fireTimer <= 0) {
      T.fireTimer = 18; // fire rate
      // find nearest enemy
      if (enemies.length > 0) {
        let best = null; let bd = 99999;
        for (const e of enemies) { const d = Math.hypot(e.x - T.x, e.y - T.y); if (d < bd) { bd = d; best = e; } }
        if (best) {
          const a = Math.atan2(best.y - T.y, best.x - T.x);
          enemyProjectiles.push({ x: T.x + Math.cos(a)*8, y: T.y + Math.sin(a)*8, dx: Math.cos(a)*6, dy: Math.sin(a)*6, life: 240, radius: 5, source: 'turret' });
        }
      }
    }
  }

  // update corner boxes (pickup/timers) and invincibility particles
  if (typeof updateCornerBoxes === 'function') updateCornerBoxes();
  if (typeof updateParticles === 'function') updateParticles();

  // update explosions and sword arcs
  if (typeof updateExplosions === 'function') updateExplosions();
  if (typeof updateSwordArcs === 'function') updateSwordArcs();

  // wall spawn timer: spawn new walls every 30s
  wallSpawnTimer--;
  if (wallSpawnTimer <= 0) { spawnWalls(); wallSpawnTimer = 1800; }

  // boss timer / warning / spawn
  elapsedFrames++;
  // grant permanent boost after 2 minutes (7200 frames)
  if (!permanentBoostGranted && elapsedFrames >= 7200) {
    permanentBoostGranted = true;
    player.maxHealth = (player.maxHealth || 3) + 1;
    player.health = Math.min(player.health + 1, player.maxHealth);
    player.speed = (player.speed || 4) + 0.5;
    // visual feedback: spawn some particles and an active marker
    for (let i = 0; i < 40; i++) particles.push({ x: player.x + (Math.random()-0.5)*40, y: player.y + (Math.random()-0.5)*40, dx: (Math.random()-0.5)*2, dy: (Math.random()-0.5)*2, life: randomInt(30,80), size: 3, color: 'gold' });
    activePowerUps.push({ type: 'permanent_boost', duration: 600 });
  }
  bossTimer--;
  if (!boss && bossTimer <= 120) {
    // show warning line for 2 seconds (120 frames)
    if (!bossWarning) bossWarning = { life: 120, angle: Math.random() * Math.PI*2, x: randomInt(0, canvas.width), y: randomInt(0, canvas.height) };
    bossWarning.life--;
    // draw warning (handled in drawBoss by using boss if exists; draw warning separately here)
    if (bossWarning.life <= 0) { spawnBoss(); bossWarning = null; bossTimer = 3600; }
  }
  if (boss) updateBoss();
  // check boss death
  if (boss && boss.hp <= 0) {
    boss = null; bossEncounterCount++; // next boss will allow minions
    // small score bonus
    score += 10;
    // if elapsedFrames >= 3 minutes allow multiple bosses: reset bossTimer normally
    if (elapsedFrames >= 10800) bossTimer = 1800; else bossTimer = 3600;
  }
  // decrement player's hit invincibility timer
  if (player.hitInvincible && player.hitInvincible > 0) player.hitInvincible--;

  // update enemy projectiles
  updateEnemyProjectiles();

  // corner box spawn timer (20-40s random interval)
  cornerBoxTimer--;
  if (cornerBoxTimer <= 0) { spawnCornerBox(); cornerBoxTimer = randomInt(1200, 2400); }

  // spawn scaling: faster spawns as score increases (lower timer value)
  enemySpawnTimer--;
  const base = Math.max(18, 90 - Math.floor(score * 1.2));
  if (enemySpawnTimer <= 0) { spawnEnemy(); enemySpawnTimer = base; }

  // dash cooldown tick
  if (player.dashCooldown > 0) player.dashCooldown--;

  draw(); requestAnimationFrame(gameLoop);
}

// Start
resetGame(); requestAnimationFrame(gameLoop);
