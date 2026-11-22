import { randomUUID } from "node:crypto";
import { context, createServer, getServerPort, reddit, redis, settings } from "@devvit/web/server";
import { createChallenge } from "../shared/content.ts";
import type { Challenge } from "../shared/types.ts";
import { redisStore } from "./db.ts";
import { handleError, HttpError, routeApi, writeJson } from "./http.ts";
import { parseChallenge } from "./state.ts";

async function postChallenge(): Promise<Challenge> {
  if (!context.postId) throw new HttpError(400, "Open MOLT from its challenge post.");
  if (context.postData?.challenge) {
    const parsed = parseChallenge(context.postData.challenge);
    if (!parsed) throw new HttpError(409, "This post uses an unsupported challenge version.");
    return parsed;
  }
  const key = `bodyhop:post:${context.postId}`;
  const stored = await redis.get(key);
  if (stored) {
    const parsed = parseChallenge(JSON.parse(stored));
    if (!parsed) throw new HttpError(409, "This post uses an unsupported challenge version.");
    return parsed;
  }
  const post = await reddit.getPostById(context.postId);
  const challenge = createChallenge(post.createdAt.toISOString().slice(0, 10));
  await redis.set(key, JSON.stringify(challenge), { nx: true });
  const parsed = parseChallenge(JSON.parse((await redis.get(key)) ?? "null"));
  if (!parsed) throw new HttpError(503, "The challenge could not be loaded. Try again.");
  return parsed;
}

async function createDailyPost(): Promise<{ id: string; url: string }> {
  const challenge = createChallenge(new Date().toISOString().slice(0, 10));
  const key = `bodyhop:daily-post:${challenge.id}`;
  const existing = await redis.get(key);
  if (existing) return JSON.parse(existing) as { id: string; url: string };
  const pendingKey = `${key}:pending`;
  const lockKey = `${key}:creating`;
  const lock = randomUUID();
  const acquired = await redis.set(lockKey, lock, { nx: true, expiration: new Date(Date.now() + 120_000) });
  if (acquired !== "OK") throw new HttpError(409, "Today's post is being created. Try again shortly.");
  try {
    const ready = await redis.get(key);
    if (ready) return JSON.parse(ready) as { id: string; url: string };
    const title = `MOLT · ${challenge.date} · Borrow a body. Find your way out.`;
    const pending = await redis.get(pendingKey);
    let post: { id: string; url: string } | undefined;
    if (pending) {
      const recent = await reddit.getNewPosts({ subredditName: context.subredditName, limit: 100, pageSize: 100 }).all();
      for (const candidate of recent) {
        if (candidate.title !== title) continue;
        const data = await reddit.getPostData(candidate.id);
        const postedChallenge = parseChallenge(data?.challenge);
        if (data?.creationId === pending && postedChallenge?.id === challenge.id && postedChallenge.seed === challenge.seed) {
          post = candidate;
          break;
        }
      }
      if (!post) throw new HttpError(409, "Today's post could not be found in the latest 100 posts. Check the subreddit, then try again. A second post will not be submitted.");
    } else {
      const creationId = randomUUID();
      const claimed = await redis.set(pendingKey, creationId, { nx: true });
      if (claimed !== "OK") throw new HttpError(409, "Today's post is being created. Check the subreddit and try again shortly.");
      const committed = await redis.get(key);
      if (committed) {
        await redis.del(pendingKey);
        return JSON.parse(committed) as { id: string; url: string };
      }
      post = await reddit.submitCustomPost({
        title,
        entry: "default",
        postData: { challenge, creationId },
        textFallback: {
          text: "Defeat enemies, inhabit their bodies, and combine mutations through six encounters. Everyone starts with the same daily challenge. Retries are free. Open this post in the Reddit app or on reddit.com to play.",
        },
      });
    }
    const created = { id: post.id, url: post.url };
    await redis.set(key, JSON.stringify(created));
    await redis.del(pendingKey);
    await redis.set(`bodyhop:post:${post.id}`, JSON.stringify(challenge));
    return created;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error(error instanceof Error ? error.message : "Daily post creation failed.");
    throw new HttpError(503, "Today's post could not be confirmed. Check the subreddit, then try again to recover the original post.");
  } finally {
    try {
      if ((await redis.get(lockKey)) === lock) await redis.del(lockKey);
    } catch {
      console.warn("Could not release the daily post creation lock.");
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path.startsWith("/api/")) {
      await routeApi(request, response, {
        mode: "reddit",
        challenge: await postChallenge(),
        user: context.userId ? { id: context.userId, username: context.username ?? null } : null,
      }, redisStore);
      return;
    }
    if (request.method !== "POST") throw new HttpError(404, "Not found.");
    if (path === "/internal/menu/daily-post") {
      const post = await createDailyPost();
      writeJson(response, 200, { navigateTo: post.url, showToast: { text: "Today's MOLT is ready.", appearance: "success" } });
      return;
    }
    if (path === "/internal/install") {
      await createDailyPost();
      writeJson(response, 200, {});
      return;
    }
    if (path === "/internal/scheduler/daily-post") {
      if (await settings.get<boolean>("daily-posts")) await createDailyPost();
      writeJson(response, 200, {});
      return;
    }
    throw new HttpError(404, "Not found.");
  } catch (error) {
    handleError(error, response);
  }
});

server.on("error", (error) => console.error(error.message));
server.listen(getServerPort());
