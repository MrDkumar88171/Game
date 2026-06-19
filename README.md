# Battle Legends 4v4

A browser-based 3D multiplayer team-deathmatch shooter built with Three.js
(client rendering) and Node.js + Socket.io (real-time server). Portrait-mode,
touch-controlled, designed for Android browsers but runs anywhere a modern
WebGL browser does.

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3000` (or your machine's LAN IP from a phone on
the same network, e.g. `http://192.168.1.23:3000`, to test the touch controls
on an actual Android device).

No build step, no bundler — the client is plain ES modules loaded straight
from `/public`, with Three.js pulled from a CDN via an import map.

## Project structure

```
/project
  server.js              Express + Socket.io server: auth API, matchmaking, match state
  package.json
  public/
    index.html            All screens (splash/login/lobby/game/result) in one shell
    style.css             Full UI: tactical-HUD dark theme, glassmorphism auth cards
    js/
      main.js              App flow: splash -> auth -> lobby -> matchmaking -> result
      game.js              Three.js orchestration: lobby preview + battleground match loop
      map.js               Procedural battleground environment (terrain/buildings/props)
      player.js             Procedural humanoid rig + animation (idle/walk/run/jump/shoot/reload/death)
      weapon.js             Weapon stats table, weapon meshes, tracers, muzzle flash, impacts
      camera.js              Third-person follow camera (smoothing, collision, aim zoom)
      controls.js            Touch joystick, action buttons, swipe/pinch
      multiplayer.js         Socket.io client wrapper
      ui.js                  DOM/HUD helpers (HUD bars, minimap, kill feed, toasts, modals)
  assets/                (placeholders — see "About assets" below)
```

## How matchmaking works

Tapping **Start Match** queues you on the server. The server groups up to 8
queued players into a room and assigns alternating teams. If 8 humans aren't
available within ~8 seconds, the remaining slots are filled with server-driven
bots (simple wander + line-of-sight-free engage AI) so a match is always
playable solo. Real players and bots use the *exact same* sync path
(`player_state` broadcasts), so dropping in more real players simply replaces
bots over time — the netcode doesn't know the difference.

Movement/rotation/animation sync at ~12Hz from each client; hit detection is
client-raycast but **server-authoritative for damage** — a client reports
"I think I hit player X," and the server (which owns health/kills/team score)
decides what actually happens. This is the standard pattern for casual
browser shooters and prevents a single tampered client from healing itself
or granting itself kills.

## About the "realistic human characters"

This environment can't pull in licensed/Mixamo-style 3D character assets, so
characters are **procedurally rigged from primitives** (capsules/spheres/boxes
in a joint hierarchy) and animated with code-driven idle/walk/run/jump/shoot/
reload/death cycles — the same general technique used by lightweight browser
shooters like Krunker. They read clearly as soldiers with full body, breathing
idle, and weapon-holding poses, and they animate correctly — they're just
stylized rather than photoreal. Swapping in real `.glb` rigged models later is
straightforward: replace `createCharacter()` in `player.js` with a GLTFLoader
call and play imported `AnimationClip`s through `AnimationMixer` instead of
the procedural pose functions; everything else (camera, weapons, networking)
is decoupled from how the character is rendered.

## Known simplifications (clearly scoped, not bugs)

- **Player-vs-terrain collision** is flat-ground only; buildings/props block
  the *camera* (so it doesn't clip through walls) but not player movement yet.
  Wiring full capsule-vs-world collision is the natural next step.
- **Crouch** reduces speed but doesn't yet play a distinct crouched pose.
- **Grenades** use a fixed-distance toss + timed AOE check rather than real
  projectile physics.
- **Accounts/OTP** live in an in-memory Map so the demo runs with zero config.
  Swap in a real database and wire `sendOtpEmail()` in `server.js` to a
  provider (e.g. Nodemailer + SES/SendGrid) for production; right now the OTP
  is logged server-side and echoed in the dev API response.
- **Coins/XP/profile stats** update client-side after a match for the demo;
  a production build should write those back through an authenticated API
  call so progress can't be edited client-side.
- One battleground map (procedurally laid out from a seed sent by the
  server), not multiple map rotations.
- Weapon roster covers all 8 requested classes (M416/AK/SCAR/UMP/Vector/AWM/
  Shotgun/Desert Eagle) as a 2-slot primary+secondary loadout rather than a
  full pre-match loadout-customization screen.

## Performance notes

- Trees/rocks/bushes/barrels/crates use `InstancedMesh` (a few hundred props,
  a handful of draw calls).
- Bullet tracers and impact effects are pooled (`weapon.js`), not allocated
  per shot.
- `Fog` + a capped draw distance double as a cheap LOD substitute — distant
  detail fades into fog rather than needing real LOD meshes.
- Pixel ratio is capped at 2 and shadow maps are limited to one directional
  light to stay reasonable on mid-range Android GPUs. If you need it to run
  on low-end devices, the next lever is dropping `renderer.shadowMap.enabled`
  on a detected low-tier device.

## Deployment

Any Node host works (Render, Railway, Fly.io, a VPS, etc.):

1. `npm install --production`
2. Set `PORT` env var if your host requires a specific port (defaults to 3000).
3. `npm start`
4. Put it behind HTTPS — mobile browsers require a secure context for some
   touch/orientation APIs, and Socket.io will use WSS automatically over TLS.

For a quick LAN test on your own Android phone, just run `npm start` on your
laptop and visit your laptop's local IP from the phone's browser — no
deployment needed.
