import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";
import { z, ZodError } from "zod";
import { MatchStore, StoreError } from "./store.js";
const hero = z.enum(["warden", "shade"]);
const uuid = z.string().uuid();
const command = z
  .object({
    commandId: uuid,
    turn: z.number().int().min(1).max(16),
    action: z
      .object({
        card: z
          .enum(["scout", "guard", "rampart", "bastion", "raid", "breach"])
          .nullable(),
        zone: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        ability: z.boolean(),
      })
      .strict(),
  })
  .strict();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export interface AppOptions {
  pool: pg.Pool;
  origin: string;
  accessKey: string;
  secureCookies?: boolean;
  serveWeb?: boolean;
  logger?: boolean;
}
export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 4096,
    requestTimeout: 10_000,
  });
  const store = new MatchStore(options.pool);
  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
    if (request.method === "POST" && request.headers.origin !== options.origin)
      throw new StoreError(403, "Invalid request origin.");
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: "Invalid request.", requestId: request.id });
    if (error instanceof StoreError)
      return reply
        .code(error.statusCode)
        .send({ error: error.message, requestId: request.id });
    const code = (error as { statusCode?: number }).statusCode;
    if (code && code >= 400 && code < 500)
      return reply
        .code(code)
        .send({
          error:
            code === 429
              ? "Too many requests. Please wait."
              : "Invalid request.",
        });
    request.log.error({ err: error }, "Request failed");
    return reply
      .code(503)
      .send({
        error: "Temporarily unavailable. Your accepted moves are saved.",
        requestId: request.id,
      });
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await options.pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
    return { status: "ready" };
  });
  async function actor(token?: string) {
    if (!token || token.length > 128)
      throw new StoreError(401, "Enter the playtest to continue.");
    const row = (
      await options.pool.query(
        "SELECT id FROM sessions WHERE token_hash=$1 AND expires_at > now()",
        [hash(token)],
      )
    ).rows[0];
    if (!row)
      throw new StoreError(401, "Session expired. Enter the playtest again.");
    return row.id as string;
  }
  app.get("/api/session", async (request) => ({
    id: await actor(request.cookies.coba_session),
  }));
  app.post(
    "/api/session",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { accessKey } = z
        .object({ accessKey: z.string().max(256) })
        .strict()
        .parse(request.body);
      if (
        !timingSafeEqual(
          Buffer.from(hash(accessKey)),
          Buffer.from(hash(options.accessKey)),
        )
      )
        throw new StoreError(403, "That playtest key is not valid.");
      // Re-entry in the same browser preserves seat ownership.
      try {
        return { id: await actor(request.cookies.coba_session) };
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
      }
      const token = randomBytes(32).toString("hex");
      const id = randomUUID();
      await options.pool.query(
        "INSERT INTO sessions(id,token_hash) VALUES ($1,$2)",
        [id, hash(token)],
      );
      reply.setCookie("coba_session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookies ?? true,
        maxAge: 30 * 86400,
      });
      return { id };
    },
  );
  app.post("/api/matches", async (request) => {
    const input = z.object({ id: uuid, hero }).strict().parse(request.body);
    return store.create(
      input.id,
      await actor(request.cookies.coba_session),
      input.hero,
    );
  });
  app.post("/api/join", async (request) => {
    const input = z
      .object({ code: z.string().regex(/^[A-F0-9]{10}$/), hero })
      .strict()
      .parse(request.body);
    return store.join(
      input.code,
      await actor(request.cookies.coba_session),
      input.hero,
    );
  });
  app.get("/api/matches/:id", async (request) =>
    store.get(
      z.object({ id: uuid }).parse(request.params).id,
      await actor(request.cookies.coba_session),
    ),
  );
  app.post("/api/matches/:id/actions", async (request) => {
    const input = command.parse(request.body);
    return store.command(
      z.object({ id: uuid }).parse(request.params).id,
      await actor(request.cookies.coba_session),
      input.commandId,
      input.turn,
      input.action,
    );
  });
  if (options.serveWeb) {
    await app.register(staticFiles, { root: resolve("web-dist"), maxAge: 0 });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found." })
        : reply.code(404).send("Not found"),
    );
  }
  return { app, store };
}
