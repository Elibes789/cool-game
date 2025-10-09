// Vampire Survivors-style Game
// Basic game setup, player, enemies, shooting, and power-ups

const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 600;
canvas.style.width = '800px';
canvas.style.height = '600px';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

// Responsive canvas for mobile
function resizeCanvas() {
    let w = window.innerWidth;
    let h = window.innerHeight;
    let scale = Math.min(w / 800, h / 600);
    canvas.style.width = (800 * scale) + 'px';
    canvas.style.height = (600 * scale) + 'px';
// ...existing code...
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Drawing functions
function drawBackground() {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function draw() {
    drawBackground();
    
    // Draw player
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw enemies
    for (const enemy of enemies) {
        ctx.fillStyle = enemy.color;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw bullets
    for (const bullet of bullets) {
        ctx.fillStyle = bullet.color;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw power-ups
    for (const powerUp of powerUps) {
        ctx.fillStyle = powerUp.color;
        ctx.beginPath();
        ctx.arc(powerUp.x, powerUp.y, powerUp.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw score
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Score: ' + score, 10, 30);
}

// Initialize game
let enemySpawnTimer = 60;
// ...existing code...

// Game state
const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    radius: 20,
    speed: 4,
    color: 'blue',
    dx: 0,
    dy: 0,
    shootCooldown: 0,
    bulletDamage: 1,
    spiralShot: false,
    spiralAngle: 0,
    powerUps: [],
};

const bullets = [];
const enemies = [];
const powerUps = [];
let score = 0;
let keys = {};

// Utility
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Controls
window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// Mobile touch controls
function isMobile() {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}
if (isMobile()) {
    document.querySelector('.mobile-controls').style.display = 'block';
    // Movement
    const btnUp = document.querySelector('.move-up');
    const btnDown = document.querySelector('.move-down');
    const btnLeft = document.querySelector('.move-left');
    const btnRight = document.querySelector('.move-right');
    const btnShoot = document.querySelector('.shoot');
    function setKey(key, val) { keys[key] = val; }
    btnUp.addEventListener('touchstart', e => { setKey('w', true); e.preventDefault(); });
    btnUp.addEventListener('touchend', e => { setKey('w', false); e.preventDefault(); });
    btnDown.addEventListener('touchstart', e => { setKey('s', true); e.preventDefault(); });
    btnDown.addEventListener('touchend', e => { setKey('s', false); e.preventDefault(); });
    btnLeft.addEventListener('touchstart', e => { setKey('a', true); e.preventDefault(); });
    btnLeft.addEventListener('touchend', e => { setKey('a', false); e.preventDefault(); });
    btnRight.addEventListener('touchstart', e => { setKey('d', true); e.preventDefault(); });
    btnRight.addEventListener('touchend', e => { setKey('d', false); e.preventDefault(); });
    // Shoot
    btnShoot.addEventListener('touchstart', e => { setKey(' ', true); e.preventDefault(); });
    btnShoot.addEventListener('touchend', e => { setKey(' ', false); e.preventDefault(); });
}

// Shooting directions (WASD or Arrow keys or Spacebar)
function getShootDirections() {
    let dirs = [];
    if (keys[' ']) { // Spacebar shoots in all directions
        return [
            {x: 0, y: -1},  // Up
            {x: 0, y: 1},   // Down
            {x: -1, y: 0},  // Left
            {x: 1, y: 0}    // Right
        ];
    }
    if (keys['arrowup'] || keys['w']) dirs.push({x: 0, y: -1});
    if (keys['arrowdown'] || keys['s']) dirs.push({x: 0, y: 1});
    if (keys['arrowleft'] || keys['a']) dirs.push({x: -1, y: 0});
    if (keys['arrowright'] || keys['d']) dirs.push({x: 1, y: 0});
    return dirs;
}

// Player movement
function updatePlayer() {
    player.dx = 0;
    player.dy = 0;
    if (keys['w'] || keys['arrowup']) player.dy = -player.speed;
    if (keys['s'] || keys['arrowdown']) player.dy = player.speed;
    if (keys['a'] || keys['arrowleft']) player.dx = -player.speed;
    if (keys['d'] || keys['arrowright']) player.dx = player.speed;
    
    const nextX = player.x + player.dx;
    const nextY = player.y + player.dy;
    
    // Room transition checks
    if (nextY < player.radius && rooms.exists(rooms.current.x, rooms.current.y - 1)) {
        // Move to room above
        rooms.current.y--;
        player.y = canvas.height - player.radius - 1;
        changeRoom();
    } else if (nextY > canvas.height - player.radius && rooms.exists(rooms.current.x, rooms.current.y + 1)) {
        // Move to room below
        rooms.current.y++;
        player.y = player.radius + 1;
        changeRoom();
    } else if (nextX < player.radius && rooms.exists(rooms.current.x - 1, rooms.current.y)) {
        // Move to room left
        rooms.current.x--;
        player.x = canvas.width - player.radius - 1;
        changeRoom();
    } else if (nextX > canvas.width - player.radius && rooms.exists(rooms.current.x + 1, rooms.current.y)) {
        // Move to room right
        rooms.current.x++;
        player.x = player.radius + 1;
        changeRoom();
    } else {
        // Normal movement within room bounds
        player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, nextX));
        player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, nextY));
    }
}
}

// Shooting
function shoot() {
    if (player.shootCooldown > 0) return;
    const dirs = getShootDirections();
    
    // Regular directional shots
    if (dirs.length > 0) {
        for (const dir of dirs) {
            bullets.push({
                x: player.x,
                y: player.y,
                dx: dir.x * 8,
                dy: dir.y * 8,
                radius: 6,
                color: 'yellow',
                damage: player.bulletDamage
            });
        }
    }
    
    // Spiral shot if powered up
    if (player.spiralShot) {
        const numBullets = 8;
        for (let i = 0; i < numBullets; i++) {
            const angle = player.spiralAngle + (i * Math.PI * 2 / numBullets);
            bullets.push({
                x: player.x,
                y: player.y,
                dx: Math.cos(angle) * 8,
                dy: Math.sin(angle) * 8,
                radius: 6,
                color: 'orange',
                damage: player.bulletDamage
            });
        }
        player.spiralAngle += 0.2; // Rotate the spiral pattern
    }
    
    player.shootCooldown = 12; // frames
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.dx;
        b.y += b.dy;
        if (b.x < 0 || b.x > canvas.width || b.y < 0 || b.y > canvas.height) {
            bullets.splice(i, 1);
        }
    }
}

// Enemies
function spawnEnemy() {
    const edge = randomInt(0, 3);
    let x, y;
    if (edge === 0) { x = 0; y = randomInt(0, canvas.height); }
    else if (edge === 1) { x = canvas.width; y = randomInt(0, canvas.height); }
    else if (edge === 2) { x = randomInt(0, canvas.width); y = 0; }
    else { x = randomInt(0, canvas.width); y = canvas.height; }
    const enemy = {
        x, y,
        radius: 18,
        speed: 1.5 + Math.random(),
        color: 'red',
        hp: 2,
    };
    enemies.push(enemy);
    return enemy;
}

function changeRoom() {
    // Create adjacent rooms if they don't exist
    rooms.create(rooms.current.x, rooms.current.y - 1); // Top
    rooms.create(rooms.current.x, rooms.current.y + 1); // Bottom
    rooms.create(rooms.current.x - 1, rooms.current.y); // Left
    rooms.create(rooms.current.x + 1, rooms.current.y); // Right
    
    // Clear arrays since they're now room-specific
    bullets.length = 0;
    
    // If room is not cleared, spawn enemies
    const currentRoom = rooms.get(rooms.current.x, rooms.current.y);
    if (!currentRoom.cleared && currentRoom.enemies.length === 0) {
        const numEnemies = randomInt(3, 6);
        for (let i = 0; i < numEnemies; i++) {
            spawnEnemy();
        }
    }
}

function updateEnemies() {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const dist = Math.hypot(dx, dy);
        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;
        // Collision with player
        if (dist < player.radius + e.radius) {
            // Game over
            gameOver();
            return;
        }
    }
}

function resetGame() {
    // Reset player
    player.x = canvas.width / 2;
    player.y = canvas.height / 2;
    player.speed = 4;
    player.shootCooldown = 0;
    player.bulletDamage = 1;
    player.spiralShot = false;
    player.spiralAngle = 0;
    player.powerUps = [];
    // Reset arrays
    bullets.length = 0;
    enemies.length = 0;
    powerUps.length = 0;
    activePowerUps.length = 0;
    popupTexts.length = 0;
    score = 0;
    enemySpawnTimer = 0;
}

let isGameOver = false;
function gameOver() {
    isGameOver = true;
    draw();
    ctx.fillStyle = 'white';
    ctx.font = '40px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Game Over!', canvas.width/2, canvas.height/2 - 20);
    ctx.font = '28px Arial';
    ctx.fillText('Score: ' + score, canvas.width/2, canvas.height/2 + 20);
    ctx.font = '20px Arial';
    ctx.fillText('Restarting...', canvas.width/2, canvas.height/2 + 60);
    setTimeout(() => {
        resetGame();
        isGameOver = false;
        requestAnimationFrame(gameLoop);
    }, 2000);
}

// Bullet-enemy collision
function handleCollisions() {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        for (let j = bullets.length - 1; j >= 0; j--) {
            const b = bullets[j];
            const dist = Math.hypot(e.x - b.x, e.y - b.y);
            if (dist < e.radius + b.radius) {
                e.hp -= b.damage || 1;
                bullets.splice(j, 1);
                if (e.hp <= 0) {
                    // Chance to drop power-up
                    if (Math.random() < 0.3) { // Increased drop chance
                        const powerUpTypes = [
                            { type: 'speed', color: 'lightgreen' },
                            { type: 'rapid', color: 'cyan' },
                            { type: 'spiral', color: 'orange' },
                            { type: 'damage', color: 'red' }
                        ];
                        const powerUp = powerUpTypes[randomInt(0, powerUpTypes.length - 1)];
                        powerUps.push({
                            x: e.x,
                            y: e.y,
                            radius: 12,
                            color: powerUp.color,
                            type: powerUp.type,
                            duration: 600 // 10 seconds at 60fps
                        });
                    }
                    enemies.splice(i, 1);
                    score++;
                }
                break;
            }
        }
    }
}

// Power-ups
const activePowerUps = [];

function updatePowerUps() {
    // Update existing power-ups
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const p = powerUps[i];
        const dist = Math.hypot(player.x - p.x, player.y - p.y);
        if (dist < player.radius + p.radius) {
            // Add power-up effect
            const active = {
                type: p.type,
                duration: p.duration,
                originalValue: null
            };

            switch(p.type) {
                case 'speed':
                    active.originalValue = player.speed;
                    player.speed += 2;
                    break;
                case 'rapid':
                    active.originalValue = player.shootCooldown;
                    player.shootCooldown = Math.max(2, player.shootCooldown - 4);
                    break;
                case 'spiral':
                    player.spiralShot = true;
                    break;
                case 'damage':
                    active.originalValue = player.bulletDamage;
                    player.bulletDamage += 1;
                    break;
            }
            
            activePowerUps.push(active);
            powerUps.splice(i, 1);
            
            // Power-ups
            const activePowerUps = [];

            function updatePowerUps() {
                // Update existing power-ups
                for (let i = powerUps.length - 1; i >= 0; i--) {
                    const p = powerUps[i];
                    const dist = Math.hypot(player.x - p.x, player.y - p.y);
                    if (dist < player.radius + p.radius) {
                        // Add power-up effect
                        const active = {
                            type: p.type,
                            duration: p.duration,
                            originalValue: null
                        };

                        switch(p.type) {
                            case 'speed':
                                active.originalValue = player.speed;
                                player.speed += 2;
                                break;
                            case 'rapid':
                                active.originalValue = player.shootCooldown;
                                player.shootCooldown = Math.max(2, player.shootCooldown - 4);
                                break;
                            case 'spiral':
                                player.spiralShot = true;
                                break;
                            case 'damage':
                                active.originalValue = player.bulletDamage;
                                player.bulletDamage += 1;
                                break;
                        }
            
                        activePowerUps.push(active);
                        powerUps.splice(i, 1);
            
                        // Visual feedback
                        const text = p.type.charAt(0).toUpperCase() + p.type.slice(1) + "!";
                        showPopupText(text, player.x, player.y - 30, p.color);
                    }
                }
                // ...existing code...
            }

function drawPopupTexts() {
    for (let i = popupTexts.length - 1; i >= 0; i--) {
        const p = popupTexts[i];
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
        
        p.y -= 1;
        p.alpha = p.duration / 60;
        p.duration--;
        
        if (p.duration <= 0) {
            popupTexts.splice(i, 1);
        }
    }
}

// Player movement
function updatePlayer() {
    player.dx = 0;
    player.dy = 0;
    if (keys['w'] || keys['arrowup']) player.dy = -player.speed;
    if (keys['s'] || keys['arrowdown']) player.dy = player.speed;
    if (keys['a'] || keys['arrowleft']) player.dx = -player.speed;
    if (keys['d'] || keys['arrowright']) player.dx = player.speed;
    const nextX = player.x + player.dx;
    const nextY = player.y + player.dy;
    player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, nextX));
    player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, nextY));
}
    shoot();
    updateBullets();
    updateEnemies();
    handleCollisions();
    updatePowerUps();
    draw();
    // Spawn enemies
    enemySpawnTimer--;
    if (enemySpawnTimer <= 0) {
        spawnEnemy();
        enemySpawnTimer = Math.max(20, 60 - Math.floor(score / 5));
    }
    requestAnimationFrame(gameLoop);
}
// No changeRoom function needed
gameLoop();
