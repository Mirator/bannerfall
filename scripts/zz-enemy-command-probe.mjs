// Scratch diagnostic for plans/027: trace one battle's commander decisions and unit state.
// node scripts/zz-enemy-command-probe.mjs [seed]
import { chromium } from '@playwright/test';

const seed = Number(process.argv[2] || 1);
const DT = 1 / 60;
const rep = (type, n) => Array.from({ length: n }, () => ({ type }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto('http://127.0.0.1:8474/');

const trace = await page.evaluate(({ troops, enemies, seed, dt }) => {
  const game = window.__g;
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720; game.camera.w = 1280; game.camera.h = 720;
  const real = game.update.bind(game);
  game.update = () => {};
  const log = [];
  try {
    game.startBattle({
      troops, enemies, seed, title: 'PROBE', arena: 'road', biome: 'rose',
      deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
    });
    const b = game.scene;
    b.state = 'fight'; b.deployT = 0;
    game.input.injectMouse(640, 360, false);
    game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
    let t = 0, next = 0;
    while (b.state !== 'end' && t < 90) {
      real(dt); t += dt;
      if (t >= next) {
        next += 5;
        log.push({
          t: Math.round(t),
          doctrine: b.enemyCmd.doctrine,
          spread: Math.round(b.enemyCmd.spread),
          bloodlust: b.bloodlust,
          troops: b.troops.length,
          enemies: b.enemies.map(e => e.type + ':' + Math.round(e.hp)).join(' '),
          stances: Object.entries(b.enemySquads).map(([k, v]) => k[0] + '=' + v.stance).join(' '),
          anchorD: Math.round(Math.hypot(b.enemyCmd.anchorX - b.enemyCmd.cx, b.enemyCmd.anchorY - b.enemyCmd.cy)),
          lastDeath: Math.round(b.time - b.lastDeath),
          detail: b.enemies.map(e => {
            let best = Infinity;
            for (const t of b.troops) best = Math.min(best, Math.hypot(t.x - e.x, t.y - e.y));
            best = Math.min(best, Math.hypot(b.hero.x - e.x, b.hero.y - e.y));
            return `${e.type} d=${Math.round(best)} cd=${e.cd.toFixed(1)} w=${e.windupT.toFixed(1)} blind=${e.blindT.toFixed(1)} v=${Math.round(Math.hypot(e.vx, e.vy))}`;
          }).join(' | '),
        });
      }
    }
    return { resolved: b.state === 'end', victory: !!b.victory, t: Math.round(t * 10) / 10, log };
  } finally { game.update = real; }
}, {
  troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
  enemies: [...rep('bandit', 3), ...rep('raider', 2), ...rep('wolf', 2)],
  seed, dt: DT,
});

console.log(`seed ${seed}: resolved=${trace.resolved} victory=${trace.victory} t=${trace.t}`);
for (const r of trace.log) console.log(JSON.stringify(r));
await browser.close();
