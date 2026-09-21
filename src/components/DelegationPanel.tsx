import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Search, ShieldCheck, UserRound, Users, Warehouse as WarehouseIcon, CircleAlert, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { useAuth } from '../hooks/useAuth';
import { collection, db, onSnapshot } from '../lib/supabaseAdapter';
import { supabase } from '../lib/supabase';
import { defaultPermissions, rolePermissions, movementOptions, normalizePermissions, resolvePermissions, getSupplyChainViews, supplyChainViews, hasAdminRole, canCreateAdmin, canManageUser, permissionsWithin } from '../lib/staffPermissions';
import type { StaffDelegation, StaffPermissions, UserProfile, Warehouse } from '../types';

const orderLabels = { none: 'No access', view: 'View only', create: 'Can create orders' };
const supplyLabels = { customers: 'Customers', suppliers: 'Suppliers', warehouses: 'Warehouses' };
const supplySummary = (value: StaffPermissions['supplyChain']) => getSupplyChainViews(value).map(view => supplyLabels[view]).join(', ') || 'No access';
const movementLabel = (value: string) => movementOptions.find(([id]) => id === value)?.[1] || 'No access';
const selectClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function PermissionSelect({ id, label, value, options, disabledValues = [], onChange }: { id: string; label: string; value: string; options: readonly (readonly [string, string])[]; disabledValues?: string[]; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} className={selectClass} value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key} disabled={disabledValues.includes(key)}>{text}</option>)}</select></div>;
}

export function DelegationPanel() {
  const { profile } = useAuth();
  const access = useStaffAccess();
  const isAdmin = profile?.role === 'admin';
  const allowAdminCreation = canCreateAdmin(profile);
  const canManage = hasAdminRole(profile) && !access.revoked && !access.error;
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [delegations, setDelegations] = useState<StaffDelegation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [status, setStatus] = useState('active');
  const [editor, setEditor] = useState<UserProfile | 'new' | null>(null);
  const [draft, setDraft] = useState<StaffPermissions>({ ...defaultPermissions });
  const [selectedRole, setSelectedRole] = useState<UserProfile['role']>('agent');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deactivate, setDeactivate] = useState<UserProfile | null>(null);
  const [actionError, setActionError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    setLoaded([]); setErrors({});
    const watch = <T,>(table: string, update: (rows: T[]) => void) => onSnapshot(collection(db, table), snap => {
      update(snap.docs.map(d => ({ id: d.id, ...d.data() } as T)));
      setLoaded(current => [...new Set([...current, table])]);
      setErrors(current => { const next = { ...current }; delete next[table]; return next; });
    }, () => setErrors(current => ({ ...current, [table]: `Could not load ${table === 'delegations' ? 'permissions' : table}.` })));
    const stops = [watch('users', setUsers), watch('delegations', setDelegations), watch('warehouses', setWarehouses)];
    return () => stops.forEach(stop => stop());
  }, [profile?.role, canManage, reload]);

  const byEmail = useMemo(() => new Map(delegations.map(d => [d.staffEmail.trim().toLowerCase(), d])), [delegations]);
  const delegationFor = (user: UserProfile) => byEmail.get(user.email.trim().toLowerCase());
  const inactive = (user: UserProfile) => user.role !== 'admin' && delegationFor(user)?.active === false;
  const activeCount = users.filter(user => !inactive(user)).length;
  const unassigned = users.filter(user => user.role !== 'admin' && !inactive(user) && !delegationFor(user)).length;
  const ready = loaded.includes('users') && loaded.includes('delegations') && !errors.users && !errors.delegations;
  const warehouseReady = loaded.includes('warehouses') && !errors.warehouses;
  const rows = users.filter(user => (roleFilter === 'all' || user.role === roleFilter) && (status === 'all' || (status === 'inactive' ? inactive(user) : !inactive(user))) && `${user.displayName} ${user.email} ${user.role}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
  const selectedUser = editor && editor !== 'new' ? editor : null;
  const currentDelegation = selectedUser ? delegationFor(selectedUser) : undefined;
  const patch = (value: Partial<StaffPermissions>) => { setDirty(true); setFormError(''); setDraft(prev => normalizePermissions({ ...prev, ...value })); };
  const startEdit = (user: UserProfile | 'new') => {
    const saved = user === 'new' ? undefined : delegationFor(user);
    // Restore the saved settings for review instead of the effective deactivated access.
    setSelectedRole(user === 'new' ? 'agent' : user.role);
    setEditor(user); setDraft(user === 'new' ? rolePermissions('agent') : resolvePermissions(user, saved ? { ...saved, active: true } : undefined));
    setName(''); setEmail(''); setPassword(''); setWarehouseSearch(''); setFormError(''); setDirty(false);
  };
  const closeEditor = () => { if (!saving) { if (dirty) setDiscard(true); else { setEditor(null); setPassword(''); } } };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !editor || !canManage || (editor !== 'new' && !canManageUser(profile, editor))) return;
    if (selectedRole === 'admin' && (editor !== 'new' || !allowAdminCreation)) { setFormError('Only admin@example.com can create another admin.'); return; }
    const permissions = selectedRole === 'admin' ? rolePermissions('admin') : normalizePermissions(draft);
    if (!isAdmin && !permissionsWithin(permissions, access.permissions)) { setFormError('You can assign only permissions and warehouses available to your own account. Contact the administrator.'); return; }
    if (permissions.warehouseAccess === 'selected' && (!permissions.warehouseIds.length || permissions.warehouseIds.some(id => !warehouses.some(w => w.id === id)))) {
      setFormError('Select at least one existing warehouse. Remove any unavailable selections.'); return;
    }
    if (editor === 'new' && users.some(user => user.email.toLowerCase() === email.trim().toLowerCase())) {
      setFormError('This email already has an account. Edit its permissions in Users & Permissions.'); return;
    }
    setSaving(true); setFormError('');
    try {
      if (editor === 'new') {
        const { data, error } = await supabase.functions.invoke('create-staff-user', { body: { email: email.trim().toLowerCase(), name: name.trim(), password, permissions, role: selectedRole } });
        if (error) {
          let detail = 'Could not create the staff account. Check that the staff account service is deployed and try again.';
          if (error.context instanceof Response) { try { detail = (await error.context.json()).error || detail; } catch { /* keep fallback */ } }
          throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);
        if (data?.user) setUsers(current => [...current.filter(user => user.uid !== data.user.uid), data.user]);
        if (data?.delegation) setDelegations(current => [...current.filter(d => d.id !== data.delegation.id), data.delegation]);
        toast.success('User account created', { description: 'The staff member can sign in with their email and password.' });
      } else {
        const { data, error } = await supabase.rpc('set_staff_role_access', { p_uid: editor.uid, p_role: selectedRole, p_permissions: permissions });
        if (error) throw error;
        setDelegations(current => [...current.filter(d => d.staffEmail.toLowerCase() !== editor.email.toLowerCase()), data as StaffDelegation]);
        setUsers(current => current.map(user => user.uid === editor.uid ? { ...user, role: selectedRole } : user));
        toast.success(currentDelegation?.active === false ? 'Access restored' : 'Permissions saved');
      }
      setEditor(null); setPassword(''); setDirty(false);
    } catch (error) {
      const message = (error as { message?: string }).message || 'Unable to save permissions. Please try again.';
      setFormError(/schema cache|function.*does not exist/i.test(message) ? 'Permissions setup is not available yet. Apply the Staff Delegation database migration, then retry.' : message);
    } finally { setSaving(false); }
  }

  async function revoke() {
    if (!deactivate || saving || !canManage || !canManageUser(profile, deactivate)) return;
    setSaving(true); setActionError('');
    try {
      const { data, error } = await supabase.rpc('set_staff_access', { p_uid: deactivate.uid, p_permissions: resolvePermissions(deactivate, delegationFor(deactivate)), p_active: false });
      if (error) throw error;
      setDelegations(current => [...current.filter(d => d.staffEmail.toLowerCase() !== deactivate.email.toLowerCase()), data as StaffDelegation]);
      toast.success('Access deactivated'); setDeactivate(null);
    } catch { setActionError('Access could not be deactivated. Please retry.'); }
    finally { setSaving(false); }
  }

  if (!canManage) return <div className="rounded-xl border p-8 text-center"><ShieldOff className="mx-auto mb-3 size-8 text-muted-foreground" /><h1 className="font-semibold">Administrator access required</h1><p className="mt-2 text-sm text-muted-foreground">Only the admin can manage user permissions.</p></div>;

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><div className="mb-2 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">Users &amp; Permissions</h1><Badge variant="outline" className="gap-1.5"><ShieldCheck className="size-3" />Admin access</Badge></div><p className="text-sm text-muted-foreground">Manage your team, their module permissions, and the warehouses they can access.</p></div><Button className="h-11 shrink-0 rounded-xl" disabled={!ready} onClick={() => startEdit('new')}><Plus className="size-4" />Add user account</Button></div>
    <div className="grid gap-3 sm:grid-cols-3">{[{ label: 'Active accounts', value: activeCount, detail: 'All users, including administrators', icon: Users }, { label: 'No permissions assigned', value: unassigned, detail: 'Accounts without a delegation', icon: UserRound }, { label: 'Deactivated access', value: users.length - activeCount, detail: 'Access can be restored anytime', icon: ShieldOff }].map(item => <div key={item.label} className="flex items-start gap-3 rounded-xl border bg-card p-5"><div className="rounded-lg bg-muted p-2.5"><item.icon className="size-5 text-muted-foreground" /></div><div><p className="text-xs font-medium text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-semibold">{ready ? item.value : '—'}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div></div>)}</div>
    {Object.keys(errors).length > 0 && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><span>{Object.values(errors).join(' ')}</span><Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></div>}
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="h-10 pl-9" aria-label="Search user accounts" placeholder="Search by name, email, or role…" value={search} onChange={event => setSearch(event.target.value)} /></div><select className={`${selectClass} sm:w-44`} aria-label="Filter by role tag" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">All role tags</option><option value="admin">Admin</option><option value="secretary">Secretary</option><option value="agent">Agent</option><option value="staff">Staff</option></select><select className={`${selectClass} sm:w-48`} aria-label="Filter account status" value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active accounts</option><option value="all">All accounts</option><option value="inactive">Deactivated access</option></select></div>
      <Table><TableHeader className="bg-muted/40"><TableRow><TableHead className="pl-5">User</TableHead><TableHead>Status</TableHead><TableHead className="min-w-72">Permissions</TableHead><TableHead className="min-w-44">Warehouse access</TableHead><TableHead className="pr-5 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
        {ready && rows.map(user => {
          const delegation = delegationFor(user); const permissions = resolvePermissions(user, delegation); const protectedAccount = user.role === 'admin'; const editable = canManageUser(profile, user); const disabled = inactive(user);
          return <TableRow key={user.uid}><TableCell className="py-5 pl-5 align-top"><div className="flex items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div><div><p className="font-semibold">{user.displayName || 'Unnamed user'}</p><p className="mt-0.5 text-xs text-muted-foreground">{user.email}</p><p className="mt-1 text-[11px] capitalize text-muted-foreground">{user.role}{user.uid === profile.uid ? ' · You' : ''}</p></div></div></TableCell>
            <TableCell className="align-top py-5"><Badge variant={disabled ? 'outline' : 'secondary'}>{disabled ? 'Deactivated' : 'Active'}</Badge></TableCell>
            <TableCell className="py-5 align-top">{protectedAccount ? <span className="inline-flex items-center gap-1.5 text-sm font-medium"><ShieldCheck className="size-4 text-primary" />Full administrator access</span> : disabled ? <p className="text-sm text-muted-foreground">Access deactivated</p> : <div className="space-y-2">{!delegation && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">No Permissions Assigned</Badge>}<div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"><span><span className="text-muted-foreground">Inventory:</span> {permissions.inventory === 'adjust' ? 'Can adjust' : 'View only'}</span><span><span className="text-muted-foreground">Pricelist:</span> {permissions.pricelist === 'edit' ? 'Can edit' : 'View only'}</span><span><span className="text-muted-foreground">Orders:</span> {orderLabels[permissions.orders]}</span><span><span className="text-muted-foreground">Supply Chain:</span> {supplySummary(permissions.supplyChain)}</span><span><span className="text-muted-foreground">Movement view:</span> {movementLabel(permissions.movementView)}</span><span><span className="text-muted-foreground">Movement create:</span> {movementLabel(permissions.movementCreate)}</span></div>{!delegation && <p className="text-[11px] text-muted-foreground">Current role defaults shown. Assign permissions to customize access.</p>}</div>}</TableCell>
            <TableCell className="max-w-60 py-5 align-top text-xs">{disabled ? <span className="text-muted-foreground">No access</span> : permissions.warehouseAccess === 'all' ? <span className="inline-flex items-center gap-1.5"><WarehouseIcon className="size-3.5 text-muted-foreground" />All warehouses</span> : <div><p className="mb-1 font-medium">{permissions.warehouseIds.length} selected</p><p className="text-muted-foreground">{permissions.warehouseIds.map(id => warehouses.find(w => w.id === id)?.name || 'Unavailable warehouse').join(', ') || 'No warehouses'}</p></div>}</TableCell>
            <TableCell className="py-5 pr-5 align-top"><div className="flex justify-end gap-1">{!editable ? <span className="text-xs text-muted-foreground">{protectedAccount ? 'Protected admin' : user.uid === profile.uid ? 'Your account' : 'Admin managed'}</span> : <><Button variant="outline" size="sm" onClick={() => startEdit(user)}><Pencil className="size-3.5" />{disabled ? 'Restore access' : 'Edit permissions'}</Button>{!disabled && <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setDeactivate(user); setActionError(''); }}>Deactivate</Button>}</>}</div></TableCell></TableRow>;
        })}
        {(!ready || !rows.length) && <TableRow><TableCell colSpan={5} className="h-52 text-center"><div className="mx-auto flex max-w-sm flex-col items-center gap-2">{!ready && !Object.keys(errors).length ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <Users className="size-8 text-muted-foreground" />}<p className="font-medium">{!ready ? Object.keys(errors).length ? 'Accounts unavailable' : 'Loading accounts…' : 'No accounts found'}</p><p className="text-xs text-muted-foreground">{!ready ? 'User accounts and permissions must both load before making changes.' : search || status !== 'active' || roleFilter !== 'all' ? 'Try another search or account status.' : 'Add a staff account to get started.'}</p></div></TableCell></TableRow>}
      </TableBody></Table><div className="border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">{ready ? `Showing ${rows.length} of ${users.length} user accounts` : 'Loading user directory'} · Accounts appear here even without assigned permissions.</div>
    </div>

    <Dialog open={!!editor} onOpenChange={open => { if (!open) closeEditor(); }}><DialogContent className="flex h-[92dvh] max-h-[920px] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={!saving}>
      <DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle>{editor === 'new' ? 'Add user account' : currentDelegation?.active === false ? 'Restore access' : 'Edit permissions'}</DialogTitle><DialogDescription>{editor === 'new' ? 'Create a login and choose its module permissions. Choose a role, then customize its permissions.' : `${selectedUser?.displayName || 'User'} · ${selectedUser?.email}`}</DialogDescription></DialogHeader>
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><fieldset disabled={saving} className="min-w-0 space-y-6 disabled:opacity-70">
        {editor === 'new' && <section className="space-y-4"><h3 className="text-sm font-semibold">Account details</h3><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="staff-name">Full name</Label><Input id="staff-name" required maxLength={120} autoComplete="name" value={name} onChange={event => { setName(event.target.value); setDirty(true); }} /></div><div className="space-y-2"><Label htmlFor="staff-email">Email address</Label><Input id="staff-email" type="email" required autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setDirty(true); }} /></div></div><div className="space-y-2"><Label htmlFor="staff-password">Initial password</Label><Input id="staff-password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setDirty(true); }} /><p className="text-xs text-muted-foreground">Use at least 12 characters. Share the login details with the staff member securely.</p></div></section>}
        <section className="space-y-3 rounded-xl border bg-muted/20 p-4"><PermissionSelect id="staff-role" label="Role / permission preset" value={selectedRole} options={[[ 'admin', allowAdminCreation && editor === 'new' ? 'Admin' : 'Admin (admin@example.com only)' ], [ 'secretary', 'Secretary' ], [ 'agent', 'Agent' ], [ 'staff', 'Staff' ]]} disabledValues={allowAdminCreation && editor === 'new' ? [] : ['admin']} onChange={value => { const role = value as UserProfile['role']; setSelectedRole(role); patch({ ...rolePermissions(role), warehouseAccess: draft.warehouseAccess, warehouseIds: [...draft.warehouseIds] }); }} /><p className="text-xs text-muted-foreground">Choosing a role fills in its suggested module permissions. Customize them below before saving. Your warehouse selection stays unchanged.</p><p className="text-xs text-muted-foreground">Secretary: inventory adjustments, order creation, both movement types, and all Supply Chain views. Agent: order creation and customer viewing. Both can view the pricelist. Staff: inventory and pricelist viewing, with no access to orders, movements, or Supply Chain until assigned.</p></section>
        {selectedRole === 'admin' && <p className="rounded-xl border bg-muted/30 p-4 text-sm">Admin accounts have full access to all modules and warehouses. Only admin@example.com can create additional admins.</p>}
        <div className="space-y-6" hidden={selectedRole === 'admin'}><section className="space-y-4"><div><h3 className="text-sm font-semibold">Module permissions</h3><p className="mt-1 text-xs text-muted-foreground">Choose one access level for each module.{!isAdmin && ' You can assign only access available to your own account.'}</p></div><div className="grid gap-4 sm:grid-cols-2"><PermissionSelect id="staff-inventory" disabledValues={!isAdmin && access.permissions.inventory !== 'adjust' ? ['adjust'] : []} label="Inventory" value={draft.inventory} options={[[ 'view', 'View only' ], [ 'adjust', 'Can adjust inventory' ]]} onChange={value => patch({ inventory: value as StaffPermissions['inventory'] })} /><PermissionSelect id="staff-pricelist" disabledValues={!isAdmin && access.permissions.pricelist !== 'edit' ? ['edit'] : []} label="Pricelist" value={draft.pricelist} options={[[ 'view', 'View only' ], [ 'edit', 'Can edit pricelist' ]]} onChange={value => patch({ pricelist: value as StaffPermissions['pricelist'] })} /><PermissionSelect id="staff-orders" disabledValues={isAdmin ? [] : ['none', 'view', 'create'].filter((_, index) => index > ['none', 'view', 'create'].indexOf(access.permissions.orders))} label="Order Entry" value={draft.orders} options={Object.entries(orderLabels)} onChange={value => patch({ orders: value as StaffPermissions['orders'] })} /></div></section>
        <section className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Supply Chain</h3><Badge variant="secondary">{getSupplyChainViews(draft.supplyChain).length ? `${getSupplyChainViews(draft.supplyChain).length} views selected` : 'No access'}</Badge></div><p className="text-xs text-muted-foreground">Select any combination. Leave all unchecked for no Supply Chain access.</p><label className="flex items-center gap-3 rounded-lg bg-muted/40 p-3 text-sm font-medium"><input type="checkbox" className="size-4 accent-primary" checked={getSupplyChainViews(draft.supplyChain).length === 3} ref={element => { if (element) element.indeterminate = getSupplyChainViews(draft.supplyChain).length > 0 && getSupplyChainViews(draft.supplyChain).length < 3; }} disabled={!isAdmin && getSupplyChainViews(access.permissions.supplyChain).length !== 3} onChange={event => patch({ supplyChain: event.target.checked ? [...supplyChainViews] : [] })} />View All</label><div className="grid gap-2 sm:grid-cols-3">{supplyChainViews.map(view => <label key={view} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={getSupplyChainViews(draft.supplyChain).includes(view)} disabled={!isAdmin && !getSupplyChainViews(access.permissions.supplyChain).includes(view)} onChange={event => patch({ supplyChain: event.target.checked ? [...getSupplyChainViews(draft.supplyChain), view] : getSupplyChainViews(draft.supplyChain).filter(item => item !== view) })} />View {supplyLabels[view]}</label>)}</div><p className="text-xs text-muted-foreground">These permissions allow viewing only.</p></section>
        <section className="space-y-4 rounded-xl border bg-muted/20 p-4"><div><h3 className="text-sm font-semibold">Item Entry / Inventory Movement</h3><p className="mt-1 text-xs text-muted-foreground">External = supplier receipts. Internal = warehouse transfers.</p></div><div className="grid gap-4 sm:grid-cols-2"><PermissionSelect id="staff-movement-view" disabledValues={isAdmin ? [] : movementOptions.filter(([value]) => value !== 'none' && access.permissions.movementView !== 'both' && access.permissions.movementView !== value).map(([value]) => value)} label="View movements" value={draft.movementView} options={movementOptions} onChange={value => patch({ movementView: value as StaffPermissions['movementView'] })} /><PermissionSelect id="staff-movement-create" disabledValues={isAdmin ? [] : movementOptions.filter(([value]) => value !== 'none' && access.permissions.movementCreate !== 'both' && access.permissions.movementCreate !== value).map(([value]) => value)} label="Create movements" value={draft.movementCreate} options={movementOptions.filter(([value]) => value === 'none' || draft.movementView === 'both' || draft.movementView === value)} onChange={value => patch({ movementCreate: value as StaffPermissions['movementCreate'] })} /></div><p className="text-xs text-muted-foreground">Staff can create only the movement types they can view. Reducing view access also removes incompatible create access.</p></section>
        <section className="space-y-4"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><WarehouseIcon className="size-4" />Warehouse access</h3><p className="mt-1 text-xs text-muted-foreground">Warehouse scope applies across enabled modules: inventory, orders, item entry, and Supply Chain. It does not enable a module or grant editing rights. Internal transfers require access to both warehouses.</p></div><p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">{getSupplyChainViews(draft.supplyChain).length === 0 ? 'Supply Chain access is off. You can still select warehouses to limit inventory, orders, and item entry. Selecting warehouses does not turn Supply Chain access on.' : 'These warehouse limits apply to inventory, orders, item entry, and the Supply Chain views selected above. Selecting warehouses does not enable additional Supply Chain views.'}</p><div className="grid gap-3 sm:grid-cols-2">{[['all', 'All Warehouses', 'Use all warehouses within enabled modules.'], ['selected', 'Selected Warehouses only', 'Choose one or more existing warehouses.']].map(([value, title, description]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${draft.warehouseAccess === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40'}`}><input type="radio" className="mt-1 accent-primary" name="warehouse-access" disabled={value === 'all' && !isAdmin && access.permissions.warehouseAccess === 'selected'} value={value} checked={draft.warehouseAccess === value} onChange={() => patch({ warehouseAccess: value as StaffPermissions['warehouseAccess'] })} /><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span></label>)}</div>
          {draft.warehouseAccess === 'selected' && <div className="rounded-xl border"><div className="space-y-2 border-b p-3"><Input aria-label="Search warehouses" placeholder="Search warehouse name or location…" value={warehouseSearch} onChange={event => setWarehouseSearch(event.target.value)} /><p className="text-xs text-muted-foreground">{draft.warehouseIds.length} selected</p></div><div className="max-h-48 space-y-1 overflow-y-auto p-2">{!warehouseReady ? <p className="p-3 text-sm text-muted-foreground">{errors.warehouses ? 'Warehouses unavailable. Close this dialog and retry loading.' : 'Loading warehouses…'}</p> : warehouses.filter(w => `${w.name} ${w.location}`.toLowerCase().includes(warehouseSearch.toLowerCase())).map(w => <label key={w.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-muted/50"><input type="checkbox" className="size-4 accent-primary" checked={draft.warehouseIds.includes(w.id)} onChange={event => patch({ warehouseIds: event.target.checked ? [...draft.warehouseIds, w.id] : draft.warehouseIds.filter(id => id !== w.id) })} /><span><span className="block text-sm font-medium">{w.name}{w.active === false ? ' (inactive)' : ''}</span><span className="text-xs text-muted-foreground">{w.location}</span></span></label>)}{warehouseReady && !warehouses.filter(w => `${w.name} ${w.location}`.toLowerCase().includes(warehouseSearch.toLowerCase())).length && <p className="p-4 text-sm text-muted-foreground">No warehouses found.</p>}{draft.warehouseIds.filter(id => !warehouses.some(w => w.id === id)).map(id => <div key={id} className="flex items-center justify-between p-3 text-sm text-destructive">Unavailable warehouse<Button type="button" size="sm" variant="ghost" onClick={() => patch({ warehouseIds: draft.warehouseIds.filter(value => value !== id) })}>Remove selection</Button></div>)}</div></div>}
        </section>
      </div></fieldset></div><div className="shrink-0 space-y-3 border-t bg-background px-6 py-4">{formError && <p role="alert" className="flex gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{formError}</p>}<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{currentDelegation?.active === false ? 'Saving restores this user’s access.' : 'Changes apply when saved.'}</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={saving} onClick={closeEditor}>Cancel</Button><Button type="submit" disabled={saving || (selectedRole !== 'admin' && draft.warehouseAccess === 'selected' && (!warehouseReady || !draft.warehouseIds.length))}>{saving && <Loader2 className="size-4 animate-spin" />}{saving ? 'Saving…' : editor === 'new' ? 'Create user account' : currentDelegation?.active === false ? 'Restore access' : 'Save permissions'}</Button></div></div></div></form>
    </DialogContent></Dialog>
    <Dialog open={!!deactivate} onOpenChange={open => { if (!open && !saving) setDeactivate(null); }}><DialogContent><DialogHeader><DialogTitle>Deactivate access for {deactivate?.displayName || deactivate?.email}?</DialogTitle><DialogDescription>This removes access to operational modules. Their account and historical records stay intact. You can restore access from the Deactivated access filter.</DialogDescription></DialogHeader>{actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setDeactivate(null)}>Cancel</Button><Button variant="destructive" disabled={saving} onClick={revoke}>{saving ? 'Deactivating…' : 'Deactivate access'}</Button></div></DialogContent></Dialog>
    <Dialog open={discard} onOpenChange={setDiscard}><DialogContent><DialogHeader><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>Your permission changes have not been saved.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="destructive" onClick={() => { setDiscard(false); setEditor(null); setPassword(''); setDirty(false); }}>Discard changes</Button></div></DialogContent></Dialog>
  </div>;
}
