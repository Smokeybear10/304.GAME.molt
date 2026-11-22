import { createHash } from "node:crypto";
import { z } from "zod";
import { CONTENT_VERSION, createChallenge } from "../shared/content.ts";
import {
  ChallengeSchema,
  CheckpointSchema,
  RunResultSchema,
  type Challenge,
  type Checkpoint,
  type RunResult,
} from "../shared/types.ts";

export type PlayerState = {
  revision: number;
  activeRun: { runId: string; checkpoint: Checkpoint } | null;
  latestResult: RunResult | null;
  bestProgress: number;
  lastFinishedAt: string | null;
};
export type StoredState = PlayerState & {
  lastMutation: { id: string; fingerprint: string } | null;
};
export type LeaderboardEntry = {
  userId: string;
  username: string;
  score: number;
  chambers: number;
  escaped: boolean;
  activeTimeMs: number;
};
export type LeaderboardSnapshot = {
  entries: LeaderboardEntry[];
  totalPlayers: number;
  playerRank: number | null;
  playerBestScore: number | null;
};
export type UpdateResult = { ok: boolean; state: StoredState };
export type StateStore = {
  read(key: string): Promise<StoredState>;
  update(key: string, change: (state: StoredState) => UpdateResult): Promise<UpdateResult>;
  recordScore?(challengeId: string, entry: LeaderboardEntry): Promise<void>;
  readLeaderboard?(challengeId: string, userId: string | null): Promise<LeaderboardSnapshot>;
};
export type RequestContext = {
  mode: "reddit" | "local";
  challenge: Challenge;
  user: { id: string; username: string | null } | null;
};

const common = {
  challengeId: z.string().min(1).max(120),
  runId: z.uuid(),
  mutationId: z.uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};
export const SaveSchema = z.object({ ...common, checkpoint: CheckpointSchema }).strict();
export const FinishSchema = z.object({ ...common, result: RunResultSchema }).strict();
export type SaveInput = z.infer<typeof SaveSchema>;
export type FinishInput = z.infer<typeof FinishSchema>;

const StoredStateSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activeRun: z.object({ runId: z.uuid(), checkpoint: CheckpointSchema }).strict().nullable(),
  latestResult: RunResultSchema.nullable(),
  bestProgress: z.number().int().min(0).max(6),
  lastFinishedAt: z.iso.datetime().nullable(),
  lastMutation: z.object({ id: z.uuid(), fingerprint: z.string().length(64) }).strict().nullable(),
}).strict();

export const emptyState = (): StoredState => ({
  revision: 0,
  activeRun: null,
  latestResult: null,
  bestProgress: 0,
  lastFinishedAt: null,
  lastMutation: null,
});

export function parseChallenge(value: unknown): Challenge | null {
  const parsed = ChallengeSchema.safeParse(value);
  if (!parsed.success) return null;
  const challenge = parsed.data;
  if (
    !z.iso.date().safeParse(challenge.date).success ||
    challenge.contentVersion !== CONTENT_VERSION ||
    challenge.id !== createChallenge(challenge.date).id
  ) return null;
  return challenge;
}

export function decodeState(raw: string | undefined): StoredState {
  return raw ? StoredStateSchema.parse(JSON.parse(raw)) : emptyState();
}

export function publicState(state: StoredState): PlayerState {
  const { lastMutation: _lastMutation, ...value } = state;
  return value;
}

export function playerKey(context: RequestContext): string {
  if (!context.user) throw new Error("An account is required for account saves.");
  return `bodyhop:player:${context.user.id}:${context.challenge.id}`;
}

export function applyMutation(state: StoredState, input: SaveInput | FinishInput): UpdateResult {
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  if (state.lastMutation?.id === input.mutationId)
    return { ok: state.lastMutation.fingerprint === fingerprint, state };
  if (state.revision !== input.revision) return { ok: false, state };
  const result = "result" in input ? input.result : null;
  const checkpoint = "checkpoint" in input ? input.checkpoint : null;
  if (state.latestResult?.runId === input.runId) return { ok: false, state };
  const progress = result?.completedEncounters ?? checkpoint?.completedEncounters ?? 0;
  if (state.activeRun?.runId === input.runId && progress < state.activeRun.checkpoint.completedEncounters)
    return { ok: false, state };
  return {
    ok: true,
    state: {
      revision: state.revision + 1,
      activeRun: checkpoint ? { runId: input.runId, checkpoint } : null,
      latestResult: result ?? state.latestResult,
      bestProgress: Math.max(state.bestProgress, progress),
      lastFinishedAt: result ? new Date().toISOString() : state.lastFinishedAt,
      lastMutation: { id: input.mutationId, fingerprint },
    },
  };
}
