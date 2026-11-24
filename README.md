# MOLT | Daily Bullet-Hell Escape

A daily 6-chamber bullet-hell roguelike built for Reddit Devvit. Dodge enemy volleys, detonate explosive spores, stack upgrades across chambers, and compete on a shared daily leaderboard.

## Quick Start

```bash
npm install
npm run dev
```

Open http://127.0.0.1:2537 (or http://127.0.0.1:2537/splash.html for the Reddit inline splash card).

### Build and Reddit Playtest

```bash
npm run build
npx devvit upload
npx devvit playtest r/body_hop_dev
```

## What It Does

**Combat and Controls**
- Desktop: `WASD` or arrow keys to move, mouse aims (auto-fires toward your cursor), `Click` / `Space` / `Shift` to dash with brief invulnerability, `Esc` to pause.
- Touch: virtual movement pad on the left, auto-aiming at the nearest visible enemy, and a `DASH` button on the right.
- Bullet Graze: dashing through enemy projectiles clears them, refunds half your dash cooldown, and resets your shot timer immediately.

**Chambers, Upgrades, and Boss**
- Six deterministic daily chambers with a shared seed and rotating daily Chamber 3 layout.
- Multi-hit enemies (`Spitter`, `Beetle`, `Hopper`) with knockback, attack telegraphs, explosive spore pods, and a smooth time-based difficulty ramp.
- Clearing a chamber heals `+1` heart (up to `3`) and offers 3 of 6 stackable upgrades (`Triple Shot`, `Rapid Fire`, `Homing Shots`, `Ricochet`, `Acid Burst`, `Shock Dash`), plus an optional Chamber 3 Cursed Pact (`-1` heart for an extra upgrade).
- Chamber 6 features a multi-phase Keeper boss (`14 HP`) that speeds up at half health.

**Reddit Integration and Persistence**
- Inline Reddit splash card launching into full-screen play via `@devvit/web`.
- Automatic checkpoint saving between chambers and a Redis-backed Daily Leaderboard ranked by score (chambers cleared, escape bonus, kills, no-hit bonus, and clear speed).

## Tech Stack

| Layer | Tools |
|-------|-------|
| Game Engine | Phaser 4 (Canvas), TypeScript |
| Client Build | Vite 8 |
| Reddit Platform | Devvit Web (`@devvit/web`), Redis |
| Server / Validation | Node.js, esbuild, Zod |

## Project Structure

```
src/
  client/
    game.ts          # Phaser scene, combat visuals, spores, callouts, boss HUD
    input.ts         # Desktop mouse/keyboard and mobile touch input
    main.ts          # Game loop, HUD, upgrades, pause/restart, leaderboard UI
    art.ts           # Procedural creature sprites and mutation specimens
    room-art.ts      # Chamber surfaces and obstacle rendering
    audio.ts         # Web Audio procedural SFX (shots, dash, graze, spores)
    persistence.ts   # Checkpoint sync and offline cache
    splash.html      # Reddit inline post splash card
    game.html        # Full-screen game entrypoint
  server/
    index.ts         # Devvit server, daily post scheduler, mod menu action
    http.ts          # /api/bootstrap, /api/save, /api/result, /api/leaderboard
    db.ts            # Devvit Redis state and sorted-set leaderboard
    local.ts         # Local dev API and file-backed leaderboard
    state.ts         # Run state schema and mutation validation
  shared/
    content.ts       # Chambers, upgrades, constants, Daily Score formula
    engine.ts        # Pure simulation loop (movement, projectiles, dash, spores)
    types.ts         # Shared Zod schemas and engine types
devvit.json          # Devvit app manifest and scheduler config
```

---

Built by Thomas Ou
