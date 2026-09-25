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
import { FRONTEND_ROOT, BACKEND_ROOT } from '../config/paths';
import { WsFileEvent } from '../types/file.types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChokidarEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates and returns the WebSocket server (wss) and a startWatcher() function.
 * Call startWatcher() once after the HTTP server is listening.
 *
 * @param httpServer - The Node.js http.Server that Express is attached to.
 */
export function createFsWatcher(httpServer: HttpServer): {
  wss: WebSocketServer;
  startWatcher: () => FSWatcher;
} {
  // ── WebSocket Server ─────────────────────────────────────────────────────
  const wss = new WebSocketServer({
    server: httpServer,
    path:   '/ws',       // ws://localhost:4000/ws
  });

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    console.log(`🔌  WebSocket client connected (${clientIp}) — ${wss.clients.size} total`);

    // Send a greeting so the client knows the connection is live
    socket.send(JSON.stringify({
      event:     'connected',
      path:      '.',
      timestamp: new Date().toISOString(),
      message:   `Watching: ${FRONTEND_ROOT}`,
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
   * Broadcasts a WsFileEvent to every connected client.
   * Silently drops clients that are no longer in OPEN state.
   */
  function broadcast(event: WsFileEvent): void {
    const payload = JSON.stringify(event);
    let sent = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
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
    const watcher = chokidar.watch(FRONTEND_ROOT, {
      // Ignore node_modules, .git, backend/ itself, and .trash/
      ignored: [
        /(^|[/\\])\../,             // Hidden files/dirs (e.g. .git, .env)
        /node_modules/,
        new RegExp(BACKEND_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        /\.trash/,
        /dist/,
      ],
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
