import React, { useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Download,
  AlertCircle,
  Package,
  Calendar,
  User,
  MapPin,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ITILIncident, UserProfile } from '../types';
import { resolveITILIncident, exportIncidentsCSV } from '../lib/itilService';
import { toast } from 'sonner';

interface ITILIncidentConsoleProps {
  open: boolean;
  onClose: () => void;
  incidents: ITILIncident[];
  onRefresh: () => void;
  profile?: UserProfile | null;
}

export function ITILIncidentConsole({
  open,
  onClose,
  incidents,
  onRefresh,
  profile,
}: ITILIncidentConsoleProps) {
  const [filter, setFilter] = useState<'all' | 'SLA_BREACH' | 'DEFECTIVE_ASSET' | 'active'>('all');
  const [selectedIncident, setSelectedIncident] = useState<ITILIncident | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filtered = incidents.filter((inc) => {
    if (filter === 'active') return inc.status !== 'RESOLVED' && inc.status !== 'CLOSED';
    if (filter === 'SLA_BREACH') return inc.incidentType === 'SLA_BREACH';
    if (filter === 'DEFECTIVE_ASSET') return inc.incidentType === 'DEFECTIVE_ASSET';
    return true;
  });

  const totalActive = incidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
  const totalBreaches = incidents.filter((i) => i.incidentType === 'SLA_BREACH' && i.status !== 'RESOLVED').length;
  const totalDefects = incidents.filter((i) => i.incidentType === 'DEFECTIVE_ASSET' && i.status !== 'RESOLVED').length;

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident) return;

    setIsSubmitting(true);
    try {
      const resolverName = profile?.displayName || profile?.email || 'Authorized Staff';
      await resolveITILIncident(
        selectedIncident.id,
        resolutionNotes.trim() || 'Remediated and verified under ITIL 4 protocol.',
        resolverName
      );
      toast.success(`Incident ${selectedIncident.ticketNumber} resolved.`);
      setSelectedIncident(null);
      setResolutionNotes('');
      onRefresh();
    } catch {
      toast.error('Failed to resolve incident.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSeverityBadge = (severity: ITILIncident['severity']) => {
    switch (severity) {
      case 'CRITICAL':
        return <Badge variant="destructive" className="text-[10px] font-black uppercase">Critical</Badge>;
      case 'HIGH':
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase">High</Badge>;
      case 'MEDIUM':
        return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[10px] font-bold uppercase">Medium</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] font-medium uppercase">Low</Badge>;
    }
  };

  const getStatusBadge = (status: ITILIncident['status']) => {
    switch (status) {
      case 'RESOLVED':
      case 'CLOSED':
        return <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 text-[10px] font-bold">Resolved</Badge>;
      case 'ESCALATED':
        return <Badge variant="outline" className="border-purple-300 text-purple-700 bg-purple-50 text-[10px] font-bold animate-pulse">Escalated</Badge>;
      default:
        return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-[10px] font-bold">Open</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pr-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400">
                <ShieldAlert className="size-6" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  ITIL 4 Incident Management Console
                  <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
                    FR-06 & FR-11
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Continuous SLA compliance tracking (7d Metro Manila / 14d Mindanao) & defective asset governance.
                </DialogDescription>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-semibold self-start sm:self-center"
              onClick={() => exportIncidentsCSV(incidents)}
              disabled={!incidents.length}
            >
              <Download className="size-3.5" />
              Export Incident Log (CSV)
            </Button>
          </div>
        </DialogHeader>

        {/* Telemetry Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2">
          <div className="p-3 rounded-xl border bg-card">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Incidents</p>
            <p className="text-xl font-black mt-1 text-red-600 dark:text-red-400">{totalActive}</p>
          </div>
          <div className="p-3 rounded-xl border bg-card">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">SLA Breaches</p>
            <p className="text-xl font-black mt-1 text-amber-600 dark:text-amber-400">{totalBreaches}</p>
          </div>
          <div className="p-3 rounded-xl border bg-card">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quarantined Assets</p>
            <p className="text-xl font-black mt-1 text-blue-600 dark:text-blue-400">{totalDefects}</p>
          </div>
          <div className="p-3 rounded-xl border bg-card">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Logged</p>
            <p className="text-xl font-black mt-1">{incidents.length}</p>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b pb-3">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'ghost'}
            className="text-xs h-7"
            onClick={() => setFilter('all')}
          >
            All Tickets ({incidents.length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'active' ? 'default' : 'ghost'}
            className="text-xs h-7"
            onClick={() => setFilter('active')}
          >
            Active Escalations ({totalActive})
          </Button>
          <Button
            size="sm"
            variant={filter === 'SLA_BREACH' ? 'default' : 'ghost'}
            className="text-xs h-7"
            onClick={() => setFilter('SLA_BREACH')}
          >
            SLA Breaches ({incidents.filter((i) => i.incidentType === 'SLA_BREACH').length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'DEFECTIVE_ASSET' ? 'default' : 'ghost'}
            className="text-xs h-7"
            onClick={() => setFilter('DEFECTIVE_ASSET')}
          >
            Defective Assets ({incidents.filter((i) => i.incidentType === 'DEFECTIVE_ASSET').length})
          </Button>
        </div>

        {/* Incident Table */}
        <div className="border rounded-xl overflow-hidden bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Ticket #</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Severity</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Order / Client</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">SLA Timeline</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inc) => (
                <TableRow key={inc.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs font-semibold">
                    {inc.ticketNumber}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-medium">
                      {inc.incidentType === 'SLA_BREACH' ? 'SLA Breach' : 'Defective CI'}
                    </span>
                  </TableCell>
                  <TableCell>{getSeverityBadge(inc.severity)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">{inc.orderNumber || 'General Stock'}</span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                        {inc.clientName || inc.deliveryLocation}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {inc.daysOverdue !== undefined ? (
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">
                        {inc.daysOverdue}d Overdue
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Logged at check</span>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(inc.status)}</TableCell>
                  <TableCell className="text-right">
                    {inc.status !== 'RESOLVED' && inc.status !== 'CLOSED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                        onClick={() => {
                          setSelectedIncident(inc);
                          setResolutionNotes('');
                        }}
                      >
                        <Check className="size-3.5 mr-1" />
                        Resolve
                      </Button>
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground italic">
                        Resolved
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs italic">
                    No ITIL incident tickets match this filter. All SLA timelines compliant.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Resolution Dialog */}
        {selectedIncident && (
          <Dialog open={!!selectedIncident} onOpenChange={() => setSelectedIncident(null)}>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleResolve}>
                <DialogHeader>
                  <DialogTitle className="text-base font-bold">
                    Resolve Incident {selectedIncident.ticketNumber}
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Log formal resolution notes into the immutable ITIL audit trail.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4 text-xs">
                  <div className="p-3 rounded-lg bg-muted space-y-1">
                    <p className="font-semibold text-foreground">Incident Summary:</p>
                    <p className="text-muted-foreground">{selectedIncident.description}</p>
                    {selectedIncident.daysOverdue && (
                      <p className="text-red-600 font-bold">Delay: {selectedIncident.daysOverdue} day(s) overdue</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="resolution-input" className="text-xs font-semibold">
                      Corrective Action / Resolution Notes *
                    </Label>
                    <Input
                      id="resolution-input"
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="e.g., Courier expedited, client notified, stock replaced."
                      required
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs"
                    onClick={() => setSelectedIncident(null)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                    disabled={isSubmitting || !resolutionNotes.trim()}
                  >
                    Confirm Resolution
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
