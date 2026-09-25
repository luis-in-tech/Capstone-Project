/**
 * @file server.ts
 * @description
 *   Anti Gravity Backend — Express application entry point.
 *
 *   Startup sequence:
 *     1. Validate environment variables (env.ts hard-fails on bad config).
 *     2. Ensure backend/.trash/ directory exists.
 *     3. Create Express app with middleware stack.
 *     4. Mount all API routers under /api/v1/.
 *     5. Create HTTP server (needed to share with WebSocket server).
 *     6. Attach WebSocket server (chokidar FS watcher).
 *     7. Test the database connection.
 *     8. Start listening on configured PORT.
 *
 *   Available routes (summary):
 *     GET    /health                           → Health check
 *     GET    /api/v1/files/tree                → Directory tree
 *     GET    /api/v1/files/read                → Read file
 *     POST   /api/v1/files/write               → Write file
 *     POST   /api/v1/files/mkdir               → Create directory
 *     PUT    /api/v1/files/rename              → Rename/move
 *     DELETE /api/v1/files/delete              → Delete (auto-backup)
 *     GET    /api/v1/agent/sessions            → List sessions
 *     POST   /api/v1/agent/sessions            → Create session
 *     GET    /api/v1/agent/sessions/:id        → Get session
 *     PATCH  /api/v1/agent/sessions/:id        → Update session
 *     GET    /api/v1/agent/sessions/:id/actions → Action log
 *     POST   /api/v1/agent/sessions/:id/snapshot → Snapshot
 *     GET    /api/v1/restore/backups           → List backups
 *     POST   /api/v1/restore/backups/:id/restore → Restore file
 *     WS     ws://host:PORT/ws                 → Live FS change events
 */

import 'dotenv/config'; // Must be first — ensures process.env is populated before any import reads it
import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

// Enable BigInt serialization for Prisma entities
(BigInt.prototype as any).toJSON = function () {
  const intVal = Number(this);
  return Number.isSafeInteger(intVal) ? intVal : this.toString();
};

// ── Config & Utilities ────────────────────────────────────────────────────────
import { env }           from './config/env';
import { ensureTrashDir, FRONTEND_ROOT, BACKEND_ROOT } from './config/paths';
import prisma            from './db/prisma.client';

// ── Middleware ────────────────────────────────────────────────────────────────
import { requestLogger } from './middleware/requestLogger';
import { errorHandler }  from './middleware/errorHandler';

// ── Routes ────────────────────────────────────────────────────────────────────
import filesRoutes   from './routes/files.routes';
import agentRoutes   from './routes/agent.routes';
import restoreRoutes from './routes/restore.routes';

// ── WebSocket / FS Watcher ────────────────────────────────────────────────────
import { createFsWatcher } from './ws/fsWatcher';

// ═════════════════════════════════════════════════════════════════════════════
//  App Bootstrap
// ═════════════════════════════════════════════════════════════════════════════

async function bootstrap(): Promise<void> {
  // 1. Ensure .trash/ backup directory exists
  ensureTrashDir();

  // 2. Create Express application
  const app = express();

  // ── Core Middleware ─────────────────────────────────────────────────────────

  /**
   * helmet: Sets secure HTTP headers (X-Content-Type-Options, X-Frame-Options,
   * Strict-Transport-Security, etc.) — minimal effort, big security win.
   */
  app.use(helmet());

  /**
   * cors: Restricts which origins can call the API.
   * Origins come from CORS_ORIGINS env var (comma-separated).
   */
  app.use(cors({
    origin:      env.CORS_ORIGINS,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));

  /**
   * express.json: Parses incoming request bodies as JSON.
   * Limit set to 10mb to accommodate large file writes.
   */
  app.use(express.json({ limit: '10mb' }));

  /** Request logger — coloured output in dev, Apache combined format in prod. */
  app.use(requestLogger);

  // ── Health Check ────────────────────────────────────────────────────────────

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status:          'ok',
      service:         'anti-gravity-backend',
      version:         '1.0.0',
      frontendRoot:    FRONTEND_ROOT,
      backendRoot:     BACKEND_ROOT,
      timestamp:       new Date().toISOString(),
      environment:     env.NODE_ENV,
    });
  });

  // ── API Routes ──────────────────────────────────────────────────────────────

  app.use('/api/v1/files',   filesRoutes);
  app.use('/api/v1/agent',   agentRoutes);
  app.use('/api/v1/restore', restoreRoutes);

  // ── 404 Handler — for any unmatched route ───────────────────────────────────

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success:   false,
      error: {
        code:    'NOT_FOUND',
        message: `Route not found. Check GET /health for available routes.`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ── Global Error Handler — MUST be last ─────────────────────────────────────

  app.use(errorHandler);

  // ── HTTP Server ─────────────────────────────────────────────────────────────

  /**
   * We create a plain http.Server (not app.listen) so we can share it with
   * the WebSocket server (ws requires access to the http.Server upgrade event).
   */
  const httpServer = http.createServer(app);

  // ── WebSocket + FS Watcher ──────────────────────────────────────────────────

  const { startWatcher } = createFsWatcher(httpServer);

  // ── Database Connection Check ───────────────────────────────────────────────

  try {
    await prisma.$connect();
    console.log('✅  PostgreSQL connected via Prisma.');
  } catch (err) {
    console.error('❌  Failed to connect to PostgreSQL:', err);
    console.error('    → Check DATABASE_URL in your .env file.');
    process.exit(1); // Cannot operate without a database
  }

  // ── Start Listening ─────────────────────────────────────────────────────────

  httpServer.listen(env.PORT, () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀  Anti Gravity Backend is running`);
    console.log(`    REST API  → http://localhost:${env.PORT}/api/v1`);
    console.log(`    WebSocket → ws://localhost:${env.PORT}/ws`);
    console.log(`    Health    → http://localhost:${env.PORT}/health`);
    console.log(`    Env       → ${env.NODE_ENV}`);
    console.log(`    Watching  → ${FRONTEND_ROOT}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Start watching AFTER the server is bound (avoids race conditions)
    startWatcher();
  });

  // ── Graceful Shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Shutting down gracefully…`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      console.log('✅  DB connection closed. Bye!');
      process.exit(0);
    });
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── Run ───────────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
