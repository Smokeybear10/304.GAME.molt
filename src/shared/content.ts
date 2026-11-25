import type { Challenge, Encounter, MutationId, RunResult, Species } from './types.ts';

export const CONTENT_VERSION = 'body-hop-v10';
const SEED_NAMESPACE = 'body-hop-v2';
export const ENCOUNTER_COUNT = 6;
export const VIEW_WIDTH = 720;
export const VIEW_HEIGHT = 960;
export const WORLD_WIDTH = 1080;
export const WORLD_HEIGHT = 1440;
export const TICK_MS = 1000 / 60;
export const BODY_SWITCH_RANGE = 0;
export const BODY_SWITCH_COOLDOWN_MS = 350;
export const DASH_COOLDOWN_MS = 1000;
export const DASH_DURATION_MS = 115;
export const DASH_SPEED = 480;
export const DASH_INVULNERABLE_MS = 160;
export const BOSS_HP = 14;
export const EXIT_RADIUS = 66;
export const LEAP_RADIUS = { enemy: 80, player: 100 } as const;
export const LEAP_DISTANCE = 210;
export const PLAYER_BULLET_RADIUS = 14;
export const PLAYER_SPIT_SPEED = 560;
export const PLAYER_SPIT_WINDUP_MS = 90;
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
  spitter: { name: 'Spitter', action: 'Spit', radius: 30, speed: 215, enemyHp: 2, shell: 0, basicMs: 750, specialMs: 620, enemySpecialMs: 2800 },
  beetle: { name: 'Beetle', action: 'Ram', radius: 37, speed: 150, enemyHp: 3, shell: 0, basicMs: 780, specialMs: 1000, enemySpecialMs: 3900 },
  hopper: { name: 'Hopper', action: 'Pounce', radius: 30, speed: 205, enemyHp: 2, shell: 0, basicMs: 430, specialMs: 1200, enemySpecialMs: 4300 },
};
export const MUTATIONS: Record<MutationId, { name: string; description: string; morphology: string }> = {
  'split-glands': { name: 'Triple Shot', description: 'Fire a 3-way spread of shots instead of one.', morphology: 'Two lateral glands split every volley.' },
  'echo-tissue': { name: 'Rapid Fire', description: 'Fire 40% faster with quicker shots.', morphology: 'Pulsing muscle fibers speed up every shot.' },
  'venom-sacs': { name: 'Homing Shots', description: 'Your shots curve smoothly toward nearby enemies.', morphology: 'Swollen seeker sacs guide shots mid-flight.' },
  'silk-trail': { name: 'Ricochet', description: 'Your shots bounce off walls and pillars once.', morphology: 'Elastic filaments coat every projectile.' },
  'grave-bloom': { name: 'Acid Burst', description: 'Kills leave a toxic acid pool that melts nearby enemies.', morphology: 'Fungal spores burst open on every kill.' },
  'shock-molt': { name: 'Shock Dash', description: 'Dashing clears nearby enemy bullets and knocks enemies back.', morphology: 'Hardened plates snap outward when you dash.' },
  'pierce-barbs': { name: 'Piercing Shots', description: 'Your shots tear straight through enemies.', morphology: 'Needle barbs harden every projectile.' },
  'heavy-bile': { name: 'Heavy Shots', description: 'Huge high-impact shots deal double damage with heavy knockback.', morphology: 'Dense sacs compress every volley.' },
  'orbital-shell': { name: 'Orbital Shield', description: 'Two glowing shield orbs orbit you, blocking enemy bullets.', morphology: 'Detached shell satellites circle the host.' },
  'arc-nerve': { name: 'Chain Lightning', description: 'Hits arc a bolt of lightning to a nearby enemy for bonus damage.', morphology: 'Charged filaments spark across the shell.' },
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
  { name: 'First chamber', description: 'Use the corner cover and flank around the open floor.', start: { x: 540, y: 1210 }, obstacles: [
    { x: 130, y: 360, width: 170, height: 80 }, { x: 780, y: 860, width: 170, height: 90 },
  ], enemies: [
    { species: 'beetle', x: 540, y: 740 }, { species: 'spitter', x: 240, y: 520 }, { species: 'hopper', x: 840, y: 620 }, { species: 'spitter', x: 820, y: 260 },
    { species: 'hopper', x: 220, y: 820 }, { species: 'spitter', x: 880, y: 480 },
  ] },
  { name: 'Split chamber', description: 'Staggered cover bunkers create crossfire lanes across the room.', start: { x: 540, y: 1240 }, obstacles: [
    { x: 140, y: 310, width: 180, height: 95 }, { x: 740, y: 590, width: 190, height: 110 }, { x: 170, y: 920, width: 165, height: 95 },
  ], enemies: [
    { species: 'spitter', x: 220, y: 210 }, { species: 'spitter', x: 860, y: 240, variant: 'sniper' }, { species: 'beetle', x: 210, y: 720, variant: 'splitter' }, { species: 'hopper', x: 850, y: 810 }, { species: 'beetle', x: 540, y: 280 }, { species: 'spitter', x: 140, y: 540 }, { species: 'spitter', x: 930, y: 460 },
    { species: 'hopper', x: 160, y: 1090 }, { species: 'hopper', x: 920, y: 1080 }, { species: 'spitter', x: 540, y: 160, variant: 'sniper' },
  ] },
  { name: 'The charge lane', description: 'Wing walls frame wide flanking corridors on both edges.', start: { x: 540, y: 1240 }, obstacles: [
    { x: 110, y: 420, width: 110, height: 260 }, { x: 860, y: 420, width: 110, height: 260 }, { x: 430, y: 900, width: 220, height: 75 },
  ], enemies: [
    { species: 'spitter', x: 260, y: 960, variant: 'sniper' }, { species: 'spitter', x: 820, y: 960 }, { species: 'beetle', x: 540, y: 300, variant: 'splitter' }, { species: 'hopper', x: 240, y: 300 }, { species: 'hopper', x: 840, y: 300 }, { species: 'spitter', x: 540, y: 170, variant: 'sniper' }, { species: 'spitter', x: 290, y: 540 }, { species: 'spitter', x: 790, y: 540 },
    { species: 'spitter', x: 540, y: 760 }, { species: 'hopper', x: 160, y: 1150 }, { species: 'hopper', x: 920, y: 1150 }, { species: 'beetle', x: 540, y: 480, variant: 'splitter' },
  ] },
  { name: 'Bone garden', description: 'Rib-cage walls along the flanks shelter snipers and splitters.', start: { x: 540, y: 1240 }, obstacles: [
    { x: 120, y: 280, width: 115, height: 240 }, { x: 845, y: 280, width: 115, height: 240 },
    { x: 120, y: 820, width: 115, height: 220 }, { x: 845, y: 820, width: 115, height: 220 },
  ], enemies: [
    { species: 'beetle', x: 540, y: 350, variant: 'splitter' }, { species: 'spitter', x: 290, y: 230, variant: 'sniper' }, { species: 'spitter', x: 790, y: 230, variant: 'sniper' }, { species: 'beetle', x: 520, y: 820 }, { species: 'hopper', x: 790, y: 940 }, { species: 'hopper', x: 290, y: 940 }, { species: 'spitter', x: 540, y: 160 }, { species: 'spitter', x: 280, y: 620 }, { species: 'spitter', x: 800, y: 620 },
    { species: 'spitter', x: 290, y: 1060, variant: 'sniper' }, { species: 'spitter', x: 790, y: 1060 }, { species: 'hopper', x: 540, y: 980 }, { species: 'hopper', x: 540, y: 240 }, { species: 'beetle', x: 540, y: 600, variant: 'splitter' },
  ] },
  { name: 'Molt furnace', description: 'Corner bastions and side shields form a fast kiting ring.', start: { x: 540, y: 1250 }, obstacles: [
    { x: 150, y: 270, width: 140, height: 140 }, { x: 790, y: 270, width: 140, height: 140 },
    { x: 150, y: 900, width: 140, height: 140 }, { x: 790, y: 900, width: 140, height: 140 },
  ], enemies: [
    { species: 'spitter', x: 170, y: 170, variant: 'sniper' }, { species: 'spitter', x: 910, y: 170, variant: 'sniper' }, { species: 'beetle', x: 350, y: 490, variant: 'splitter' }, { species: 'beetle', x: 730, y: 490 }, { species: 'hopper', x: 320, y: 860 }, { species: 'hopper', x: 760, y: 860 }, { species: 'hopper', x: 540, y: 230 }, { species: 'spitter', x: 540, y: 780 }, { species: 'spitter', x: 130, y: 660 }, { species: 'spitter', x: 950, y: 660 },
    { species: 'spitter', x: 160, y: 1120, variant: 'sniper' }, { species: 'spitter', x: 920, y: 1120 }, { species: 'hopper', x: 380, y: 1060 }, { species: 'hopper', x: 700, y: 1060 }, { species: 'beetle', x: 540, y: 720, variant: 'splitter' }, { species: 'spitter', x: 540, y: 150 },
  ] },
  { name: 'The keeper', description: 'Four outer sanctuary pillars surround the Keeper’s open arena.', start: { x: 540, y: 1260 }, obstacles: [
    { x: 140, y: 310, width: 125, height: 135 }, { x: 815, y: 310, width: 125, height: 135 },
    { x: 140, y: 880, width: 125, height: 135 }, { x: 815, y: 880, width: 125, height: 135 },
  ], enemies: [
    { species: 'beetle', x: 540, y: 360, elite: true }, { species: 'spitter', x: 170, y: 200, variant: 'sniper' }, { species: 'spitter', x: 910, y: 200, variant: 'sniper' }, { species: 'hopper', x: 200, y: 740 }, { species: 'hopper', x: 880, y: 740 }, { species: 'beetle', x: 540, y: 740, variant: 'splitter' }, { species: 'spitter', x: 540, y: 160 }, { species: 'hopper', x: 340, y: 460 }, { species: 'hopper', x: 740, y: 460 }, { species: 'spitter', x: 140, y: 580 }, { species: 'spitter', x: 940, y: 580 }, { species: 'spitter', x: 540, y: 980 },
    { species: 'spitter', x: 170, y: 1140 }, { species: 'spitter', x: 910, y: 1140 }, { species: 'spitter', x: 540, y: 560 }, { species: 'hopper', x: 430, y: 1060 }, { species: 'hopper', x: 650, y: 1060 }, { species: 'beetle', x: 540, y: 170, variant: 'splitter' },
  ] },
];
export type DailyRoomMetadata = { id: string; name: string; description: string; encounterIndex: 2 };
const DAILY_ROOMS: (Omit<Encounter, 'groups'> & { id: string; groupSizes: number[] })[] = [
  { ...ENCOUNTERS[2]!, id: 'rib-passage', name: 'Rib passage', description: 'Wing walls frame wide flanking corridors on both edges.', groupSizes: [4, 4, 4] },
  { id: 'split-rib', name: 'Split rib', description: 'Offset shelves and flank cover split the sightlines.', start: { x: 540, y: 1240 }, groupSizes: [4, 4, 4],
    obstacles: [
      { x: 120, y: 690, width: 290, height: 48 }, { x: 780, y: 340, width: 170, height: 110 }, { x: 750, y: 920, width: 190, height: 75 },
    ], enemies: [
      { species: 'beetle', x: 360, y: 920, variant: 'splitter' }, { species: 'hopper', x: 720, y: 860 }, { species: 'spitter', x: 460, y: 820 },
      { species: 'hopper', x: 420, y: 560 }, { species: 'spitter', x: 420, y: 440, variant: 'sniper' }, { species: 'spitter', x: 420, y: 310 }, { species: 'spitter', x: 170, y: 270 }, { species: 'spitter', x: 910, y: 240, variant: 'sniper' },
      { species: 'spitter', x: 160, y: 520 }, { species: 'spitter', x: 920, y: 540 }, { species: 'hopper', x: 260, y: 1140 }, { species: 'hopper', x: 820, y: 1140 },
    ] },
  { id: 'molt-hollow', name: 'Molt hollow', description: 'Four perimeter bastions guard an open center crossroad.', start: { x: 540, y: 1240 }, groupSizes: [4, 4, 4],
    obstacles: [
      { x: 130, y: 340, width: 120, height: 180 }, { x: 830, y: 340, width: 120, height: 180 },
      { x: 130, y: 840, width: 120, height: 180 }, { x: 830, y: 840, width: 120, height: 180 },
    ], enemies: [
      { species: 'beetle', x: 540, y: 740, variant: 'splitter' }, { species: 'spitter', x: 330, y: 940, variant: 'sniper' }, { species: 'hopper', x: 750, y: 940 },
      { species: 'hopper', x: 540, y: 420 }, { species: 'spitter', x: 370, y: 580 }, { species: 'spitter', x: 710, y: 580 }, { species: 'spitter', x: 170, y: 230 }, { species: 'spitter', x: 910, y: 230, variant: 'sniper' },
      { species: 'spitter', x: 170, y: 660 }, { species: 'spitter', x: 910, y: 660 }, { species: 'hopper', x: 300, y: 1140 }, { species: 'hopper', x: 780, y: 1140 },
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
export function computeRunScore(result: Pick<RunResult, 'outcome' | 'completedEncounters' | 'activeTimeMs' | 'counters'>): number {
  const chambers = result.completedEncounters * 1000;
  const escapeBonus = result.outcome === 'escaped' ? 2000 : 0;
  const kills = result.counters.kills * 30;
  const noHitBonus = result.outcome === 'escaped' && result.counters.damageTaken === 0
    ? 1500
    : Math.max(0, Math.round((3 - result.counters.damageTaken) * 250));
  const speedBonus = result.outcome === 'escaped'
    ? Math.max(0, Math.round(1800 - result.activeTimeMs / 100))
    : 0;
  return chambers + escapeBonus + kills + noHitBonus + speedBonus;
}
