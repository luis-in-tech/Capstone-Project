/**
 * @file fsWatcher.ts
 * @description
 *   Real-time filesystem watcher using chokidar + the `ws` WebSocket library.
 *
 *   When the agent (or any process) modifies files inside the frontend root,
 *   chokidar detects the change and immediately broadcasts a WsFileEvent to
 *   every connected WebSocket client.
 *
 *   The frontend can listen to this stream to:
 *     • Refresh its directory tree automatically.
 *     • Show "file changed" notifications.
 *     • Keep its code editor in sync with agent edits.
 *
 *   Usage:
 *     // In server.ts, after creating the http.Server:
 *     const { wss, startWatcher } = createFsWatcher(server);
 *     startWatcher();
 *
 *   WebSocket URL: ws://localhost:4000/ws
 *
 *   Message format (JSON-encoded WsFileEvent):
 *     { event: "change", path: "src/App.tsx", timestamp: "2024-01-15T…" }
 */

import { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { env } from '../config/env';
import { FRONTEND_ROOT, BACKEND_ROOT } from '../config/paths';
import { WsFileEvent } from '../types/file.types';
import { resolveUserRoleFromHeaders, UserRole } from '../middleware/rbac.middleware';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChokidarEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates and returns the WebSocket server (wss) and a startWatcher() function.
 * Call startWatcher() once after the HTTP server is listening.
 *
 * @param httpServer - The Node.js http.Server that Express is attached to.
 */
type WsAuthenticatedRequest = IncomingMessage & { wsRole?: UserRole };
type WsClientWithAuth = WebSocket & { isAlive?: boolean; userRole?: UserRole };

const FS_WATCH_ROLES: ReadonlySet<UserRole> = new Set(['admin', 'cmo']);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;
  return env.CORS_ORIGINS.some((allowed) => allowed !== '*' && allowed === origin);
}

function authorizeWsRole(req: IncomingMessage): UserRole | null {
  if (!isOriginAllowed(req.headers.origin)) {
    return null;
  }

  // Always fail closed: unauthenticated or field_agent clients cannot subscribe to live FS or P&L streams
  const role = resolveUserRoleFromHeaders(req.headers as Record<string, string | string[] | undefined>);
  if (role === 'field_agent') {
    return null;
  }
  return role;
}

export function createFsWatcher(httpServer: HttpServer): {
  wss: WebSocketServer;
  startWatcher: () => FSWatcher;
} {
  // ── WebSocket Server ─────────────────────────────────────────────────────
  const wss = new WebSocketServer({
    server: httpServer,
    path:   '/ws',       // ws://localhost:4000/ws
    verifyClient: (info, done) => {
      const role = authorizeWsRole(info.req);
      if (!role) {
        done(false, 403, 'Forbidden');
        return;
      }
      (info.req as WsAuthenticatedRequest).wsRole = role;
      done(true);
    },
  });

  // ── Heartbeat Mechanism to Prevent Connection & Memory Leaks ──────────────
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const extSocket = client as WebSocket & { isAlive?: boolean };
      if (extSocket.isAlive === false) {
        return client.terminate();
      }
      extSocket.isAlive = false;
      client.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    const extSocket = socket as WsClientWithAuth;
    extSocket.isAlive = true;
    extSocket.userRole = (req as WsAuthenticatedRequest).wsRole ?? 'field_agent';

    socket.on('pong', () => {
      extSocket.isAlive = true;
    });

    console.log(`🔌  WebSocket client connected (${clientIp}, role=${extSocket.userRole}) — ${wss.clients.size} total`);

    // Send a greeting without exposing host filesystem paths
    socket.send(JSON.stringify({
      event:     'connected',
      path:      '.',
      timestamp: new Date().toISOString(),
      message:   'WebSocket telemetry stream connected',
    }));

    socket.on('close', () => {
      console.log(`🔌  WebSocket client disconnected — ${wss.clients.size} remaining`);
    });

    socket.on('error', (err) => {
      console.error('[WS] Socket error:', err.message);
    });
  });

  // ── Broadcast Helper ─────────────────────────────────────────────────────

  /**
   * Broadcasts a WsFileEvent to admin/cmo WebSocket clients only.
   * Silently drops clients that are no longer in OPEN state or lack FS permissions.
   */
  function broadcast(event: WsFileEvent): void {
    const payload = JSON.stringify(event);
    let sent = 0;
    wss.clients.forEach((client) => {
      const extClient = client as WsClientWithAuth;
      if (client.readyState === WebSocket.OPEN && extClient.userRole && FS_WATCH_ROLES.has(extClient.userRole)) {
        client.send(payload);
        sent++;
      }
    });
    if (sent > 0) {
      console.log(`📡  Broadcast [${event.event}] "${event.path}" → ${sent} client(s)`);
    }
  }

  // ── Chokidar Watcher ─────────────────────────────────────────────────────

  function startWatcher(): FSWatcher {
    const normBackendRoot = path.normalize(BACKEND_ROOT).toLowerCase();

    const watcher = chokidar.watch(FRONTEND_ROOT, {
      // Ignore node_modules, .git, backend/ itself, .trash/, and sensitive files
      ignored: [
        /(^|[/\\])\../,             // Hidden files/dirs (e.g. .git, .env)
        /(^|[/\\])config\.toml$/i,
        /\.pem$/i,
        /\.key$/i,
        /node_modules/,
        (targetPath: string) => {
          const norm = path.normalize(targetPath).toLowerCase();
          return norm === normBackendRoot || norm.startsWith(normBackendRoot + path.sep);
        },
        /\.trash/,
        /dist/,
      ],
      followSymlinks:    false,
      persistent:        true,
      ignoreInitial:     true,       // Don't flood events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 100,     // Wait 100ms after last write before firing event
        pollInterval:       50,
      },
    });

    // Map chokidar events → broadcasts
    const EVENTS: ChokidarEvent[] = ['add', 'addDir', 'change', 'unlink', 'unlinkDir'];
    for (const eventName of EVENTS) {
      watcher.on(eventName, (absolutePath: string) => {
        const relativePath = path.relative(FRONTEND_ROOT, absolutePath).replace(/\\/g, '/');
        broadcast({
          event:     eventName,
          path:      relativePath,
          timestamp: new Date().toISOString(),
        });
      });
    }

    watcher.on('error', (err) => {
      console.error('[chokidar] Watcher error:', err);
    });

    watcher.on('ready', () => {
      console.log(`👁️   Watching for FS changes in: ${FRONTEND_ROOT}`);
    });

    return watcher;
  }

  return { wss, startWatcher };
}
