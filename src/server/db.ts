import { redis } from "@devvit/web/server";
import { decodeState, type LeaderboardEntry, type LeaderboardSnapshot, type StateStore } from "./state.ts";

const boardKey = (challengeId: string) => `bodyhop:lb:${challengeId}`;
const metaKey = (challengeId: string) => `bodyhop:lb-meta:${challengeId}`;

export const redisStore: StateStore = {
  async read(key) {
    return decodeState(await redis.get(key));
  },
  async update(key, change) {
    const transaction = await redis.watch(key);
    let queued = false;
    let finished = false;
    try {
      const current = decodeState(await redis.get(key));
      const result = change(current);
      if (!result.ok || result.state === current) {
        await transaction.unwatch();
        finished = true;
        return result;
      }
      await transaction.multi();
      queued = true;
      await transaction.set(key, JSON.stringify(result.state));
      const replies: unknown[] = await transaction.exec();
      finished = true;
      if (replies.length === 1 && replies[0] === "OK") return result;
      return { ok: false, state: decodeState(await redis.get(key)) };
    } finally {
      if (!finished) {
        const cleanup = queued ? transaction.discard() : transaction.unwatch();
        await cleanup.catch(() => console.warn("Could not release the save transaction."));
      }
    }
  },
  async recordScore(challengeId, entry) {
    const bKey = boardKey(challengeId);
    const existing = await redis.zScore(bKey, entry.userId);
    if (existing !== undefined && existing >= entry.score) return;
    await redis.zAdd(bKey, { member: entry.userId, score: entry.score });
    await redis.hSet(metaKey(challengeId), { [entry.userId]: JSON.stringify(entry) });
  },
  async readLeaderboard(challengeId, userId): Promise<LeaderboardSnapshot> {
    const bKey = boardKey(challengeId);
    const mKey = metaKey(challengeId);
    const [top, totalPlayers] = await Promise.all([
      redis.zRange(bKey, 0, 4, { by: "rank", reverse: true }),
      redis.zCard(bKey),
    ]);
    const entries: LeaderboardEntry[] = [];
    for (const row of top) {
      const raw = await redis.hGet(mKey, row.member);
      if (raw) {
        try {
          entries.push(JSON.parse(raw) as LeaderboardEntry);
          continue;
        } catch {
          // fallback below
        }
      }
      entries.push({
        userId: row.member,
        username: "Player",
        score: row.score,
        chambers: 0,
        escaped: false,
        activeTimeMs: 0,
      });
    }
    let playerRank: number | null = null;
    let playerBestScore: number | null = null;
    if (userId) {
      const [ascRank, best] = await Promise.all([
        redis.zRank(bKey, userId),
        redis.zScore(bKey, userId),
      ]);
      if (ascRank !== undefined && totalPlayers > 0) playerRank = totalPlayers - ascRank;
      if (best !== undefined) playerBestScore = best;
    }
    return { entries, totalPlayers, playerRank, playerBestScore };
  },
};
