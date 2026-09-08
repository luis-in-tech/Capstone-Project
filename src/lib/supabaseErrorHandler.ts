import { toast } from 'sonner';

export enum OperationType {
  GET = 'GET',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  WRITE = 'WRITE'
}

/**
 * Extracts a meaningful message string from an unknown error value.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Extracts the HTTP status code from a Supabase error, if available.
 */
function extractStatusCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.code === 'string' && /^\d+$/.test(e.code)) return parseInt(e.code, 10);
  }
  return null;
}

/**
 * Maps raw Supabase/PostgreSQL errors to user-friendly messages.
 * Prevents raw database exceptions from being exposed to end users.
 */
function getFriendlyMessage(rawMessage: string, statusCode: number | null, context: string): string {
  const lower = rawMessage.toLowerCase();

  // Missing table / relation not found
  if (
    statusCode === 404 ||
    lower.includes('relation') && lower.includes('does not exist') ||
    lower.includes('could not find the table') ||
    lower.includes('schema cache') ||
    lower.includes('not found in the schema')
  ) {
    return `The "${context}" feature requires a database table that hasn't been set up yet. Please run the migration script (supabase/migrations/create_tables.sql) in your Supabase SQL Editor.`;
  }

  // Permission / RLS policy denied
  if (
    statusCode === 403 ||
    lower.includes('permission denied') ||
    lower.includes('rls') ||
    lower.includes('row-level security')
  ) {
    return 'You don\'t have permission to perform this action. Please contact your administrator.';
  }

  // Network / connectivity issues
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('econnrefused')
  ) {
    return 'Unable to connect to the server. Please check your internet connection and try again.';
  }

  // Duplicate key / unique constraint violation
  if (
    lower.includes('duplicate key') ||
    lower.includes('unique constraint') ||
    lower.includes('already exists')
  ) {
    return 'This record already exists. Please check for duplicates and try again.';
  }

  // Foreign key violation
  if (lower.includes('foreign key') || lower.includes('violates foreign key')) {
    return 'This record is referenced by other data and cannot be modified.';
  }

  // Fallback: return original message (it's not a sensitive DB internal)
  return rawMessage;
}

export function handleSupabaseError(error: unknown, operation: OperationType, context: string) {
  console.error(`Supabase Error [${operation}] in ${context}:`, error);
  
  const rawMessage = extractMessage(error);
  const statusCode = extractStatusCode(error);
  const friendlyMessage = getFriendlyMessage(rawMessage, statusCode, context);

  toast.error(`Database Error (${operation})`, {
    description: friendlyMessage
  });
}

