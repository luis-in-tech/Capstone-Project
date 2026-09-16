import React, { useState, useEffect } from 'react';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, serverTimestamp, getDocs, updateDoc } from '../lib/supabaseAdapter';
import { StaffDelegation, UserProfile } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { useAuth } from '../hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Shield, Plus, Trash2, ShieldAlert, Key, Pencil } from 'lucide-react';
import { toast } from 'sonner';

export function DelegationPanel() {
  const { profile } = useAuth();
  const [delegations, setDelegations] = useState<StaffDelegation[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [canAdjustInventory, setCanAdjustInventory] = useState(false);
  const [canAdjustPricelist, setCanAdjustPricelist] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<StaffDelegation | null>(null);
  const [editInventory, setEditInventory] = useState(false);
  const [editPricelist, setEditPricelist] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!profile || profile.role !== 'admin') return;

    const q = profile.role === 'admin'
      ? query(collection(db, 'delegations'))
      : query(collection(db, 'delegations'), where('agentId', '==', profile.uid));

    const unsub = onSnapshot(q, (snap) => {
      setDelegations(snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffDelegation)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'delegations');
    });

    return () => unsub();
  }, [profile]);

  const handleAddDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (!email.trim()) {
      setError('Please fill out this field.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      // Check if email is already delegated by this agent
      const existing = delegations.find(d => d.staffEmail.toLowerCase() === email.toLowerCase());
      if (existing) {
        setError('This email has already been delegated access.');
        setIsLoading(false);
        return;
      }

      await addDoc(collection(db, 'delegations'), {
        agentId: profile.uid,
        staffEmail: email.toLowerCase(),
        canAdjustInventory,
        canAdjustPricelist,
        createdAt: serverTimestamp()
      });

      toast.success('Delegation rights granted successfully.');
      setEmail('');
      setCanAdjustInventory(false);
      setCanAdjustPricelist(false);
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'delegations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'delegations', id));
      toast.success('Delegation rights revoked.');
    } catch (err) {
      handleSupabaseError(err, OperationType.DELETE, 'delegations');
    }
  };

  const openEdit = (d: StaffDelegation) => {
    setEditTarget(d);
    setEditInventory(d.canAdjustInventory);
    setEditPricelist(d.canAdjustPricelist);
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'delegations', editTarget.id), {
        canAdjustInventory: editInventory,
        canAdjustPricelist: editPricelist,
      });
      toast.success('Permissions updated successfully.');
      setEditTarget(null);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, 'delegations');
    } finally {
      setIsSaving(false);
    }
  };

  if (profile?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
        <ShieldAlert className="w-16 h-16 text-muted-foreground opacity-50" />
        <div>
          <h2 className="text-xl font-black uppercase tracking-tighter">Access Denied</h2>
          <p className="text-sm text-muted-foreground font-medium">Only authorized nodes can access the Staff Delegation panel.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest flex items-center gap-2">
          <Key className="w-3 h-3 text-primary" /> Manage access rights for your localized team members
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 border-border bg-card h-fit">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Grant Access
            </CardTitle>
            <CardDescription className="text-[10px] uppercase font-bold tracking-widest">
              Delegate specific module rights to staff.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddDelegation} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="staffEmail" className="text-[10px] font-black uppercase tracking-widest">Staff Email</Label>
                <Input
                  id="staffEmail"
                  type="email"
                  placeholder="staff@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  className={`font-medium ${error ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                />
                {error && <p className="text-[10px] text-red-500 font-bold mt-1">{error}</p>}
              </div>

              <div className="space-y-3 pt-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Permissions</Label>
                <div className="flex items-center space-x-2 bg-muted/50 p-3 rounded-lg border border-border">
                  <input
                    type="checkbox"
                    id="invAccess"
                    checked={canAdjustInventory}
                    onChange={(e) => setCanAdjustInventory(e.target.checked)}
                    className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4"
                  />
                  <Label htmlFor="invAccess" className="text-xs font-bold cursor-pointer">Can Adjust Inventory</Label>
                </div>
                <div className="flex items-center space-x-2 bg-muted/50 p-3 rounded-lg border border-border">
                  <input
                    type="checkbox"
                    id="priceAccess"
                    checked={canAdjustPricelist}
                    onChange={(e) => setCanAdjustPricelist(e.target.checked)}
                    className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4"
                  />
                  <Label htmlFor="priceAccess" className="text-xs font-bold cursor-pointer">Can Edit Pricelist</Label>
                </div>
              </div>

              <Button type="submit" disabled={isLoading} className="w-full font-black uppercase tracking-widest text-[10px] h-10 mt-4">
                <Plus className="w-3 h-3 mr-2" /> Add Delegation
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-widest">Active Delegations</CardTitle>
            <CardDescription className="text-[10px] uppercase font-bold tracking-widest">
              Staff members with elevated access. Click an email to edit permissions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest">Staff Email</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest">Inventory</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest">Pricelist</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delegations.map(d => (
                    <TableRow key={d.id}>
                      <TableCell
                        className="font-medium text-xs text-primary underline-offset-2 hover:underline cursor-pointer"
                        onClick={() => openEdit(d)}
                      >
                        {d.staffEmail}
                      </TableCell>
                      <TableCell>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${d.canAdjustInventory ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {d.canAdjustInventory ? 'Granted' : 'Denied'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${d.canAdjustPricelist ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                          {d.canAdjustPricelist ? 'Granted' : 'Denied'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(d)}
                            className="text-muted-foreground hover:text-foreground h-8 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Pencil className="w-3 h-3 mr-2" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(d.id)}
                            className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Trash2 className="w-3 h-3 mr-2" /> Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {delegations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-xs font-medium">
                        No active delegations found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" /> Edit Permissions
            </DialogTitle>
            <DialogDescription className="text-xs font-medium">
              Updating access rights for <span className="font-black text-foreground">{editTarget?.staffEmail}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Permissions</Label>
            <div className="flex items-center space-x-2 bg-muted/50 p-3 rounded-lg border border-border">
              <input
                type="checkbox"
                id="editInvAccess"
                checked={editInventory}
                onChange={(e) => setEditInventory(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4"
              />
              <Label htmlFor="editInvAccess" className="text-xs font-bold cursor-pointer">Can Adjust Inventory</Label>
            </div>
            <div className="flex items-center space-x-2 bg-muted/50 p-3 rounded-lg border border-border">
              <input
                type="checkbox"
                id="editPriceAccess"
                checked={editPricelist}
                onChange={(e) => setEditPricelist(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4"
              />
              <Label htmlFor="editPriceAccess" className="text-xs font-bold cursor-pointer">Can Edit Pricelist</Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditTarget(null)} className="font-black uppercase tracking-widest text-[10px]">
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSaving} className="font-black uppercase tracking-widest text-[10px]">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
