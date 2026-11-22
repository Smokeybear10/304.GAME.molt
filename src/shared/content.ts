import type { Challenge, Encounter, MutationId, Species } from './types.ts';

export const CONTENT_VERSION = 'body-hop-v7';
const SEED_NAMESPACE = 'body-hop-v2';
export const ENCOUNTER_COUNT = 6;
export const WORLD_WIDTH = 720;
export const WORLD_HEIGHT = 960;
export const TICK_MS = 1000 / 60;
export const BODY_SWITCH_RANGE = 0;
export const BODY_SWITCH_COOLDOWN_MS = 350;
export const DASH_COOLDOWN_MS = 1000;
export const DASH_DURATION_MS = 160;
export const DASH_SPEED = 620;
export const DASH_INVULNERABLE_MS = 260;
export const BOSS_HP = 8;
export const EXIT_RADIUS = 66;
export const LEAP_RADIUS = { enemy: 80, player: 100 } as const;
export const LEAP_DISTANCE = 210;
export const PLAYER_BULLET_RADIUS = 14;
export const PLAYER_SPIT_SPEED = 600;
export const PLAYER_SPIT_WINDUP_MS = 55;
export const PLAYER_MELEE_WINDUP_MS = 80;
export const PLAYER_LEAP_BASE_MS = 140;
export const PLAYER_LEAP_RANGE_MS = 240;
export const ENEMY_WALK_SPEED_SCALE = 0.62;
export const MAX_PROJECTILES = 128;
export const MAX_ENEMY_PROJECTILES = 96;
export const POSSESSION_CLEAR_RADIUS = 72;
export const CHARGE_SPEED = 650;
export const CHARGE_DURATION_MS = 420;
export const SPECIES: Record<Species, { name: string; action: string; radius: number; speed: number; enemyHp: number; shell: number; basicMs: number; specialMs: number; enemySpecialMs: number }> = {
  spitter: { name: 'Spitter', action: 'Spit', radius: 30, speed: 215, enemyHp: 1, shell: 0, basicMs: 750, specialMs: 400, enemySpecialMs: 2800 },
  beetle: { name: 'Beetle', action: 'Ram', radius: 37, speed: 150, enemyHp: 1, shell: 0, basicMs: 780, specialMs: 1000, enemySpecialMs: 3900 },
  hopper: { name: 'Hopper', action: 'Pounce', radius: 30, speed: 205, enemyHp: 1, shell: 0, basicMs: 430, specialMs: 1200, enemySpecialMs: 4300 },
};
export const MUTATIONS: Record<MutationId, { name: string; description: string; morphology: string }> = {
  'split-glands': { name: 'Triple Shot', description: 'Fire a 3-way spread of shots instead of one.', morphology: 'Two lateral glands split every volley.' },
  'echo-tissue': { name: 'Rapid Fire', description: 'Fire 40% faster with quicker shots.', morphology: 'Pulsing muscle fibers speed up every shot.' },
  'venom-sacs': { name: 'Homing Shots', description: 'Your shots curve smoothly toward nearby enemies.', morphology: 'Swollen seeker sacs guide shots mid-flight.' },
  'silk-trail': { name: 'Ricochet', description: 'Your shots bounce off walls and pillars once.', morphology: 'Elastic filaments coat every projectile.' },
  'grave-bloom': { name: 'Acid Burst', description: 'Kills leave a toxic acid pool that melts nearby enemies.', morphology: 'Fungal spores burst open on every kill.' },
  'shock-molt': { name: 'Shock Dash', description: 'Dashing clears nearby enemy bullets and knocks enemies back.', morphology: 'Hardened plates snap outward when you dash.' },
};
export const MUTATION_IDS = Object.keys(MUTATIONS) as MutationId[];
export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function createChallenge(date: string, seed = hashSeed(`${SEED_NAMESPACE}:${date}`)): Challenge {
  return { id: `${CONTENT_VERSION}:${date}`, date, contentVersion: CONTENT_VERSION, seed: seed >>> 0 };
}
const GROUP_SIZES = [[2, 2, 2], [3, 3, 4], [4, 4, 4], [4, 5, 5], [5, 5, 6], [5, 6, 7]];
const ENCOUNTERS: Omit<Encounter, 'groups'>[] = [
  { name: 'First chamber', description: 'Weave through the volley. Dash through bullets when cornered.', start: { x: 360, y: 760 }, obstacles: [], enemies: [
    { species: 'beetle', x: 360, y: 420 }, { species: 'spitter', x: 180, y: 260 }, { species: 'hopper', x: 540, y: 360 }, { species: 'spitter', x: 540, y: 150 },
    { species: 'hopper', x: 120, y: 380 }, { species: 'spitter', x: 600, y: 300 },
  ] },
  { name: 'Split chamber', description: 'Use the center pillar to break enemy fire.', start: { x: 360, y: 800 }, obstacles: [{ x: 280, y: 390, width: 160, height: 110 }], enemies: [
    { species: 'spitter', x: 150, y: 200 }, { species: 'spitter', x: 570, y: 200 }, { species: 'beetle', x: 140, y: 540 }, { species: 'hopper', x: 570, y: 530 }, { species: 'beetle', x: 360, y: 150 }, { species: 'spitter', x: 100, y: 100 }, { species: 'spitter', x: 620, y: 330 },
    { species: 'hopper', x: 100, y: 730 }, { species: 'hopper', x: 620, y: 720 }, { species: 'spitter', x: 360, y: 80 },
  ] },
  { name: 'The charge lane', description: 'Dodge the beetle charges and control the center lane.', start: { x: 360, y: 800 }, obstacles: [{ x: 180, y: 330, width: 90, height: 180 }, { x: 450, y: 330, width: 90, height: 180 }], enemies: [
    { species: 'spitter', x: 140, y: 650 }, { species: 'spitter', x: 580, y: 650 }, { species: 'beetle', x: 360, y: 180 }, { species: 'hopper', x: 130, y: 200 }, { species: 'hopper', x: 590, y: 200 }, { species: 'spitter', x: 360, y: 100 }, { species: 'spitter', x: 100, y: 350 }, { species: 'spitter', x: 620, y: 350 },
    { species: 'spitter', x: 360, y: 620 }, { species: 'hopper', x: 100, y: 780 }, { species: 'hopper', x: 620, y: 780 }, { species: 'beetle', x: 360, y: 310 },
  ] },
  { name: 'Bone garden', description: 'Keep moving as crossfire tightens between the pillars.', start: { x: 360, y: 800 }, obstacles: [{ x: 180, y: 320, width: 90, height: 220 }, { x: 450, y: 320, width: 90, height: 220 }], enemies: [
    { species: 'beetle', x: 360, y: 230 }, { species: 'spitter', x: 100, y: 160 }, { species: 'spitter', x: 620, y: 160 }, { species: 'beetle', x: 350, y: 560 }, { species: 'hopper', x: 590, y: 630 }, { species: 'hopper', x: 130, y: 630 }, { species: 'spitter', x: 360, y: 100 }, { species: 'spitter', x: 100, y: 410 }, { species: 'spitter', x: 620, y: 410 },
    { species: 'spitter', x: 100, y: 700 }, { species: 'spitter', x: 620, y: 700 }, { species: 'hopper', x: 360, y: 650 }, { species: 'hopper', x: 360, y: 150 }, { species: 'beetle', x: 360, y: 400 },
  ] },
  { name: 'Molt furnace', description: 'Dense waves from every angle. Clear a lane and stay mobile.', start: { x: 360, y: 800 }, obstacles: [{ x: 285, y: 330, width: 150, height: 130 }], enemies: [
    { species: 'spitter', x: 100, y: 170 }, { species: 'spitter', x: 620, y: 170 }, { species: 'beetle', x: 180, y: 320 }, { species: 'beetle', x: 540, y: 320 }, { species: 'hopper', x: 140, y: 630 }, { species: 'hopper', x: 580, y: 630 }, { species: 'hopper', x: 360, y: 150 }, { species: 'spitter', x: 360, y: 580 }, { species: 'spitter', x: 100, y: 450 }, { species: 'spitter', x: 620, y: 450 },
    { species: 'spitter', x: 100, y: 720 }, { species: 'spitter', x: 620, y: 720 }, { species: 'hopper', x: 240, y: 680 }, { species: 'hopper', x: 480, y: 680 }, { species: 'beetle', x: 360, y: 560 }, { species: 'spitter', x: 360, y: 100 },
  ] },
  { name: 'The keeper', description: 'The keeper and its brood fill the room with fire. Break its armor to escape.', start: { x: 360, y: 810 }, obstacles: [{ x: 130, y: 390, width: 100, height: 120 }, { x: 490, y: 390, width: 100, height: 120 }], enemies: [
    { species: 'beetle', x: 360, y: 240, elite: true }, { species: 'spitter', x: 100, y: 150 }, { species: 'spitter', x: 620, y: 150 }, { species: 'hopper', x: 120, y: 640 }, { species: 'hopper', x: 600, y: 640 }, { species: 'beetle', x: 360, y: 520 }, { species: 'spitter', x: 360, y: 100 }, { species: 'hopper', x: 180, y: 280 }, { species: 'hopper', x: 540, y: 280 }, { species: 'spitter', x: 100, y: 300 }, { species: 'spitter', x: 620, y: 300 }, { species: 'spitter', x: 360, y: 680 },
    { species: 'spitter', x: 100, y: 780 }, { species: 'spitter', x: 620, y: 780 }, { species: 'spitter', x: 360, y: 360 }, { species: 'hopper', x: 300, y: 700 }, { species: 'hopper', x: 420, y: 700 }, { species: 'beetle', x: 360, y: 100 },
  ] },
];
export type DailyRoomMetadata = { id: string; name: string; description: string; encounterIndex: 2 };
const DAILY_ROOMS: (Omit<Encounter, 'groups'> & { id: string; groupSizes: number[] })[] = [
  { ...ENCOUNTERS[2]!, id: 'rib-passage', name: 'Rib passage', description: 'Weave through the narrow lane as charges close in.', groupSizes: [4, 4, 4] },
  { id: 'split-rib', name: 'Split rib', description: 'A rib divides the room. Bait shots around the cover.', start: { x: 360, y: 800 }, groupSizes: [4, 4, 4],
    obstacles: [{ x: 230, y: 515, width: 180, height: 20 }], enemies: [
      { species: 'beetle', x: 250, y: 640 }, { species: 'hopper', x: 470, y: 640 }, { species: 'spitter', x: 300, y: 580 },
      { species: 'hopper', x: 300, y: 460 }, { species: 'spitter', x: 300, y: 370 }, { species: 'spitter', x: 300, y: 280 }, { species: 'spitter', x: 100, y: 200 }, { species: 'spitter', x: 620, y: 180 },
      { species: 'spitter', x: 100, y: 350 }, { species: 'spitter', x: 620, y: 350 }, { species: 'hopper', x: 180, y: 780 }, { species: 'hopper', x: 540, y: 780 },
    ] },
  { id: 'molt-hollow', name: 'Molt hollow', description: 'Flanking pillars leave tight sightlines. Dash past the crossfire.', start: { x: 360, y: 800 }, groupSizes: [4, 4, 4],
    obstacles: [{ x: 125, y: 500, width: 70, height: 120 }, { x: 525, y: 500, width: 70, height: 120 }], enemies: [
      { species: 'beetle', x: 360, y: 530 }, { species: 'spitter', x: 210, y: 650 }, { species: 'hopper', x: 510, y: 650 },
      { species: 'hopper', x: 360, y: 300 }, { species: 'spitter', x: 260, y: 400 }, { species: 'spitter', x: 460, y: 400 }, { species: 'spitter', x: 100, y: 200 }, { species: 'spitter', x: 620, y: 180 },
      { species: 'spitter', x: 100, y: 350 }, { species: 'spitter', x: 620, y: 350 }, { species: 'hopper', x: 180, y: 780 }, { species: 'hopper', x: 540, y: 780 },
    ] },
];
function dailyRoomDefinition(challenge: Challenge) {
  const day = Math.floor(Date.parse(`${challenge.date}T00:00:00Z`) / 86400000);
  return DAILY_ROOMS[((day % DAILY_ROOMS.length) + DAILY_ROOMS.length) % DAILY_ROOMS.length]!;
}
export function getDailyRoom(challenge: Challenge): DailyRoomMetadata {
  const { id, name, description } = dailyRoomDefinition(challenge);
  return { id, name, description, encounterIndex: 2 };
}
export function getEncounter(challenge: Challenge, index: number): Encounter {
  const dailyRoom = index === 2 ? dailyRoomDefinition(challenge) : null;
  const template = dailyRoom ?? ENCOUNTERS[Math.min(ENCOUNTER_COUNT - 1, Math.max(0, index))]!;
  const mirrored = ((challenge.seed >>> (index % 16)) & 1) === 1;
  const ordered = index === ENCOUNTER_COUNT - 1 ? [...template.enemies.slice(1), template.enemies[0]!] : template.enemies;
  const enemies = ordered.map((spawn, ordinal) => ({ ...spawn, x: (mirrored ? WORLD_WIDTH - spawn.x : spawn.x) + (index === 0 ? 0 : hashSeed(`${challenge.seed}:${index}:${ordinal}`) % 31 - 15) }));
  let offset = 0;
  const groups = (dailyRoom?.groupSizes ?? GROUP_SIZES[index]!).map(size => { const group = enemies.slice(offset, offset + size); offset += size; return group; });
  return { ...template, start: { ...template.start },
    obstacles: template.obstacles.map(rect => ({ ...rect, x: mirrored ? WORLD_WIDTH - rect.x - rect.width : rect.x })),
    enemies, groups,
  };
}
export function getRewardOffers(challenge: Challenge, encounterIndex: number, owned: MutationId[]): MutationId[] {
  const ranked = MUTATION_IDS.filter(id => !owned.includes(id)).map(id => ({ id, rank: hashSeed(`${challenge.seed}:reward:${encounterIndex}:${id}`) }))
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id)).map(entry => entry.id);
  return ranked.slice(0, 3);
}
