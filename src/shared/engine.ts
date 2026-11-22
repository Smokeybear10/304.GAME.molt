import { CheckpointSchema } from './types.ts';
import type { Actor, BulletPattern, Checkpoint, Challenge, Corpse, GameEvent, HealthModel, InputFrame, MutationId, Rect, Run, RunResult, Species, Vec2 } from './types.ts';
import { BODY_SWITCH_COOLDOWN_MS, BOSS_HP, CHARGE_DURATION_MS, CHARGE_SPEED, CONTENT_VERSION, DASH_COOLDOWN_MS, DASH_DURATION_MS, DASH_INVULNERABLE_MS, DASH_SPEED, ENCOUNTER_COUNT, ENEMY_WALK_SPEED_SCALE, EXIT_RADIUS, LEAP_DISTANCE, LEAP_RADIUS, MAX_ENEMY_PROJECTILES, MAX_PROJECTILES, PLAYER_BULLET_RADIUS, PLAYER_LEAP_BASE_MS, PLAYER_LEAP_RANGE_MS, PLAYER_MELEE_WINDUP_MS, PLAYER_SPIT_SPEED, PLAYER_SPIT_WINDUP_MS, POSSESSION_CLEAR_RADIUS, SPECIES, TICK_MS, WORLD_HEIGHT, WORLD_WIDTH, getEncounter, getRewardOffers } from './content.ts';

export const EMPTY_INPUT: InputFrame = { moveX: 0, moveY: 0, aimX: 0, aimY: -1, attackHeld: false, abilityPressed: false, assistedBasic: true, hopHeld: false, hopCommitId: null, hopCancelled: false, dashPressed: false };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const direction = (x: number, y: number): Vec2 => {
  const length = Math.hypot(x, y);
  return length > 0.0001 && Number.isFinite(length) ? { x: x / length, y: y / length } : { x: 0, y: 0 };
};
const has = (run: Run, mutation: MutationId) => run.mutations.includes(mutation);
function paceScale(run: Run): number {
  const roomRamp = 0.58 + 0.42 * clamp(run.encounterTimeMs / 12000, 0, 1);
  const runRamp = 0.72 + 0.38 * clamp(run.activeTimeMs / 100000, 0, 1);
  return clamp(roomRamp * runRamp, 0.5, 1.15);
}

export function segmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function crossesRect(start: Vec2, end: Vec2, rect: Rect, padding = 0): boolean {
  let near = 0;
  let far = 1;
  for (const [origin, delta, min, max] of [
    [start.x, end.x - start.x, rect.x - padding, rect.x + rect.width + padding],
    [start.y, end.y - start.y, rect.y - padding, rect.y + rect.height + padding],
  ]) {
    if (Math.abs(delta!) < 0.00001) {
      if (origin! < min! || origin! > max!) return false;
    } else {
      const a = (min! - origin!) / delta!;
      const b = (max! - origin!) / delta!;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return false;
    }
  }
  return true;
}

export function hasLineOfSight(run: Run, from: Vec2, to: Vec2, padding = 0): boolean {
  return !run.obstacles.some(rect => crossesRect(from, to, rect, padding));
}

function rayRectDistance(from: Vec2, aim: Vec2, rect: Rect): number {
  let near = -Infinity;
  let far = Infinity;
  for (const [origin, delta, min, max] of [
    [from.x, aim.x, rect.x, rect.x + rect.width],
    [from.y, aim.y, rect.y, rect.y + rect.height],
  ]) {
    if (Math.abs(delta!) < 1e-9) {
      if (origin! <= min! + 1e-7 || origin! >= max! - 1e-7) return Infinity;
    } else {
      const a = (min! - origin!) / delta!;
      const b = (max! - origin!) / delta!;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
  }
  return far <= 1e-7 || near >= far - 1e-7 ? Infinity : Math.max(0, near);
}

function rayCircleDistance(from: Vec2, aim: Vec2, centre: Vec2, radius: number): number {
  const x = from.x - centre.x;
  const y = from.y - centre.y;
  const b = 2 * (x * aim.x + y * aim.y);
  const c = x * x + y * y - radius * radius;
  if (c <= 1e-7) return b < -1e-7 ? 0 : Infinity;
  const discriminant = b * b - 4 * c;
  if (discriminant <= 1e-7) return Infinity;
  const hit = (-b - Math.sqrt(discriminant)) / 2;
  return hit >= 0 ? hit : Infinity;
}

export function previewCharge(run: Pick<Run, 'obstacles'>, from: Vec2 & { radius: number }, dirX: number, dirY: number, maxDistance = CHARGE_SPEED * CHARGE_DURATION_MS / 1000): Vec2 {
  const aim = direction(dirX, dirY);
  if (!aim.x && !aim.y) return { x: from.x, y: from.y };
  let travel = Math.max(0, maxDistance);
  let contact = Infinity;
  if (aim.x > 0) contact = Math.min(contact, (WORLD_WIDTH - from.radius - 8 - from.x) / aim.x);
  if (aim.x < 0) contact = Math.min(contact, (from.radius + 8 - from.x) / aim.x);
  if (aim.y > 0) contact = Math.min(contact, (WORLD_HEIGHT - from.radius - 8 - from.y) / aim.y);
  if (aim.y < 0) contact = Math.min(contact, (from.radius + 8 - from.y) / aim.y);
  for (const rect of run.obstacles) {
    contact = Math.min(contact,
      rayRectDistance(from, aim, { x: rect.x - from.radius, y: rect.y, width: rect.width + from.radius * 2, height: rect.height }),
      rayRectDistance(from, aim, { x: rect.x, y: rect.y - from.radius, width: rect.width, height: rect.height + from.radius * 2 }),
    );
    for (const x of [rect.x, rect.x + rect.width]) for (const y of [rect.y, rect.y + rect.height])
      contact = Math.min(contact, rayCircleDistance(from, aim, { x, y }, from.radius));
  }
  if (contact <= travel) travel = Math.max(0, contact - 0.0001);
  return { x: from.x + aim.x * travel, y: from.y + aim.y * travel };
}

function closestSurface(point: Vec2, rect: Rect): Vec2 {
  const x = clamp(point.x, rect.x, rect.x + rect.width);
  const y = clamp(point.y, rect.y, rect.y + rect.height);
  if (x !== point.x || y !== point.y) return { x, y };
  const edges = [
    { gap: point.x - rect.x, x: rect.x, y },
    { gap: rect.x + rect.width - point.x, x: rect.x + rect.width, y },
    { gap: point.y - rect.y, x, y: rect.y },
    { gap: rect.y + rect.height - point.y, x, y: rect.y + rect.height },
  ];
  const nearest = edges.sort((a, b) => a.gap - b.gap)[0]!;
  return { x: nearest.x, y: nearest.y };
}

function collisionSurface(run: Run, from: Vec2, to: Vec2, radius: number, kind: 'spit' | 'charge'): (Vec2 & { material: 'bread' | 'ceramic' }) | null {
  const aim = direction(to.x - from.x, to.y - from.y);
  const travel = distance(from, to);
  const inset = kind === 'charge' ? radius + 8 : 0;
  const surfaceInset = kind === 'charge' ? 8 : 0;
  let nearest = Infinity;
  let surface: (Vec2 & { material: 'bread' | 'ceramic' }) | null = null;
  const boundary = (length: number, axis: 'x' | 'y', coordinate: number) => {
    if (length < -0.00001 || length > travel + 0.00001 || length >= nearest) return;
    nearest = Math.max(0, length);
    surface = { x: from.x + aim.x * nearest, y: from.y + aim.y * nearest, material: 'ceramic', [axis]: coordinate };
  };
  if (aim.x > 0) boundary((WORLD_WIDTH - inset - from.x) / aim.x, 'x', WORLD_WIDTH - surfaceInset);
  if (aim.x < 0) boundary((inset - from.x) / aim.x, 'x', surfaceInset);
  if (aim.y > 0) boundary((WORLD_HEIGHT - inset - from.y) / aim.y, 'y', WORLD_HEIGHT - surfaceInset);
  if (aim.y < 0) boundary((inset - from.y) / aim.y, 'y', surfaceInset);
  for (const rect of run.obstacles) {
    let contact: number;
    if (kind === 'spit') {
      if (!crossesRect(from, to, rect, radius)) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const enterX = Math.abs(dx) < 0.00001 ? -Infinity : Math.min((rect.x - radius - from.x) / dx, (rect.x + rect.width + radius - from.x) / dx);
      const enterY = Math.abs(dy) < 0.00001 ? -Infinity : Math.min((rect.y - radius - from.y) / dy, (rect.y + rect.height + radius - from.y) / dy);
      contact = Math.max(0, enterX, enterY) * travel;
    } else {
      contact = Math.min(
        rayRectDistance(from, aim, { x: rect.x - radius, y: rect.y, width: rect.width + radius * 2, height: rect.height }),
        rayRectDistance(from, aim, { x: rect.x, y: rect.y - radius, width: rect.width, height: rect.height + radius * 2 }),
      );
      for (const x of [rect.x, rect.x + rect.width]) for (const y of [rect.y, rect.y + rect.height])
        contact = Math.min(contact, rayCircleDistance(from, aim, { x, y }, radius));
    }
    if (contact > travel + 0.00001 || contact >= nearest) continue;
    nearest = contact;
    surface = { ...closestSurface({ x: from.x + aim.x * contact, y: from.y + aim.y * contact }, rect), material: 'bread' };
  }
  return surface;
}

function fitPosition(run: Run, x: number, y: number, radius: number): Vec2 {
  let px = clamp(x, radius + 8, WORLD_WIDTH - radius - 8);
  let py = clamp(y, radius + 8, WORLD_HEIGHT - radius - 8);
  for (const rect of run.obstacles) {
    const nx = clamp(px, rect.x, rect.x + rect.width);
    const ny = clamp(py, rect.y, rect.y + rect.height);
    const dx = px - nx;
    const dy = py - ny;
    const length = Math.hypot(dx, dy);
    if (length >= radius) continue;
    if (length > 0.001) {
      px = nx + dx / length * radius;
      py = ny + dy / length * radius;
    } else {
      const exits = [
        { d: Math.abs(px - rect.x), x: rect.x - radius, y: py },
        { d: Math.abs(px - rect.x - rect.width), x: rect.x + rect.width + radius, y: py },
        { d: Math.abs(py - rect.y), x: px, y: rect.y - radius },
        { d: Math.abs(py - rect.y - rect.height), x: px, y: rect.y + rect.height + radius },
      ].sort((a, b) => a.d - b.d);
      px = exits[0]!.x;
      py = exits[0]!.y;
    }
  }
  return { x: clamp(px, radius + 8, WORLD_WIDTH - radius - 8), y: clamp(py, radius + 8, WORLD_HEIGHT - radius - 8) };
}

function moveActor(run: Run, actor: Actor, dx: number, dy: number): void {
  const horizontal = fitPosition(run, actor.x + dx, actor.y, actor.radius);
  const vertical = fitPosition(run, horizontal.x, horizontal.y + dy, actor.radius);
  actor.x = vertical.x;
  actor.y = vertical.y;
  if (actor.action?.kind === 'charge') {
    const remaining = actor.action.stage === 'windup' ? CHARGE_DURATION_MS : actor.action.durationMs - actor.action.timeMs;
    const endpoint = previewCharge(run, actor, actor.action.dirX, actor.action.dirY, CHARGE_SPEED * remaining / 1000);
    actor.action.targetX = endpoint.x;
    actor.action.targetY = endpoint.y;
  }
}

function displace(run: Run, actor: Actor, dx: number, dy: number): void {
  actor.navigation = null;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 12));
  for (let index = 0; index < steps; index += 1) moveActor(run, actor, dx / steps, dy / steps);
}

function makeActor(run: Run, species: Species, faction: Actor['faction'], x: number, y: number, elite = false): Actor {
  const definition = SPECIES[species];
  const hp = faction === 'enemy' ? (elite ? BOSS_HP : definition.enemyHp) : run.core;
  const point = fitPosition(run, x, y, definition.radius * (elite ? 1.2 : 1));
  return {
    id: run.nextEntityId++, species, faction, ...point, radius: definition.radius * (elite ? 1.2 : 1), hp, maxHp: faction === 'enemy' ? hp : run.maxCore,
    shell: 0, maxShell: 0,
    facingX: 0, facingY: faction === 'enemy' ? 1 : -1,
    basicCooldownMs: faction === 'enemy' ? 700 : 0, specialCooldownMs: faction === 'enemy' ? 1100 + run.nextEntityId % 4 * 180 : 0,
    invulnerableMs: 0, stunMs: 0, poisonMs: 0, poisonTickMs: 0, poisonOwnerId: 0,
    action: null, lastSpecial: null, elite, volleyCount: 0, navigation: null,
  };
}

export function getPlayer(run: Run): Actor {
  return run.actors.find(actor => actor.id === run.playerId)!;
}

function prepareEncounter(run: Run, host: Checkpoint['host']): void {
  const encounter = getEncounter(run.challenge, run.encounterIndex);
  run.obstacles = encounter.obstacles;
  run.actors = [];
  run.corpses = [];
  run.projectiles = [];
  run.areas = [];
  run.silkTrail = null;
  run.encounterTimeMs = 0;
  run.encounterGroup = 0;
  run.hopCooldownMs = 0;
  run.rewardOffers = [];
  const player = makeActor(run, host.species, 'player', encounter.start.x, encounter.start.y);
  player.shell = 0;
  player.specialCooldownMs = host.specialCooldownMs;
  player.basicCooldownMs = host.basicCooldownMs;
  player.invulnerableMs = 600;
  player.lastSpecial = host.lastSpecial ? { ...host.lastSpecial } : null;
  run.playerId = player.id;
  const initialEnemies = encounter.groups[0]!.map((spawn, index) => {
    const enemy = makeActor(run, spawn.species, 'enemy', spawn.x, spawn.y, spawn.elite);
    enemy.basicCooldownMs = 1500 + index * 280;
    enemy.specialCooldownMs = 2200 + index * 350;
    return enemy;
  });
  run.actors.push(player, ...initialEnemies);
  run.phase = 'ready';
  run.resumePhase = 'ready';
}

function recordEncounterEntry(run: Run): void {
  run.encounterRecords.push({ encounterIndex: run.encounterIndex, entrySpecies: getPlayer(run).species, entryMutations: [...run.mutations],
    startLineageIndex: run.lineage.length - 1, combatEndLineageIndex: null, outcome: 'active' });
}

function recordCombatEnd(run: Run, outcome: 'cleared' | 'failed'): void {
  const record = run.encounterRecords[run.encounterIndex]!;
  record.outcome = outcome;
  record.combatEndLineageIndex = run.lineage.length;
}

function captureBoundary(run: Run): Checkpoint {
  const player = getPlayer(run);
  return {
    schemaVersion: 2, challengeId: run.challenge.id, contentVersion: run.challenge.contentVersion, runId: run.runId, healthModel: 'shared',
    encounterIndex: run.encounterIndex, boundary: run.phase === 'reward' ? 'reward' : run.phase === 'cleared' ? 'cleared' : 'encounter-start',
    core: run.core, maxCore: 3, hopCooldownMs: run.hopCooldownMs,
    host: { species: player.species, shell: 0, specialCooldownMs: player.specialCooldownMs, basicCooldownMs: player.basicCooldownMs, lastSpecial: player.lastSpecial ? { ...player.lastSpecial } : null, position: fitPosition(run, player.x, player.y, player.radius) },
    clearedCorpses: run.phase === 'cleared' ? run.corpses.map(corpse => ({ ...corpse })) : [],
    mutations: [...run.mutations], rewardOffers: [...run.rewardOffers], completedEncounters: run.completedEncounters,
    activeTimeMs: run.activeTimeMs, lineage: run.lineage.map(entry => ({ ...entry })), counters: { ...run.counters }, nextEntityId: run.nextEntityId,
    encounterRecords: run.encounterRecords.map(record => ({ ...record, entryMutations: [...record.entryMutations] })),
  };
}

export function createCheckpoint(run: Run): Checkpoint {
  const checkpoint = run.boundaryCheckpoint ?? captureBoundary(run);
  return { ...checkpoint, host: { ...checkpoint.host, position: checkpoint.host.position ? { ...checkpoint.host.position } : null, lastSpecial: checkpoint.host.lastSpecial ? { ...checkpoint.host.lastSpecial } : null }, clearedCorpses: checkpoint.clearedCorpses.map(corpse => ({ ...corpse })), mutations: [...checkpoint.mutations], rewardOffers: [...checkpoint.rewardOffers], lineage: checkpoint.lineage.map(entry => ({ ...entry })), encounterRecords: checkpoint.encounterRecords.map(record => ({ ...record, entryMutations: [...record.entryMutations] })), counters: { ...checkpoint.counters } };
}

export function createRun(challenge: Challenge, _healthModel: HealthModel = 'shared', runId = `${challenge.id}:attempt`): Run {
  const maxCore = 3;
  const run: Run = {
    challenge: { ...challenge }, runId, healthModel: 'shared', phase: 'ready', resumePhase: 'ready', encounterIndex: 0, completedEncounters: 0,
    core: maxCore, maxCore, playerId: 0, actors: [], corpses: [], projectiles: [], areas: [], silkTrail: null, obstacles: [], mutations: [], rewardOffers: [],
    activeTimeMs: 0, encounterTimeMs: 0, lineage: [{ species: 'spitter', encounterIndex: 0, atMs: 0 }], encounterRecords: [],
    counters: { kills: 0, hops: 0, specials: 0, damageTaken: 0 }, nextEntityId: 1, hopCooldownMs: 0, lossCause: '', boundaryCheckpoint: null, encounterGroup: 0, exit: { x: WORLD_WIDTH / 2, y: 72 },
  };
  prepareEncounter(run, { species: 'spitter', shell: 0, specialCooldownMs: 0, basicCooldownMs: 0, lastSpecial: null, position: null });
  recordEncounterEntry(run);
  run.boundaryCheckpoint = captureBoundary(run);
  return run;
}

export function restoreCheckpoint(value: unknown, challenge: Challenge): Run | null {
  const parsed = CheckpointSchema.safeParse(value);
  if (!parsed.success) return null;
  const checkpoint = parsed.data;
  if (checkpoint.challengeId !== challenge.id || checkpoint.contentVersion !== challenge.contentVersion || challenge.contentVersion !== CONTENT_VERSION || checkpoint.core <= 0) return null;
  if (checkpoint.healthModel !== 'shared' || checkpoint.host.shell !== 0 || checkpoint.maxCore !== 3) return null;
  const offers = checkpoint.boundary === 'reward' ? getRewardOffers(challenge, checkpoint.encounterIndex, checkpoint.mutations) : [];
  if (offers.join(',') !== checkpoint.rewardOffers.join(',')) return null;
  const run = createRun(challenge, checkpoint.healthModel, checkpoint.runId);
  run.encounterIndex = checkpoint.encounterIndex;
  run.completedEncounters = checkpoint.completedEncounters;
  run.core = checkpoint.core;
  run.maxCore = checkpoint.maxCore;
  run.mutations = [...checkpoint.mutations];
  run.activeTimeMs = checkpoint.activeTimeMs;
  run.lineage = checkpoint.lineage.map(entry => ({ ...entry }));
  run.encounterRecords = checkpoint.encounterRecords.map(record => ({ ...record, entryMutations: [...record.entryMutations] }));
  run.counters = { ...checkpoint.counters };
  run.nextEntityId = checkpoint.nextEntityId;
  prepareEncounter(run, checkpoint.host);
  run.hopCooldownMs = checkpoint.hopCooldownMs;
  if (checkpoint.boundary === 'reward' || checkpoint.boundary === 'cleared') {
    run.actors = [getPlayer(run)];
    run.phase = checkpoint.boundary;
    run.resumePhase = checkpoint.boundary;
    run.rewardOffers = offers;
    run.encounterGroup = getEncounter(challenge, run.encounterIndex).groups.length - 1;
    if (checkpoint.boundary === 'cleared') {
      run.corpses = checkpoint.clearedCorpses.map(corpse => ({ ...corpse }));
      if (checkpoint.host.position) Object.assign(getPlayer(run), fitPosition(run, checkpoint.host.position.x, checkpoint.host.position.y, getPlayer(run).radius));
    }
  }
  run.boundaryCheckpoint = { ...checkpoint };
  return run;
}

export function startEncounter(run: Run): GameEvent[] {
  if (run.phase !== 'ready') return [];
  run.phase = 'playing';
  run.resumePhase = 'playing';
  return [{ type: 'spawn', ids: run.actors.filter(actor => actor.faction === 'enemy' && actor.hp > 0).map(actor => actor.id),
    group: run.encounterGroup, totalGroups: getEncounter(run.challenge, run.encounterIndex).groups.length }];
}
export function pause(run: Run): void {
  if (run.phase !== 'ready' && run.phase !== 'playing' && run.phase !== 'cleared' && run.phase !== 'reward') return;
  run.resumePhase = run.phase;
  run.phase = 'paused';
}
export function resume(run: Run): void {
  if (run.phase === 'paused') run.phase = run.resumePhase;
}
function advanceEncounter(run: Run): void {
  const player = getPlayer(run);
  const host: Checkpoint['host'] = { species: player.species, shell: 0, specialCooldownMs: 0, basicCooldownMs: 0, lastSpecial: player.lastSpecial, position: null };
  run.encounterIndex += 1;
  prepareEncounter(run, host);
  recordEncounterEntry(run);
  run.boundaryCheckpoint = captureBoundary(run);
}
export function chooseMutation(run: Run, offerId: MutationId, replaceSlot: 0 | 1 | null = null): GameEvent[] {
  if (run.phase !== 'reward' || !run.rewardOffers.includes(offerId) || run.mutations.includes(offerId)) return [];
  if (run.mutations.length < 5) run.mutations.push(offerId);
  else if (replaceSlot === 0 || replaceSlot === 1) run.mutations[replaceSlot] = offerId;
  else return [];
  const player = getPlayer(run);
  const event: GameEvent = { type: 'mutation', mutationId: offerId, x: player.x, y: player.y };
  advanceEncounter(run);
  return [event];
}
export function skipReward(run: Run): GameEvent[] {
  if (run.phase === 'reward') advanceEncounter(run);
  return [];
}
export function createResult(run: Run): RunResult | null {
  if (run.phase !== 'dead' && run.phase !== 'escaped') return null;
  return { schemaVersion: 2, challengeId: run.challenge.id, contentVersion: run.challenge.contentVersion, runId: run.runId, healthModel: 'shared',
    outcome: run.phase, completedEncounters: run.completedEncounters, activeTimeMs: run.activeTimeMs, mutations: [...run.mutations],
    lineage: run.lineage.map(entry => ({ ...entry })), encounterRecords: run.encounterRecords.map(record => ({ ...record, entryMutations: [...record.entryMutations] })), counters: { ...run.counters }, cause: run.phase === 'escaped' ? 'Escaped the keeper.' : run.lossCause };
}

function nearbyBodies(_run: Run): Corpse[] {
  return [];
}

export function getNearbyBody(_run: Run): Corpse | null {
  return null;
}

export function canSwitchBody(_run: Run, _corpseId: number): boolean {
  return false;
}

function canTakeDamage(target: Actor): boolean {
  return target.hp > 0 && target.faction !== 'echo' && (target.faction !== 'player' || (target.invulnerableMs <= 0 && target.action?.kind !== 'dash'));
}

function damage(run: Run, target: Actor, amount: number, sourceId: number, generation: 0 | 1, poison: boolean, cause: string, events: GameEvent[]): boolean {
  if (!canTakeDamage(target)) return false;
  let shellDamage = 0;
  let coreDamage = 0;
  if (target.faction === 'player') {
    if (!run.actors.some(actor => actor.faction === 'enemy' && actor.hp > 0) && run.encounterGroup === getEncounter(run.challenge, run.encounterIndex).groups.length - 1) return false;
    amount = 1;
    target.shell = 0;
    coreDamage = Math.min(run.core, amount);
    run.core = Math.max(0, run.core - coreDamage);
    target.hp = run.core;
    target.invulnerableMs = 650;
    run.counters.damageTaken += amount;
  } else {
    target.hp = Math.max(0, target.hp - amount);
    if (poison && target.hp > 0) { target.poisonMs = 2300; target.poisonTickMs = 700; target.poisonOwnerId = sourceId; }
    if (target.hp <= 0) Object.assign(target, fitPosition(run, target.x, target.y, SPECIES[target.species].radius));
  }
  events.push({ type: 'damage', targetId: target.id, x: target.x, y: target.y, amount, shellDamage, coreDamage, shellBroken: shellDamage > 0 && target.shell === 0, sourceId, faction: target.faction });
  if (target.hp > 0) return true;
  events.push({ type: 'death', id: target.id, x: target.x, y: target.y, species: target.species, player: target.faction === 'player' });
  if (target.faction === 'player') { recordCombatEnd(run, 'failed'); run.phase = 'dead'; run.silkTrail = null; run.lossCause = cause; return true; }
  run.counters.kills += 1;
  if (generation === 0 && has(run, 'grave-bloom') && run.areas.length < 32) {
    run.areas.push({ id: run.nextEntityId++, ownerId: sourceId, kind: 'acid', x: target.x, y: target.y, toX: target.x, toY: target.y, radius: 75, remainingMs: 2600, tickMs: 0, hitIds: [] });
    events.push({ type: 'mutation', mutationId: 'grave-bloom', x: target.x, y: target.y });
  }
  return true;
}

function projectile(run: Run, actor: Actor, dx: number, dy: number, amount: number, generation: 0 | 1, _special: boolean, kind: 'spit' | 'barb' = 'spit', patternSpeed?: number): void {
  if (run.projectiles.length >= MAX_PROJECTILES) return;
  if (actor.faction === 'enemy' && run.projectiles.filter(shot => shot.faction === 'enemy').length >= MAX_ENEMY_PROJECTILES) return;
  const isPlayer = actor.faction !== 'enemy';
  const speed = patternSpeed ?? (isPlayer ? PLAYER_SPIT_SPEED * (has(run, 'echo-tissue') ? 1.22 : 1) : 260);
  const x = actor.x + dx * (actor.radius + 7);
  const y = actor.y + dy * (actor.radius + 7);
  run.projectiles.push({ id: run.nextEntityId++, ownerId: actor.id, faction: isPlayer ? 'player' : 'enemy', x, y, prevX: x, prevY: y,
    vx: dx * speed, vy: dy * speed, radius: kind === 'barb' ? 6 : 8, damage: amount, lifeMs: isPlayer ? 2000 : 3400, kind, generation,
    poison: false, bounces: isPlayer && has(run, 'silk-trail') ? 1 : 0 });
}

function enemyPattern(run: Run, actor: Actor, dx: number, dy: number, basic = false): BulletPattern {
  const pace = paceScale(run);
  const minutes = run.activeTimeMs / 60000;
  const ring = !basic && (actor.elite || (minutes > 0.35 && actor.volleyCount % 2 === 1));
  const count = ring
    ? actor.elite ? 18 : minutes > 1.2 ? 16 : 12
    : basic
    ? minutes < 0.25 ? 1 : minutes > 1.0 ? 5 : 3
    : minutes < 0.2 ? 3 : minutes > 1.3 ? 9 : minutes > 0.65 ? 7 : 5;
  return {
    kind: ring ? 'ring' : 'fan', angle: Math.atan2(dy, dx), count,
    spread: ring ? Math.PI * 2 : (count - 1) * (basic ? 0.275 : 0.25),
    speed: Math.round((ring ? 255 : 245) * pace),
    gap: ring ? 1.1 : 0,
  };
}

function emitPattern(run: Run, actor: Actor, pattern: BulletPattern): void {
  const player = getPlayer(run);
  const clearance = PLAYER_BULLET_RADIUS + (actor.elite ? 6 : 8) + 6;
  const muzzleDistance = actor.radius + 7;
  const safetyDistance = muzzleDistance + pattern.speed * 0.22;
  const angularDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let index = 0; index < pattern.count; index++) {
    const angle = pattern.kind === 'ring' ? pattern.angle + index * Math.PI * 2 / pattern.count
      : pattern.count <= 1 ? pattern.angle
      : pattern.angle + (index / (pattern.count - 1) - 0.5) * pattern.spread;
    if (pattern.kind === 'ring' && angularDistance(angle, pattern.angle) < pattern.gap / 2) continue;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const muzzle = { x: actor.x + dx * muzzleDistance, y: actor.y + dy * muzzleDistance };
    const safetyEnd = { x: actor.x + dx * safetyDistance, y: actor.y + dy * safetyDistance };
    if (segmentDistance(player, muzzle, safetyEnd) <= clearance) continue;
    projectile(run, actor, dx, dy, 1, 0, true, actor.elite ? 'barb' : 'spit', pattern.speed);
  }
}

function fan(run: Run, actor: Actor, dx: number, dy: number, generation: 0 | 1): void {
  const baseAngle = Math.atan2(dy, dx);
  const angles = actor.faction === 'player' && has(run, 'split-glands')
    ? [baseAngle - 0.2, baseAngle, baseAngle + 0.2]
    : [baseAngle];
  for (const angle of angles) {
    projectile(run, actor, Math.cos(angle), Math.sin(angle), 1, generation, true);
  }
}

function targets(run: Run, actor: Actor): Actor[] {
  const candidates = actor.faction === 'enemy' ? [getPlayer(run)] : run.actors.filter(candidate => candidate.faction === 'enemy' && candidate.hp > 0);
  return candidates.filter(candidate => !(candidate.action?.kind === 'leap' && candidate.action.stage === 'active'));
}

function basicAttack(run: Run, actor: Actor, dx: number, dy: number, events: GameEvent[], resolved = false, pattern?: BulletPattern): void {
  if (actor.faction !== 'enemy') return;
  if (!resolved) {
    actor.navigation = null;
    actor.action = { kind: actor.species === 'spitter' ? 'spit' : 'swipe', basic: true, stage: 'windup', timeMs: 0, durationMs: actor.species === 'spitter' ? 420 : 300,
      dirX: dx, dirY: dy, fromX: actor.x, fromY: actor.y, targetX: actor.x + dx * 100, targetY: actor.y + dy * 100, hitIds: [], generation: 0, ...(actor.species === 'spitter' ? { pattern: enemyPattern(run, actor, dx, dy, true) } : {}) };
    return;
  }
  actor.basicCooldownMs = Math.round((actor.species === 'spitter' ? 1200 : SPECIES[actor.species].basicMs * 2) / paceScale(run));
  actor.facingX = dx;
  actor.facingY = dy;
  events.push({ type: 'attack', sourceId: actor.id, x: actor.x, y: actor.y, dirX: dx, dirY: dy, species: actor.species, kind: 'basic', phase: 'release', ...(pattern ? { pattern } : {}) });
  if (actor.species === 'spitter') { emitPattern(run, actor, pattern ?? enemyPattern(run, actor, dx, dy, true)); return; }
  const reach = actor.species === 'beetle' ? 100 : 84;
  for (const target of targets(run, actor)) {
    const facing = Math.atan2(dy, dx);
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x) - facing;
    const nearestAngle = facing + clamp(Math.atan2(Math.sin(angle), Math.cos(angle)), -1.3, 1.3);
    const nearestDirection = { x: Math.cos(nearestAngle), y: Math.sin(nearestAngle) };
    const along = clamp((target.x - actor.x) * nearestDirection.x + (target.y - actor.y) * nearestDirection.y, 0, reach);
    const nearest = { x: actor.x + nearestDirection.x * along, y: actor.y + nearestDirection.y * along };
    if (distance(target, nearest) <= PLAYER_BULLET_RADIUS && hasLineOfSight(run, actor, target))
      damage(run, target, 1, actor.id, 0, false, `${SPECIES[actor.species].name} landed the final hit.`, events);
  }
}

function specialDirection(actor: Actor, dx: number, dy: number): Vec2 {
  const aim = direction(dx, dy);
  return aim.x || aim.y ? aim : direction(actor.facingX, actor.facingY);
}

function pounceDistance(aimDistance = LEAP_DISTANCE): number {
  return Number.isFinite(aimDistance) ? clamp(aimDistance, 0, LEAP_DISTANCE) : LEAP_DISTANCE;
}

export function previewSpecial(run: Run, actor: Actor, dirX: number, dirY: number, aimDistance?: number): Vec2 {
  const aim = specialDirection(actor, dirX, dirY);
  if (actor.species === 'beetle') return previewCharge(run, actor, aim.x, aim.y);
  const reach = actor.species === 'hopper' ? pounceDistance(aimDistance) : 290;
  return fitPosition(run, actor.x + aim.x * reach, actor.y + aim.y * reach, actor.radius);
}

function beginSpecial(run: Run, actor: Actor, dx: number, dy: number, generation: 0 | 1, events: GameEvent[], aimDistance?: number): void {
  actor.navigation = null;
  const aim = specialDirection(actor, dx, dy);
  actor.facingX = aim.x;
  actor.facingY = aim.y;
  const enemy = actor.faction === 'enemy';
  const target = previewSpecial(run, actor, aim.x, aim.y, aimDistance);
  const pattern = enemy && (actor.species === 'spitter' || (actor.elite && actor.volleyCount % 2 === 1)) ? enemyPattern(run, actor, aim.x, aim.y) : undefined;
  actor.action = { kind: pattern || actor.species === 'spitter' ? 'spit' : actor.species === 'beetle' ? 'charge' : 'leap', stage: 'windup', timeMs: 0,
    durationMs: pattern?.kind === 'ring' ? actor.elite ? 900 : 800 : enemy ? (actor.species === 'beetle' ? 700 : 620) : actor.species === 'spitter' ? PLAYER_SPIT_WINDUP_MS : PLAYER_MELEE_WINDUP_MS,
    dirX: aim.x, dirY: aim.y, fromX: actor.x, fromY: actor.y, targetX: target.x, targetY: target.y, hitIds: [], generation, ...(actor.species === 'hopper' ? { aimDistance: pounceDistance(aimDistance) } : {}), ...(pattern ? { pattern } : {}) };
  actor.specialCooldownMs = enemy
    ? Math.round((actor.elite ? (actor.hp <= 4 ? 1900 : 2600) : SPECIES[actor.species].enemySpecialMs) / paceScale(run))
    : Math.round(SPECIES[actor.species].specialMs * (has(run, 'echo-tissue') ? 0.6 : 1));
  if (enemy) actor.volleyCount += 1;
  if (actor.faction === 'player') run.counters.specials += 1;
  events.push({ type: 'attack', sourceId: actor.id, x: actor.x, y: actor.y, dirX: aim.x, dirY: aim.y, species: actor.species, kind: generation === 1 ? 'echo' : 'special', phase: 'windup', ...(pattern ? { pattern } : {}) });
}

function updateAction(run: Run, actor: Actor, dt: number, events: GameEvent[]): void {
  const action = actor.action;
  if (!action) return;
  let activeDt = dt;
  if (action.stage === 'windup') {
    const waiting = Math.min(dt, action.durationMs - action.timeMs);
    action.timeMs += waiting;
    if (action.timeMs < action.durationMs) return;
    activeDt -= waiting;
    action.stage = 'active';
    action.timeMs = 0;
    if (action.basic) { actor.action = null; basicAttack(run, actor, action.dirX, action.dirY, events, true, action.pattern); return; }
    if (actor.faction === 'player') {
      actor.lastSpecial = { species: actor.species, dirX: action.dirX, dirY: action.dirY };
      if (actor.species === 'hopper') actor.lastSpecial.aimDistance = action.aimDistance ?? LEAP_DISTANCE;
    }
    events.push({ type: 'attack', sourceId: actor.id, x: actor.x, y: actor.y, dirX: action.dirX, dirY: action.dirY, species: actor.species, kind: action.generation === 1 ? 'echo' : 'special', phase: 'release', ...(action.pattern ? { pattern: action.pattern } : {}) });
    if (action.kind === 'spit') {
      if (action.pattern && actor.faction === 'enemy') emitPattern(run, actor, action.pattern);
      else fan(run, actor, action.dirX, action.dirY, action.generation);
      actor.action = null;
      return;
    }
    action.durationMs = action.kind === 'charge' ? CHARGE_DURATION_MS : actor.faction === 'enemy' ? 480 : PLAYER_LEAP_BASE_MS + Math.min(1, distance(actor, { x: action.targetX, y: action.targetY }) / LEAP_DISTANCE) * PLAYER_LEAP_RANGE_MS;
    action.fromX = actor.x;
    action.fromY = actor.y;
    if (action.kind === 'charge') {
      const endpoint = previewCharge(run, actor, action.dirX, action.dirY);
      action.targetX = endpoint.x;
      action.targetY = endpoint.y;
    }
  }
  activeDt = Math.max(0, Math.min(activeDt, action.durationMs - action.timeMs));
  action.timeMs += activeDt;
  const enemy = actor.faction === 'enemy';
  if (action.kind === 'charge') {
    const before = { x: actor.x, y: actor.y };
    const plannedDistance = CHARGE_SPEED * activeDt / 1000;
    const endpoint = previewCharge(run, actor, action.dirX, action.dirY, plannedDistance);
    actor.x = endpoint.x;
    actor.y = endpoint.y;
    for (const target of targets(run, actor)) {
      const targetRadius = target.faction === 'player' ? PLAYER_BULLET_RADIUS : target.radius;
      if (action.hitIds.includes(target.id) || segmentDistance(target, before, actor) > actor.radius + targetRadius) continue;
      action.hitIds.push(target.id);
      if (!canTakeDamage(target)) continue;
      displace(run, target, action.dirX * 80, action.dirY * 80);
      const hit = damage(run, target, enemy ? 1 : 5, actor.id, action.generation, !enemy && action.generation === 0 && has(run, 'venom-sacs'), 'A charge broke through your body.', events);
      if (target.hp > 0) target.stunMs = 250;
      events.push({ type: 'impact', sourceId: actor.id, faction: actor.faction, hitCount: Number(hit), x: target.x, y: target.y, radius: 42, kind: 'charge', dirX: action.dirX, dirY: action.dirY });
    }
    const stopped = distance(before, actor) < plannedDistance - 0.00001;
    if (stopped) {
      const surface = collisionSurface(run, before, { x: before.x + action.dirX * plannedDistance, y: before.y + action.dirY * plannedDistance }, actor.radius, 'charge');
      if (surface) events.push({ type: 'surface', sourceId: actor.id, ...surface, dirX: action.dirX, dirY: action.dirY, kind: 'charge', faction: actor.faction });
    }
    if (stopped || action.timeMs >= action.durationMs) actor.action = null;
  } else if (action.kind === 'leap') {
    const t = clamp(action.timeMs / action.durationMs, 0, 1);
    actor.x = action.fromX + (action.targetX - action.fromX) * t;
    actor.y = action.fromY + (action.targetY - action.fromY) * t;
    if (t < 1) return;
    const landing = fitPosition(run, actor.x, actor.y, actor.radius);
    actor.x = landing.x;
    actor.y = landing.y;
    const radius = enemy ? LEAP_RADIUS.enemy : LEAP_RADIUS.player;
    const landedTargets = targets(run, actor)
      .filter(target => distance(actor, target) <= radius + (target.faction === 'player' ? PLAYER_BULLET_RADIUS : target.radius * 0.4) && hasLineOfSight(run, actor, target))
      .sort((a, b) => distance(actor, a) - distance(actor, b) || a.id - b.id);
    let hitCount = 0;
    for (const target of landedTargets) {
      const hit = damage(run, target, enemy ? 1 : 5, actor.id, action.generation, !enemy && action.generation === 0 && has(run, 'venom-sacs'), 'A landing crushed your body.', events);
      if (hit) hitCount += 1;
      if (hit && target.hp > 0) target.stunMs = 400;
    }
    events.push({ type: 'impact', sourceId: actor.id, faction: actor.faction, hitCount, x: actor.x, y: actor.y, radius, kind: 'leap' });
    actor.action = null;
  } else if (action.kind === 'dash') {
    const plannedDistance = DASH_SPEED * activeDt / 1000;
    const endpoint = previewCharge(run, actor, action.dirX, action.dirY, plannedDistance);
    actor.x = endpoint.x;
    actor.y = endpoint.y;
    if (action.timeMs >= action.durationMs) actor.action = null;
  }
}

function switchBody(run: Run, corpseId: number, events: GameEvent[]): boolean {
  if (!canSwitchBody(run, corpseId)) return false;
  const corpse = run.corpses.find(candidate => candidate.id === corpseId && !candidate.spent);
  const old = getPlayer(run);
  if (!corpse) return false;
  corpse.spent = true;
  corpse.consumed = true;
  const abandoned = fitPosition(run, old.x, old.y, old.radius);
  const abandonedCorpseId = run.nextEntityId++;
  run.corpses.push({ id: abandonedCorpseId, species: old.species, ...abandoned, radius: old.radius, spent: true, elite: false });
  const healed = Math.min(3 - run.core, 1);
  run.core += healed;
  const fresh = makeActor(run, corpse.species, 'player', corpse.x, corpse.y);
  fresh.invulnerableMs = Math.max(old.invulnerableMs, 220);
  run.projectiles = run.projectiles.filter(shot => shot.faction !== 'enemy' || distance(shot, fresh) > POSSESSION_CLEAR_RADIUS);
  fresh.facingX = old.facingX;
  fresh.facingY = old.facingY;
  run.actors = run.actors.filter(actor => actor.id !== old.id);
  run.actors.push(fresh);
  run.playerId = fresh.id;
  run.hopCooldownMs = BODY_SWITCH_COOLDOWN_MS;
  run.counters.hops += 1;
  run.lineage.push({ species: fresh.species, encounterIndex: run.encounterIndex, atMs: run.activeTimeMs });
  events.push({ type: 'possess', fromId: old.id, toId: fresh.id, corpseId, abandonedCorpseId, fromX: old.x, fromY: old.y, x: fresh.x, y: fresh.y, species: fresh.species, healed });
  if (run.phase === 'playing' && has(run, 'echo-tissue') && old.lastSpecial) {
    const echo = makeActor(run, old.species, 'echo', abandoned.x, abandoned.y);
    run.actors.push(echo);
    beginSpecial(run, echo, old.lastSpecial.dirX, old.lastSpecial.dirY, 1, events, old.lastSpecial.aimDistance);
    events.push({ type: 'mutation', mutationId: 'echo-tissue', x: old.x, y: old.y });
  }
  if (run.phase === 'playing' && has(run, 'silk-trail')) {
    run.silkTrail = { x: fresh.x, y: fresh.y, remainingMs: 2000, segmentId: null };
    events.push({ type: 'mutation', mutationId: 'silk-trail', x: fresh.x, y: fresh.y });
  }
  if (run.phase === 'playing' && has(run, 'shock-molt')) {
    const affected = run.actors.filter(actor => actor.faction === 'enemy' && actor.hp > 0 && distance(actor, fresh) < 135);
    for (const target of affected) {
      const away = direction(target.x - fresh.x, target.y - fresh.y);
      displace(run, target, away.x * 110, away.y * 110);
      target.stunMs = 600;
      target.action = null;
    }
    events.push({ type: 'impact', sourceId: fresh.id, faction: fresh.faction, hitCount: affected.length, x: fresh.x, y: fresh.y, radius: 135, kind: 'shock' });
    events.push({ type: 'mutation', mutationId: 'shock-molt', x: fresh.x, y: fresh.y });
  }
  if (run.phase === 'cleared') {
    run.boundaryCheckpoint = captureBoundary(run);
    events.push({ type: 'checkpoint' });
  }
  return true;
}

function canWalkTo(run: Run, actor: Actor, from: Vec2, to: Vec2): boolean {
  const endpoint = previewCharge(run, { ...from, radius: actor.radius }, to.x - from.x, to.y - from.y, distance(from, to));
  return distance(endpoint, to) < 0.001;
}

function routeWaypoint(run: Run, actor: Actor, goal: Vec2, retreat: boolean): Vec2 | null {
  const clearance = actor.radius + 2;
  const corners = run.obstacles.flatMap(rect => [
    { x: rect.x - clearance, y: rect.y - clearance }, { x: rect.x + rect.width + clearance, y: rect.y - clearance },
    { x: rect.x - clearance, y: rect.y + rect.height + clearance }, { x: rect.x + rect.width + clearance, y: rect.y + rect.height + clearance },
  ]).filter(point => distance(point, fitPosition(run, point.x, point.y, actor.radius)) < 0.001);
  const nodes = [actor, goal, ...corners];
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
  const player = getPlayer(run);
  costs[0] = 0;
  for (let count = 0; count < nodes.length; count++) {
    let nearest = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (!visited.has(index) && (nearest < 0 || costs[index]! < costs[nearest]!)) nearest = index;
    }
    if (nearest < 0 || !Number.isFinite(costs[nearest]) || nearest === 1) break;
    visited.add(nearest);
    for (let index = 0; index < nodes.length; index++) {
      if (visited.has(index)) continue;
      const from = nodes[nearest]!, to = nodes[index]!;
      if (retreat && nearest === 0 && (to.x - actor.x) * (actor.x - player.x) + (to.y - actor.y) * (actor.y - player.y) < 0) continue;
      if (!canWalkTo(run, actor, from, to)) continue;
      const cost = costs[nearest]! + distance(from, to);
      if (cost >= costs[index]!) continue;
      costs[index] = cost;
      previous[index] = nearest;
    }
  }
  if (previous[1] === -1) return null;
  let next = 1;
  while (previous[next]! > 0) next = previous[next]!;
  const point = nodes[next]!;
  return { x: point.x, y: point.y };
}

function moveEnemy(run: Run, actor: Actor, dx: number, dy: number, dt: number, retreat = false, minimumRange = 0): void {
  const desired = direction(dx, dy), player = getPlayer(run);
  const goal = retreat ? fitPosition(run, actor.x + desired.x * 180, actor.y + desired.y * 180, actor.radius)
    : fitPosition(run, player.x, player.y, actor.radius);
  const travel = SPECIES[actor.species].speed * ENEMY_WALK_SPEED_SCALE * paceScale(run) * dt / 1000;
  let target = goal;
  if (canWalkTo(run, actor, actor, goal)) actor.navigation = null;
  else {
    const route = actor.navigation;
    const retreatReversed = retreat && route && ((route.waypoint.x - actor.x) * (actor.x - player.x) + (route.waypoint.y - actor.y) * (actor.y - player.y) < 0);
    if (!route || retreatReversed || route.retreat !== retreat || distance(route.goal, goal) > 80 || distance(actor, route.waypoint) <= Math.max(2, travel)
      || !canWalkTo(run, actor, actor, route.waypoint)) {
      const waypoint = routeWaypoint(run, actor, goal, retreat);
      actor.navigation = waypoint ? { waypoint, goal, retreat } : null;
    }
    if (!actor.navigation) return;
    target = actor.navigation.waypoint;
  }
  if (retreat && ((target.x - actor.x) * (actor.x - player.x) + (target.y - actor.y) * (actor.y - player.y) < 0)) { actor.navigation = null; return; }
  let aim = direction(target.x - actor.x, target.y - actor.y);
  if (minimumRange > 0 && distance(actor, player) < minimumRange + travel) {
    const toward = direction(player.x - actor.x, player.y - actor.y), inward = aim.x * toward.x + aim.y * toward.y;
    if (inward > 0) aim = direction(aim.x - toward.x * inward, aim.y - toward.y * inward);
  }
  const amount = Math.min(travel, distance(actor, target));
  moveActor(run, actor, aim.x * amount, aim.y * amount);
}

function updateEnemy(run: Run, actor: Actor, dt: number, events: GameEvent[]): void {
  const player = getPlayer(run);
  const length = distance(actor, player);
  const toward = direction(player.x - actor.x, player.y - actor.y);
  actor.facingX = toward.x;
  actor.facingY = toward.y;
  const specialRange = actor.species === 'spitter' ? 650 : actor.elite && actor.volleyCount % 2 === 1 ? 620 : 370;
  if (actor.specialCooldownMs <= 0 && length < specialRange && hasLineOfSight(run, actor, player)) {
    beginSpecial(run, actor, toward.x, toward.y, 0, events);
    if (actor.action?.kind === 'leap') {
      const target = fitPosition(run, player.x, player.y, actor.radius);
      actor.action.targetX = target.x;
      actor.action.targetY = target.y;
    }
    return;
  }
  if (actor.species === 'spitter') {
    if (length < 180 && hasLineOfSight(run, actor, player)) moveEnemy(run, actor, -toward.x, -toward.y, dt, true);
    else if (length > 300 || !hasLineOfSight(run, actor, player)) moveEnemy(run, actor, toward.x, toward.y, dt);
    else if (!hasLineOfSight(run, actor, player, actor.elite ? 6 : 8)) moveEnemy(run, actor, toward.x, toward.y, dt, false, 180);
  } else if (length > actor.radius + player.radius + 12) moveEnemy(run, actor, toward.x, toward.y, dt);
  const range = actor.species === 'spitter' ? 440 : actor.species === 'beetle' ? 108 : 92;
  if (actor.basicCooldownMs <= 0 && length < range && hasLineOfSight(run, actor, player)) basicAttack(run, actor, toward.x, toward.y, events);
}

function updateProjectiles(run: Run, dt: number, events: GameEvent[]): void {
  const homing = has(run, 'venom-sacs');
  for (const shot of run.projectiles) {
    if (run.phase !== 'playing' && run.phase !== 'cleared') break;
    if (homing && shot.faction === 'player') {
      const target = run.actors
        .filter(actor => actor.faction === 'enemy' && actor.hp > 0 && !(actor.action?.kind === 'leap' && actor.action.stage === 'active'))
        .sort((a, b) => distance(shot, a) - distance(shot, b))[0];
      if (target && distance(shot, target) <= 280) {
        const speed = Math.hypot(shot.vx, shot.vy);
        const current = Math.atan2(shot.vy, shot.vx);
        const desired = Math.atan2(target.y - shot.y, target.x - shot.x);
        const diff = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
        const maxTurn = 4.6 * dt / 1000;
        const next = current + clamp(diff, -maxTurn, maxTurn);
        shot.vx = Math.cos(next) * speed;
        shot.vy = Math.sin(next) * speed;
      }
    }
    shot.prevX = shot.x;
    shot.prevY = shot.y;
    shot.x += shot.vx * dt / 1000;
    shot.y += shot.vy * dt / 1000;
    shot.lifeMs -= dt;
    const start = { x: shot.prevX, y: shot.prevY };
    if (shot.x < 0 || shot.y < 0 || shot.x > WORLD_WIDTH || shot.y > WORLD_HEIGHT || run.obstacles.some(rect => crossesRect(start, shot, rect, shot.radius))) {
      const surface = shot.lifeMs > 0 ? collisionSurface(run, start, shot, shot.radius, 'spit') : null;
      if (surface) {
        const aim = direction(shot.vx, shot.vy);
        events.push({ type: 'surface', sourceId: shot.ownerId, ...surface, dirX: aim.x, dirY: aim.y, kind: 'spit', faction: shot.generation === 1 ? 'echo' : shot.faction });
      }
      if (shot.faction === 'player' && (shot.bounces ?? 0) > 0) {
        shot.bounces = (shot.bounces ?? 1) - 1;
        const hitX = shot.x < 0 || shot.x > WORLD_WIDTH || run.obstacles.some(rect => crossesRect(start, { x: shot.x, y: shot.prevY }, rect, shot.radius));
        const hitY = shot.y < 0 || shot.y > WORLD_HEIGHT || run.obstacles.some(rect => crossesRect(start, { x: shot.prevX, y: shot.y }, rect, shot.radius));
        if (hitX || !hitY) shot.vx = -shot.vx;
        if (hitY || !hitX) shot.vy = -shot.vy;
        shot.x = shot.prevX;
        shot.y = shot.prevY;
        continue;
      }
      shot.lifeMs = 0;
      continue;
    }
    if (run.phase === 'cleared') continue;
    const possible = shot.faction === 'enemy' ? [getPlayer(run)] : run.actors.filter(actor => actor.faction === 'enemy' && actor.hp > 0);
    const hit = possible.filter(actor => !(actor.action?.kind === 'leap' && actor.action.stage === 'active') && segmentDistance(actor, start, shot) < (actor.faction === 'player' && shot.faction === 'enemy' ? PLAYER_BULLET_RADIUS : actor.radius) + shot.radius)
      .sort((a, b) => distance(start, a) - distance(start, b) || a.id - b.id)[0];
    if (!hit) continue;
    damage(run, hit, shot.damage, shot.ownerId, shot.generation, shot.poison, shot.kind === 'barb' ? 'A barb struck your exposed body.' : 'A spit struck your exposed body.', events);
    shot.lifeMs = 0;
  }
  run.projectiles = run.projectiles.filter(shot => shot.lifeMs > 0);
}

function updateSilkTrail(run: Run, dt: number, wasAirborne: boolean): void {
  const trail = run.silkTrail;
  if (!trail) return;
  const player = getPlayer(run);
  const airborne = wasAirborne || (player.action?.kind === 'leap' && player.action.stage === 'active');
  const moved = distance(trail, player) > 0.01;
  if (airborne || run.obstacles.some(rect => crossesRect(trail, player, rect, 12))) trail.segmentId = null;
  else if (moved) {
    const segment = run.areas.find(area => area.id === trail.segmentId && area.remainingMs > 0);
    if (segment && distance(segment, player) <= 32 && distance(segment, player) >= distance(segment, trail) && segmentDistance(trail, segment, player) <= 2 &&
      !run.obstacles.some(rect => crossesRect(segment, player, rect, 12))) {
      segment.toX = player.x;
      segment.toY = player.y;
    } else {
      if (run.areas.length >= 32) {
        const oldestSilk = run.areas.findIndex(area => area.kind === 'silk');
        if (oldestSilk >= 0) run.areas.splice(oldestSilk, 1);
      }
      if (run.areas.length < 32) {
        const id = run.nextEntityId++;
        run.areas.push({ id, ownerId: player.id, kind: 'silk', x: trail.x, y: trail.y, toX: player.x, toY: player.y,
          radius: 12, remainingMs: 2600, tickMs: 0, hitIds: [] });
        trail.segmentId = id;
      }
    }
  }
  trail.x = player.x;
  trail.y = player.y;
  trail.remainingMs -= dt;
  if (trail.remainingMs <= 0) run.silkTrail = null;
}

function updateAreas(run: Run, dt: number, events: GameEvent[]): void {
  for (const area of run.areas) {
    area.remainingMs -= dt;
    if (area.remainingMs <= 0) continue;
    area.tickMs -= dt;
    if (area.kind === 'acid' && area.tickMs > 0) continue;
    if (area.kind === 'acid') area.tickMs = 600;
    for (const actor of run.actors.filter(candidate => candidate.faction === 'enemy' && candidate.hp > 0)) {
      if (actor.action?.kind === 'leap' && actor.action.stage === 'active') continue;
      if (area.kind === 'silk') {
        if (area.hitIds.includes(actor.id) || segmentDistance(actor, area, { x: area.toX, y: area.toY }) > area.radius + actor.radius) continue;
        area.hitIds.push(actor.id);
        const hit = damage(run, actor, 1.5, area.ownerId, 1, false, '', events);
        if (hit && actor.hp > 0) actor.stunMs = 550;
      } else if (distance(actor, area) <= area.radius + actor.radius * 0.4) damage(run, actor, 1.1, area.ownerId, 1, false, '', events);
    }
  }
  run.areas = run.areas.filter(area => area.remainingMs > 0);
}

function separateActors(run: Run): void {
  const actors = run.actors.filter(actor => actor.hp > 0 && actor.faction !== 'echo' && actor.action?.stage !== 'active');
  for (let index = 0; index < actors.length; index += 1) {
    const a = actors[index]!;
    for (const b of actors.slice(index + 1)) {
      const gap = distance(a, b);
      const overlap = a.radius + b.radius - gap;
      if (overlap <= 0) continue;
      const away = gap > 0.001 ? direction(a.x - b.x, a.y - b.y) : { x: a.id < b.id ? -1 : 1, y: 0 };
      moveActor(run, a, away.x * overlap * 0.5, away.y * overlap * 0.5);
      moveActor(run, b, -away.x * overlap * 0.5, -away.y * overlap * 0.5);
    }
  }
}

function finishEncounter(run: Run, events: GameEvent[]): void {
  recordCombatEnd(run, 'cleared');
  run.completedEncounters = run.encounterIndex + 1;
  run.projectiles = [];
  run.areas = [];
  run.silkTrail = null;
  const player = getPlayer(run);
  if (run.core < run.maxCore) {
    run.core = Math.min(run.maxCore, run.core + 1);
    player.hp = run.core;
  }
  player.specialCooldownMs = 0;
  player.basicCooldownMs = 0;
  run.actors = [player];
  events.push({ type: 'encounterClear', encounterIndex: run.encounterIndex, completedEncounters: run.completedEncounters });
  run.phase = 'cleared';
  run.resumePhase = 'cleared';
  run.rewardOffers = [];
  run.hopCooldownMs = 0;
  run.boundaryCheckpoint = captureBoundary(run);
  events.push({ type: 'checkpoint' });
}

export function exitEncounter(run: Run): GameEvent[] {
  if (run.phase !== 'cleared' || getPlayer(run).action) return [];
  if (run.completedEncounters === ENCOUNTER_COUNT) {
    run.phase = 'escaped';
    return [{ type: 'result', result: createResult(run)! }];
  }
  run.phase = 'reward';
  run.resumePhase = 'reward';
  run.rewardOffers = getRewardOffers(run.challenge, run.encounterIndex, run.mutations);
  run.boundaryCheckpoint = captureBoundary(run);
  return [{ type: 'reward', offers: [...run.rewardOffers] }, { type: 'checkpoint' }];
}

function spawnNextGroup(run: Run, events: GameEvent[]): void {
  const encounter = getEncounter(run.challenge, run.encounterIndex);
  run.encounterGroup += 1;
  const player = getPlayer(run);
  const ids: number[] = [];
  for (const [index, spawn] of encounter.groups[run.encounterGroup]!.entries()) {
    const enemy = makeActor(run, spawn.species, 'enemy', spawn.x, spawn.y, spawn.elite);
    const onLethalFloor = (point: Vec2) => enemy.elite && run.areas.some(area => area.remainingMs > 0 && (area.kind === 'silk'
      ? segmentDistance(point, area, { x: area.toX, y: area.toY }) <= area.radius + enemy.radius
      : distance(point, area) <= area.radius + enemy.radius * 0.4));
    if (distance(enemy, player) < 180 || run.actors.some(actor => actor.hp > 0 && distance(enemy, actor) < enemy.radius + actor.radius + 10) || onLethalFloor(enemy)) {
      const candidates = [{ x: spawn.x - 180, y: spawn.y }, { x: spawn.x + 180, y: spawn.y }, { x: spawn.x, y: spawn.y - 180 }, { x: spawn.x, y: spawn.y + 180 }, ...[100, 230, 360, 490, 620].flatMap(x => [140, 300, 480, 660, 820].map(y => ({ x, y })))]
        .map(point => fitPosition(run, point.x, point.y, enemy.radius))
        .filter(point => distance(point, player) >= 180 && run.actors.every(actor => actor.hp <= 0 || distance(point, actor) > enemy.radius + actor.radius + 10))
        .sort((a, b) => distance(a, spawn) - distance(b, spawn));
      // A fully covered room still spawns on time, with normal one-hit vulnerability.
      const arrival = candidates.find(point => !onLethalFloor(point)) ?? candidates[0];
      if (arrival) Object.assign(enemy, arrival);
    }
    enemy.basicCooldownMs = 1100 + index * 150;
    enemy.specialCooldownMs = enemy.elite ? 0 : 1500 + index * 200;
    if (enemy.elite) enemy.volleyCount = 1;
    run.actors.push(enemy);
    ids.push(enemy.id);
  }
  events.push({ type: 'spawn', ids, group: run.encounterGroup, totalGroups: encounter.groups.length });
}

function beginDash(run: Run, player: Actor, dirX: number, dirY: number, events: GameEvent[]): void {
  const dashDir = direction(dirX, dirY);
  const aim = dashDir.x || dashDir.y ? dashDir : direction(player.facingX, player.facingY);
  const endpoint = previewCharge(run, player, aim.x, aim.y, DASH_SPEED * DASH_DURATION_MS / 1000);
  player.action = {
    kind: 'dash', stage: 'active', timeMs: 0, durationMs: DASH_DURATION_MS,
    dirX: aim.x, dirY: aim.y, fromX: player.x, fromY: player.y, targetX: endpoint.x, targetY: endpoint.y,
    hitIds: [], generation: 0,
  };
  player.basicCooldownMs = DASH_COOLDOWN_MS;
  player.invulnerableMs = Math.max(player.invulnerableMs, DASH_INVULNERABLE_MS);
  events.push({ type: 'impact', sourceId: player.id, faction: player.faction, hitCount: 0, x: player.x, y: player.y, radius: 36, kind: 'dash', dirX: aim.x, dirY: aim.y });
  if (run.phase === 'playing' && has(run, 'shock-molt')) {
    run.projectiles = run.projectiles.filter(shot => shot.faction !== 'enemy' || distance(shot, player) > 140);
    const affected = run.actors.filter(actor => actor.faction === 'enemy' && actor.hp > 0 && distance(actor, player) < 140);
    for (const target of affected) {
      const away = direction(target.x - player.x, target.y - player.y);
      displace(run, target, away.x * 110, away.y * 110);
      target.stunMs = 500;
      target.action = null;
    }
    events.push({ type: 'impact', sourceId: player.id, faction: player.faction, hitCount: affected.length, x: player.x, y: player.y, radius: 140, kind: 'shock' });
    events.push({ type: 'mutation', mutationId: 'shock-molt', x: player.x, y: player.y });
  }
}

function updatePlayer(run: Run, player: Actor, input: InputFrame, dt: number, events: GameEvent[]): void {
  const moving = direction(input.moveX, input.moveY);
  const magnitude = Math.min(1, Math.hypot(input.moveX, input.moveY));
  if (input.dashPressed && player.basicCooldownMs <= 0 && (!player.action || player.action.stage === 'windup')) {
    beginDash(run, player, magnitude > 0 ? moving.x : player.facingX, magnitude > 0 ? moving.y : player.facingY, events);
  }
  if (player.action) {
    const walkingMs = player.action.kind === 'spit' ? dt : player.action.stage === 'windup' ? Math.min(dt, player.action.durationMs - player.action.timeMs) : 0;
    if (Number.isFinite(magnitude) && walkingMs > 0)
      moveActor(run, player, moving.x * magnitude * SPECIES[player.species].speed * walkingMs / 1000, moving.y * magnitude * SPECIES[player.species].speed * walkingMs / 1000);
    updateAction(run, player, dt, events);
    return;
  }
  if (input.abilityPressed && player.specialCooldownMs <= 0) {
    beginSpecial(run, player, player.facingX, player.facingY, 0, events, input.aimDistance);
  }
  if (Number.isFinite(magnitude)) moveActor(run, player, moving.x * magnitude * SPECIES[player.species].speed * dt / 1000, moving.y * magnitude * SPECIES[player.species].speed * dt / 1000);
}

function stepCleared(run: Run, input: InputFrame, elapsed: number): GameEvent[] {
  const events: GameEvent[] = [];
  run.activeTimeMs += elapsed;
  run.hopCooldownMs = Math.max(0, run.hopCooldownMs - elapsed);
  const switched = input.hopCommitId !== null && switchBody(run, input.hopCommitId, events);
  if (switched) input = { ...input, abilityPressed: false, attackHeld: false };
  const player = getPlayer(run);
  const aim = direction(player.action?.dirX ?? input.aimX, player.action?.dirY ?? input.aimY);
  if (aim.x || aim.y) { player.facingX = aim.x; player.facingY = aim.y; }
  player.basicCooldownMs = Math.max(0, player.basicCooldownMs - elapsed);
  player.specialCooldownMs = Math.max(0, player.specialCooldownMs - elapsed);
  player.invulnerableMs = Math.max(0, player.invulnerableMs - elapsed);
  player.stunMs = Math.max(0, player.stunMs - elapsed);
  const action = player.action;
  if (player.stunMs <= 0) updatePlayer(run, player, input, elapsed, events);
  updateProjectiles(run, elapsed, events);
  const completedAction = action && !player.action;
  const arrivedByAction = completedAction && (action.kind === 'charge' || action.kind === 'leap') && distance({ x: action.fromX, y: action.fromY }, run.exit) > EXIT_RADIUS;
  const magnitude = Math.min(1, Math.hypot(input.moveX, input.moveY));
  if (!player.action && distance(player, run.exit) <= EXIT_RADIUS && (magnitude > 0 || arrivedByAction)) return [...events, ...exitEncounter(run)];
  if (completedAction) run.boundaryCheckpoint = captureBoundary(run);
  if (completedAction) events.push({ type: 'checkpoint' });
  return events;
}

export function step(run: Run, input: InputFrame, dtMs = TICK_MS): GameEvent[] {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return [];
  if (run.phase === 'cleared') return stepCleared(run, input, Math.min(dtMs, TICK_MS));
  if (run.phase !== 'playing') return [];
  const events: GameEvent[] = [];
  const elapsed = Math.min(dtMs, TICK_MS);
  const dt = elapsed;
  run.activeTimeMs += elapsed;
  run.encounterTimeMs += dt;
  run.hopCooldownMs = Math.max(0, run.hopCooldownMs - dt);
  const switched = input.hopCommitId !== null && switchBody(run, input.hopCommitId, events);
  if (switched) input = { ...input, abilityPressed: false, attackHeld: false };
  const player = getPlayer(run);
  const aim = direction(player.action?.dirX ?? input.aimX, player.action?.dirY ?? input.aimY);
  if (aim.x || aim.y) { player.facingX = aim.x; player.facingY = aim.y; }
  const wasAirborne = player.action?.kind === 'leap' && player.action.stage === 'active';
  for (const actor of [...run.actors]) {
    if (run.phase !== 'playing') break;
    if (actor.hp <= 0) continue;
    actor.basicCooldownMs = Math.max(0, actor.basicCooldownMs - dt);
    actor.specialCooldownMs = Math.max(0, actor.specialCooldownMs - dt);
    actor.invulnerableMs = Math.max(0, actor.invulnerableMs - dt);
    actor.stunMs = Math.max(0, actor.stunMs - dt);
    if (actor.poisonMs > 0 && actor.faction === 'enemy') {
      actor.poisonMs = Math.max(0, actor.poisonMs - dt);
      actor.poisonTickMs -= dt;
      if (actor.poisonTickMs <= 0) { actor.poisonTickMs += 700; damage(run, actor, 1, actor.poisonOwnerId, 1, false, '', events); }
      if (actor.hp <= 0) continue;
    }
    if (actor.stunMs > 0) continue;
    if (actor.faction === 'player') { updatePlayer(run, actor, input, dt, events); continue; }
    if (actor.action) {
      updateAction(run, actor, dt, events);
      continue;
    }
    if (actor.faction === 'echo') continue;
    updateEnemy(run, actor, dt, events);
  }
  if (run.phase === 'playing') {
    separateActors(run);
    updateSilkTrail(run, dt, wasAirborne);
    updateProjectiles(run, dt, events);
    if (run.phase === 'playing') updateAreas(run, dt, events);
  }
  run.actors = run.actors.filter(actor => actor.faction === 'player' || (actor.hp > 0 && (actor.faction !== 'echo' || actor.action !== null)));
  if (run.phase === 'playing') {
    const remaining = run.actors.filter(actor => actor.faction === 'enemy').length;
    const groups = getEncounter(run.challenge, run.encounterIndex).groups;
    const threshold = groups[run.encounterGroup]!.length === 1 || groups[run.encounterGroup + 1]?.some(spawn => spawn.elite) ? 0 : 1;
    if (remaining <= threshold && run.encounterGroup < groups.length - 1) spawnNextGroup(run, events);
    else if (remaining === 0) finishEncounter(run, events);
  }
  const result = createResult(run);
  if (result) events.push({ type: 'result', result });
  return events;
}
