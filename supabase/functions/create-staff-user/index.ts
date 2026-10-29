// @ts-nocheck
/* eslint-disable */
declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { error: 'Sign in as an administrator.' });

  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return reply(401, { error: 'Your session expired. Sign in again.' });

  // Verify actor has administrator role
  let actor = null;
  const { data: actorByUid } = await service
    .from('users')
    .select('role')
    .eq('uid', auth.user.id)
    .maybeSingle();

  if (actorByUid) {
    actor = actorByUid;
  } else if (auth.user.email) {
    const { data: actorByEmail } = await service
      .from('users')
      .select('role')
      .ilike('email', auth.user.email)
      .maybeSingle();
    actor = actorByEmail;
  }

  if (!actor || actor.role !== 'admin') {
    return reply(403, { error: 'Only administrators can create staff accounts.' });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return reply(400, { error: 'Invalid request payload.' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return reply(400, { error: 'Invalid request payload.' });
  }

  const role = payload.role ?? 'agent';
  if (!['admin', 'secretary', 'agent', 'staff'].includes(role)) {
    return reply(400, { error: 'Choose a valid account role (admin, secretary, agent, or staff).' });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
    return reply(400, { error: 'Enter a valid name, email address, and a password with at least 6 characters.' });
  }

  // Check if account already exists in users table
  const { data: existingUser } = await service
    .from('users')
    .select('uid')
    .ilike('email', email.replace(/[%_]/g, '\\$&'))
    .limit(1);

  if (existingUser?.length) {
    return reply(409, { error: 'This email already has an account. Edit its permissions instead.' });
  }

  // Validate permissions if RPC is available, fallback to basic sanity check
  if (payload.permissions && typeof payload.permissions === 'object') {
    try {
      const { data: valid, error: validationError } = await service.rpc('validate_staff_permissions', { p: payload.permissions });
      if (!validationError && valid === false) {
        return reply(400, { error: 'Choose valid permissions and existing warehouses.' });
      }
    } catch {
      // Continue if RPC is not present
    }
  }

  // Create or reuse Auth User
  let createdUser = null;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (created?.user) {
    createdUser = created.user;
  } else if (createError && createError.message?.toLowerCase().includes('already')) {
    // If the auth user already exists in auth.users, check if they are orphaned (missing from public.users)
    try {
      const { data: listData } = await service.auth.admin.listUsers();
      const existingAuth = listData?.users?.find((u: any) => u.email?.toLowerCase() === email);
      if (existingAuth) {
        const { data: profile } = await service.from('users').select('uid').eq('uid', existingAuth.id).maybeSingle();
        if (!profile) {
          // Orphaned auth user: update password and details
          await service.auth.admin.updateUserById(existingAuth.id, {
            password,
            user_metadata: { full_name: name },
            email_confirm: true,
          });
          createdUser = existingAuth;
        } else {
          return reply(409, { error: 'This email already has an account. Edit its permissions instead.' });
        }
      } else {
        return reply(400, { error: createError.message });
      }
    } catch {
      return reply(400, { error: createError.message });
    }
  } else {
    return reply(400, { error: createError?.message || 'Account creation failed in authentication service.' });
  }

  if (!createdUser) {
    return reply(500, { error: 'Failed to create login credentials.' });
  }

  // Provision user: try RPC first, fallback to direct DB insertion
  let resultData = null;
  try {
    const { data: rpcData, error: rpcError } = await service.rpc('provision_staff_user', {
      p_uid: createdUser.id,
      p_email: email,
      p_name: name,
      p_permissions: payload.permissions || {},
      p_admin_uid: auth.user.id,
      p_role: role,
    });
    if (!rpcError && rpcData && rpcData.user) {
      resultData = rpcData;
    }
  } catch {
    // Fall back to direct insertion below
  }

  // Fallback direct DB insertion if RPC failed or was not available
  if (!resultData) {
    const [firstName = '', ...lastNameParts] = name.split(' ');
    const lastName = lastNameParts.join(' ');
    const userPayload = {
      uid: createdUser.id,
      email,
      displayName: name,
      firstName,
      lastName,
      photoUrl: '',
      role,
    };

    const { data: insertedUser, error: userError } = await service
      .from('users')
      .upsert([userPayload], { onConflict: 'uid' })
      .select()
      .maybeSingle();

    if (userError) {
      console.error('Failed to insert user profile:', userError);
      await service.auth.admin.deleteUser(createdUser.id);
      return reply(500, { error: `Could not save user profile: ${userError.message}` });
    }

    const delegationPayload = {
      id: crypto.randomUUID(),
      agentId: auth.user.id,
      staffEmail: email,
      canAdjustInventory: payload.permissions?.inventory === 'adjust',
      canAdjustPricelist: payload.permissions?.pricelist === 'edit',
      permissions: payload.permissions || {},
      active: true,
      createdAt: new Date().toISOString(),
    };

    const { data: insertedDelegation, error: delError } = await service
      .from('delegations')
      .upsert([delegationPayload], { onConflict: 'staffEmail' })
      .select()
      .maybeSingle();

    if (delError) {
      console.warn('Failed to insert delegation record:', delError);
    }

    resultData = {
      user: insertedUser || userPayload,
      delegation: insertedDelegation || delegationPayload,
    };
  }

  return reply(201, resultData);
});

