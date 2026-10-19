/**
 * @file env.ts
 * @description Loads, validates, and exports all environment variables using Zod.
 * The server will throw a descriptive error at startup if any required variable
 * is missing or malformed — fail fast, never silently use undefined values.
 */

import { z } from 'zod';
import path from 'path';
import dotenv from 'dotenv';

// Load .env from the backend/ directory (one level up from src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Schema ───────────────────────────────────────────────────────────────────

const EnvSchema = z.object({
  /** Express server port */
  PORT: z
    .string()
    .default('4000')
    .transform(Number)
    .refine((n) => n > 0 && n < 65536, { message: 'PORT must be between 1 and 65535' }),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** PostgreSQL connection string consumed by Prisma */
  DATABASE_URL: z
    .string()
    .default(
      process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined
        ? 'postgresql://test:test@localhost:5432/test?schema=public'
        : ''
    )
    .refine((val) => val.length > 0, { message: 'DATABASE_URL is required — see .env.example' }),

  /**
   * Absolute path to the frontend project directory the agent will manage.
   * The backend enforces that ALL file operations stay within this boundary.
   */
  FRONTEND_ROOT: z
    .string()
    .default(path.resolve(__dirname, '../../..')),

  /** Comma-separated CORS origins (e.g. "http://localhost:3000") */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((val) => val.split(',').map((s) => s.trim())),

  /** Optional API secret for future auth middleware */
  API_SECRET: z.string().optional(),
});

// ─── Parse & Export ───────────────────────────────────────────────────────────

const _parsed = EnvSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('❌  Invalid environment configuration:\n');
  console.error(_parsed.error.format());
  process.exit(1); // Hard-fail: do not start the server with bad config
}

/** Fully validated, typed environment config. Import this instead of process.env. */
export const env = _parsed.data;
