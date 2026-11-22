import type { IncomingMessage, ServerResponse } from "node:http";
import { computeRunScore } from "../shared/content.ts";
import { restoreCheckpoint } from "../shared/engine.ts";
import {
  applyMutation, emptyState, FinishSchema, playerKey, publicState, SaveSchema,
  type RequestContext, type StateStore,
} from "./state.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(json);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Send JSON content.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65_536) throw new HttpError(413, "This checkpoint is too large.");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export async function routeApi(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  store: StateStore,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/api/bootstrap" && request.method === "GET") {
    const state = context.user ? await store.read(playerKey(context)) : emptyState();
    writeJson(response, 200, { ...context, state: publicState(state) });
    return;
  }
  if (path === "/api/leaderboard" && request.method === "GET") {
    const board = store.readLeaderboard
      ? await store.readLeaderboard(context.challenge.id, context.user?.id ?? null)
      : { entries: [], totalPlayers: 0, playerRank: null, playerBestScore: null };
    writeJson(response, 200, board);
    return;
  }
  if (request.method !== "POST" || (path !== "/api/save" && path !== "/api/result"))
    throw new HttpError(404, "Not found.");
  if (!context.user)
    throw new HttpError(401, "Sign in to save this run to your Reddit account. Local play can continue.");
  const body = await readJson(request);
  const parsed = path === "/api/save" ? SaveSchema.safeParse(body) : FinishSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "This checkpoint or result could not be validated.");
  const input = parsed.data;
  const data = "checkpoint" in input ? input.checkpoint : input.result;
  if (
    input.challengeId !== context.challenge.id ||
    data.challengeId !== context.challenge.id ||
    data.contentVersion !== context.challenge.contentVersion ||
    data.runId !== input.runId
  ) throw new HttpError(409, "This run belongs to a different challenge.");
  if ("checkpoint" in input && !restoreCheckpoint(input.checkpoint, context.challenge))
    throw new HttpError(400, "This checkpoint does not match the challenge.");
  const result = await store.update(playerKey(context), (state) => applyMutation(state, input));
  if (result.ok && "result" in input && store.recordScore) {
    const r = input.result;
    await store.recordScore(context.challenge.id, {
      userId: context.user.id,
      username: context.user.username ?? "Player",
      score: computeRunScore(r),
      chambers: r.completedEncounters,
      escaped: r.outcome === "escaped",
      activeTimeMs: Math.round(r.activeTimeMs),
    }).catch(() => console.warn("Could not record leaderboard score."));
  }
  writeJson(response, result.ok ? 200 : 409, {
    ok: result.ok,
    revision: result.state.revision,
    state: publicState(result.state),
    ...(!result.ok ? { error: "A newer save exists. Load it before syncing this view." } : {}),
  });
}

export function handleError(error: unknown, response: ServerResponse): void {
  if (response.writableEnded) return;
  if (error instanceof HttpError) {
    writeJson(response, error.status, { error: error.message });
    return;
  }
  console.error(error instanceof Error ? error.message : "Request failed.");
  writeJson(response, 503, { error: "Saving is unavailable. Your loaded run can continue locally." });
}
