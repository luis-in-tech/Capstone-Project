import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { error: 'Sign in as an administrator.' });
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return reply(401, { error: 'Your session expired. Sign in again.' });
  const { data: actor } = await service.from('users').select('role').eq('uid', auth.user.id).single();
  if (!actor || actor.role !== 'admin') return reply(403, { error: 'Only the admin can create staff accounts.' });
  let payload;
  try { payload = await request.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400, { error: 'Invalid request.' });
  const role = payload.role ?? 'agent';
  if (!['admin', 'secretary', 'agent', 'staff'].includes(role)) return reply(400, { error: 'Choose a valid account role.' });
  if (role === 'admin' && (auth.user.email?.trim().toLowerCase() !== 'admin@example.com' || !auth.user.email_confirmed_at)) return reply(403, { error: 'Only admin@example.com can create another admin.' });
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) return reply(400, { error: 'Enter a name, valid email, and a password with at least 12 characters.' });
  const { data: valid, error: validationError } = await service.rpc('validate_staff_permissions', { p: payload.permissions });
  if (validationError) return reply(503, { error: 'Staff permissions setup is unavailable. Apply the database migration and retry.' });
  if (!valid) return reply(400, { error: 'Choose valid permissions and existing warehouses.' });
  const { data: canDelegate, error: scopeError } = await service.rpc('staff_can_delegate', { p: payload.permissions, p_actor: auth.user.id });
  if (scopeError) return reply(503, { error: 'Account permission checks are unavailable. Apply the latest permissions migration.' });
  if (!canDelegate) return reply(403, { error: 'Your account cannot assign this access. Contact the administrator.' });
  const { data: existing, error: lookupError } = await service.from('users').select('uid').ilike('email', email.replace(/[%_]/g, '\\$&')).limit(1);
  if (lookupError) return reply(503, { error: 'The user directory could not be checked. Please retry.' });
  if (existing?.length) return reply(409, { error: 'This email already has an account. Edit its permissions instead.' });
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (createError || !created.user) return reply(400, { error: createError?.message || 'Account creation failed.' });
  const { data, error } = await service.rpc('provision_staff_user', { p_uid: created.user.id, p_email: email, p_name: name, p_permissions: payload.permissions, p_admin_uid: auth.user.id, p_role: role });
  if (error) {
    // The profile and delegation transaction rolled back; remove only the new auth user.
    const { error: rollbackError } = await service.auth.admin.deleteUser(created.user.id);
    if (rollbackError) return reply(500, { error: 'The login was created but permissions could not be saved. An administrator must remove the incomplete login in Supabase Auth before retrying.' });
    return reply(500, { error: 'Account creation was rolled back because permissions could not be saved. Please retry.' });
  }
  return reply(201, data);
});
