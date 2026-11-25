import { z } from 'zod';

export const SpeciesSchema = z.enum(['spitter', 'beetle', 'hopper']);
export type Species = z.infer<typeof SpeciesSchema>;
export const SpecialRecordSchema = z.object({ species: SpeciesSchema, dirX: z.number().finite().min(-1).max(1), dirY: z.number().finite().min(-1).max(1), aimDistance: z.number().finite().min(0).max(210).optional() }).strict();
export const HealthModelSchema = z.enum(['shared', 'shell-core']);
export type HealthModel = z.infer<typeof HealthModelSchema>;
export const MutationIdSchema = z.enum([
  'echo-tissue', 'silk-trail', 'shock-molt', 'venom-sacs', 'split-glands', 'grave-bloom',
  'pierce-barbs', 'heavy-bile', 'orbital-shell', 'arc-nerve',
]);
export type MutationId = z.infer<typeof MutationIdSchema>;
export type Phase = 'ready' | 'playing' | 'cleared' | 'paused' | 'reward' | 'dead' | 'escaped';
export type Vec2 = { x: number; y: number };
export type Rect = Vec2 & { width: number; height: number };
export const CorpseSchema = z.object({ id: z.number().int().positive().max(10000000), species: SpeciesSchema, x: z.number().finite().min(0).max(1080), y: z.number().finite().min(0).max(1440), radius: z.number().finite().positive().max(100), spent: z.boolean(), elite: z.boolean(), consumed: z.literal(true).optional() }).strict().refine(value => !value.consumed || value.spent, { message: 'A consumed body must be spent.' });
export const ChallengeSchema = z.object({ id: z.string().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}), contentVersion: z.string().min(1).max(40), seed: z.number().int().min(0).max(0xffffffff) }).strict();
export type Challenge = z.infer<typeof ChallengeSchema>;
export const CountersSchema = z.object({ kills: z.number().int().min(0).max(10000), hops: z.number().int().min(0).max(10000), specials: z.number().int().min(0).max(10000), damageTaken: z.number().finite().min(0).max(10000) }).strict();
export type Counters = z.infer<typeof CountersSchema>;
export const LineageEntrySchema = z.object({ species: SpeciesSchema, encounterIndex: z.number().int().min(0).max(5), atMs: z.number().finite().min(0).max(3600000) }).strict();
export type LineageEntry = z.infer<typeof LineageEntrySchema>;
const SlotsSchema = z.array(MutationIdSchema).max(10).refine(values => new Set(values).size === values.length);
export const EncounterRecordSchema = z.object({
  encounterIndex: z.number().int().min(0).max(5), entrySpecies: SpeciesSchema, entryMutations: SlotsSchema,
  startLineageIndex: z.number().int().min(0).max(95), combatEndLineageIndex: z.number().int().min(1).max(96).nullable(),
  outcome: z.enum(['active', 'cleared', 'failed']),
}).strict();
export type EncounterRecord = z.infer<typeof EncounterRecordSchema>;
type RecordedRun = { lineage: LineageEntry[]; encounterRecords: EncounterRecord[]; activeTimeMs: number; mutations: MutationId[]; counters: Counters };
function validateEncounterRecords(value: RecordedRun, ctx: z.RefinementCtx): void {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', path: ['encounterRecords'], message });
  if (value.counters.hops !== value.lineage.length - 1) fail('Hop count disagrees with full lineage.');
  if (value.lineage[0]?.encounterIndex !== 0 || value.lineage[0]?.atMs !== 0) fail('Lineage must begin at the run start.');
  for (const [index, entry] of value.lineage.entries()) {
    const previous = value.lineage[index - 1];
    if (entry.atMs > value.activeTimeMs || (previous && (entry.atMs < previous.atMs || entry.encounterIndex < previous.encounterIndex))) fail('Lineage order disagrees.');
  }
  for (const [index, record] of value.encounterRecords.entries()) {
    const entry = value.lineage[record.startLineageIndex];
    if (record.encounterIndex !== index || !entry || entry.species !== record.entrySpecies || entry.encounterIndex > index) fail('Encounter entry disagrees with lineage.');
    if (index === 0 && (record.startLineageIndex !== 0 || record.entryMutations.length !== 0)) fail('Initial encounter entry disagrees.');
    const end = record.combatEndLineageIndex;
    if ((record.outcome === 'active') !== (end === null)) fail('Combat boundary disagrees with outcome.');
    if (end !== null && (end <= record.startLineageIndex || end > value.lineage.length)) fail('Invalid combat lineage boundary.');
    for (const hop of value.lineage.slice(record.startLineageIndex + 1, end ?? value.lineage.length))
      if (hop.encounterIndex !== index) fail('Combat lineage crosses an encounter boundary.');
    const previous = value.encounterRecords[index - 1];
    if (previous) {
      if (previous.outcome !== 'cleared' || previous.combatEndLineageIndex === null || record.startLineageIndex < previous.combatEndLineageIndex - 1) fail('Encounter records overlap or skip completion.');
      for (const hop of value.lineage.slice(previous.combatEndLineageIndex ?? value.lineage.length, record.startLineageIndex + 1))
        if (hop.encounterIndex !== index - 1) fail('Post-clear lineage disagrees.');
    }
  }
  const last = value.encounterRecords.at(-1);
  if (!last) { fail('Missing encounter record.'); return; }
  if (last.entryMutations.join(',') !== value.mutations.join(',')) fail('Current mutations disagree with encounter entry.');
  if (last.outcome === 'failed' && last.combatEndLineageIndex !== value.lineage.length) fail('Failed combat has trailing lineage.');
  if (last.outcome === 'cleared') for (const hop of value.lineage.slice(last.combatEndLineageIndex ?? value.lineage.length))
    if (hop.encounterIndex !== last.encounterIndex) fail('Trailing post-clear lineage disagrees.');
}
export const CheckpointSchema = z.object({
  schemaVersion: z.literal(2), challengeId: z.string().min(1).max(120), contentVersion: z.string().min(1).max(40), runId: z.string().min(1).max(120), healthModel: z.literal('shared'),
  encounterIndex: z.number().int().min(0).max(5), boundary: z.enum(['encounter-start', 'cleared', 'reward']),
  core: z.number().int().min(1).max(3), maxCore: z.literal(3),
  hopCooldownMs: z.number().finite().min(0).max(350).default(0),
  host: z.object({ species: SpeciesSchema, shell: z.literal(0), specialCooldownMs: z.number().finite().min(0).max(10000), basicCooldownMs: z.number().finite().min(0).max(10000), lastSpecial: SpecialRecordSchema.nullable().default(null), position: z.object({ x: z.number().finite().min(0).max(1080), y: z.number().finite().min(0).max(1440) }).strict().nullable().default(null) }).strict(),
  clearedCorpses: z.array(CorpseSchema).max(128).default([]),
  mutations: SlotsSchema, rewardOffers: z.array(MutationIdSchema).max(3).refine(values => new Set(values).size === values.length),
  completedEncounters: z.number().int().min(0).max(6), activeTimeMs: z.number().finite().min(0).max(3600000),
  lineage: z.array(LineageEntrySchema).min(1).max(96), counters: CountersSchema, nextEntityId: z.number().int().positive().max(10000000),
  encounterRecords: z.array(EncounterRecordSchema).min(1).max(6),
}).strict().superRefine((value, ctx) => {
  validateEncounterRecords(value, ctx);
  const current = value.encounterRecords.at(-1);
  if (value.encounterRecords.length !== value.encounterIndex + 1 || current?.outcome !== (value.boundary === 'encounter-start' ? 'active' : 'cleared')) ctx.addIssue({ code: 'custom', message: 'Checkpoint records disagree with progress.' });
  if (value.boundary === 'encounter-start' && current?.startLineageIndex !== value.lineage.length - 1) ctx.addIssue({ code: 'custom', message: 'Encounter-start checkpoint includes combat hops.' });
  if (value.host.species !== value.lineage.at(-1)?.species) ctx.addIssue({ code: 'custom', message: 'Saved host disagrees with lineage.' });
  if (value.core > value.maxCore) ctx.addIssue({ code: 'custom', message: 'Core exceeds maximum.' });
  if (value.completedEncounters !== value.encounterIndex + (value.boundary === 'encounter-start' ? 0 : 1)) ctx.addIssue({ code: 'custom', message: 'Boundary progress disagrees.' });
  if (value.boundary === 'reward' && value.encounterIndex === 5) ctx.addIssue({ code: 'custom', message: 'Final encounter has a result.' });
  if (value.boundary !== 'reward' && value.rewardOffers.length) ctx.addIssue({ code: 'custom', message: 'Only rewards have offers.' });
  if (value.boundary !== 'cleared' && value.clearedCorpses.length) ctx.addIssue({ code: 'custom', message: 'Only cleared rooms preserve bodies.' });
  if (new Set(value.clearedCorpses.map(corpse => corpse.id)).size !== value.clearedCorpses.length || value.clearedCorpses.some(corpse => corpse.id >= value.nextEntityId)) ctx.addIssue({ code: 'custom', message: 'Invalid corpse identities.' });
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const RunResultSchema = z.object({
  schemaVersion: z.literal(2), challengeId: z.string().min(1).max(120), contentVersion: z.string().min(1).max(40), runId: z.string().min(1).max(120), healthModel: z.literal('shared'),
  outcome: z.enum(['dead', 'escaped']), completedEncounters: z.number().int().min(0).max(6), activeTimeMs: z.number().finite().min(0).max(3600000),
  mutations: SlotsSchema, lineage: z.array(LineageEntrySchema).min(1).max(96), counters: CountersSchema, cause: z.string().max(160),
  encounterRecords: z.array(EncounterRecordSchema).min(1).max(6),
}).strict().superRefine((value, ctx) => {
  validateEncounterRecords(value, ctx);
  const expectedCount = value.completedEncounters + (value.outcome === 'dead' ? 1 : 0);
  if (value.encounterRecords.length !== expectedCount || value.encounterRecords.at(-1)?.outcome !== (value.outcome === 'dead' ? 'failed' : 'cleared')) ctx.addIssue({ code: 'custom', message: 'Result records disagree with progress.' });
  if ((value.outcome === 'escaped') !== (value.completedEncounters === 6)) ctx.addIssue({ code: 'custom', message: 'Result progress disagrees.' });
});
export type RunResult = z.infer<typeof RunResultSchema>;

export type InputFrame = {
  moveX: number; moveY: number; aimX: number; aimY: number; aimDistance?: number;
  attackHeld: boolean; abilityPressed: boolean; assistedBasic: boolean;
  hopHeld: boolean; hopCommitId: number | null; hopCancelled: boolean;
  dashPressed?: boolean;
};
export type SpecialRecord = z.infer<typeof SpecialRecordSchema>;
export type BulletPattern = { kind: 'fan' | 'ring'; angle: number; spread: number; count: number; speed: number; gap: number };
export type Action = {
  kind: 'spit' | 'charge' | 'leap' | 'swipe' | 'dash'; stage: 'windup' | 'active'; timeMs: number; durationMs: number; basic?: boolean;
  dirX: number; dirY: number; fromX: number; fromY: number; targetX: number; targetY: number;
  hitIds: number[]; generation: 0 | 1; pattern?: BulletPattern; aimDistance?: number;
};
export type EnemyVariant = 'normal' | 'splitter' | 'sniper' | 'mini';
export type Actor = {
  id: number; species: Species; faction: 'player' | 'enemy' | 'echo';
  x: number; y: number; radius: number; hp: number; maxHp: number; shell: number; maxShell: number;
  facingX: number; facingY: number; basicCooldownMs: number; specialCooldownMs: number;
  invulnerableMs: number; stunMs: number; poisonMs: number; poisonTickMs: number; poisonOwnerId: number;
  action: Action | null; lastSpecial: SpecialRecord | null; elite: boolean; variant?: EnemyVariant; volleyCount: number;
  navigation: { waypoint: Vec2; goal: Vec2; retreat: boolean } | null;
};
export type Corpse = z.infer<typeof CorpseSchema>;
export type Projectile = {
  id: number; ownerId: number; faction: 'player' | 'enemy'; x: number; y: number; prevX: number; prevY: number;
  vx: number; vy: number; radius: number; damage: number; lifeMs: number; kind: 'spit' | 'barb'; generation: 0 | 1; poison: boolean;
  bounces?: number; pierce?: boolean; hitIds?: number[]; heavy?: boolean;
};
export type Area = { id: number; ownerId: number; kind: 'silk' | 'acid'; x: number; y: number; toX: number; toY: number; radius: number; remainingMs: number; tickMs: number; hitIds: number[] };
export type Spore = { id: number; x: number; y: number; radius: number; alive: boolean };
export type Pickup = { id: number; kind: 'heart'; x: number; y: number; radius: number; remainingMs: number };
export type Spawn = { species: Species; x: number; y: number; elite?: boolean; variant?: EnemyVariant };
export type Encounter = { name: string; description: string; start: Vec2; obstacles: Rect[]; enemies: Spawn[]; groups: Spawn[][] };
export type Run = {
  challenge: Challenge; runId: string; healthModel: HealthModel; phase: Phase; resumePhase: 'ready' | 'playing' | 'cleared' | 'reward';
  encounterIndex: number; completedEncounters: number; core: number; maxCore: number; playerId: number;
  actors: Actor[]; corpses: Corpse[]; projectiles: Projectile[]; areas: Area[]; spores: Spore[]; pickups: Pickup[]; obstacles: Rect[];
  silkTrail: { x: number; y: number; remainingMs: number; segmentId: number | null } | null;
  mutations: MutationId[]; rewardOffers: MutationId[]; activeTimeMs: number; encounterTimeMs: number;
  lineage: LineageEntry[]; encounterRecords: EncounterRecord[]; counters: Counters; nextEntityId: number; hopCooldownMs: number; lossCause: string; boundaryCheckpoint: Checkpoint | null;
  encounterGroup: number; exit: Vec2;
};
export type GameEvent =
  | { type: 'attack'; sourceId: number; x: number; y: number; dirX: number; dirY: number; species: Species; kind: 'basic' | 'special' | 'echo'; phase: 'windup' | 'release'; pattern?: BulletPattern }
  | { type: 'damage'; targetId: number; x: number; y: number; amount: number; shellDamage: number; coreDamage: number; shellBroken: boolean; sourceId: number; faction: Actor['faction'] }
  | { type: 'death'; id: number; x: number; y: number; species: Species; player: boolean }
  | { type: 'corpse'; id: number; x: number; y: number; species: Species }
  | { type: 'possess'; fromId: number; toId: number; corpseId: number; abandonedCorpseId: number; fromX: number; fromY: number; x: number; y: number; species: Species; healed: number }
  | { type: 'impact'; sourceId: number; faction: Actor['faction']; hitCount: number; x: number; y: number; radius: number; kind: 'charge' | 'leap' | 'shock' | 'dash' | 'graze' | 'spore' | 'orbit' | 'heart'; dirX?: number; dirY?: number }
  | { type: 'arc'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'surface'; sourceId: number; x: number; y: number; dirX: number; dirY: number; kind: 'spit' | 'charge'; material: 'bread' | 'ceramic'; faction: Actor['faction'] }
  | { type: 'mutation'; mutationId: MutationId; x: number; y: number }
  | { type: 'blocked'; action: 'hop'; reason: string }
  | { type: 'encounterClear'; encounterIndex: number; completedEncounters: number }
  | { type: 'reward'; offers: MutationId[] }
  | { type: 'spawn'; ids: number[]; group: number; totalGroups: number }
  | { type: 'checkpoint' }
  | { type: 'result'; result: RunResult };
