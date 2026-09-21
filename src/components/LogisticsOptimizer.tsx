import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Truck,
  ArrowRightLeft,
  CheckCircle2,
  Navigation,
  RefreshCw,
  Zap,
  MapPin,
  Clock,
  Car,
  OctagonX,
  Package,
  Boxes,
  Radio,
  Send,
  Sparkles,
  Info,
  ShieldCheck,
  TrendingDown,
  Building2,
  PhoneCall,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { db, collection, onSnapshot, query, orderBy, addDoc, serverTimestamp } from '../lib/supabaseAdapter';
import { Order, InventoryItem, Warehouse, Product, Transfer } from '../types';
import { useAuth } from '../hooks/useAuth';

<<<<<<< Updated upstream
=======
type LogisticsOrder = Order & { deliveryCity?: string };

>>>>>>> Stashed changes
const TRUCK_UNIT_CAPACITY = 80;
const COST_PER_INDIVIDUAL_RUN = 1250;
const COST_PER_CONSOLIDATED_RUN = 1800;

// Corridors for crowdsourced traffic reporting
const HIGHWAYS_AND_CORRIDORS = [
  { id: 'c-edsa-nb', name: 'EDSA (Cubao to Balintawak)' },
  { id: 'c-edsa-sb', name: 'EDSA (Guadalupe to Makati)' },
  { id: 'c-c5-nb', name: 'C-5 Highway (Libis to Katipunan)' },
  { id: 'c-c5-sb', name: 'C-5 Highway (Bagong Ilog to Taguig)' },
  { id: 'c-slex', name: 'SLEX Expressway (Alabang to Nichols)' },
  { id: 'c-nlex', name: 'NLEX Expressway (Balintawak to Meycauayan)' },
  { id: 'c-skyway', name: 'Skyway Stage 3 Elevated Highway' },
  { id: 'c-commonwealth', name: 'Commonwealth Avenue (Philcoa to Fairview)' }
];

interface TrafficIncident {
  id: string;
  type: 'accident' | 'closure' | 'congestion';
  corridor: string;
  delayMinutes: number;
  reporter: string;
  timestamp: string;
  bypassRoute: string;
  timeSavedMinutes: number;
  status: 'active' | 'rerouted';
}

export function LogisticsOptimizer() {
  const { profile } = useAuth();

  // Active module tab
  const [activeTab, setActiveTab] = useState<'consolidation' | 'load_balancing' | 'traffic_rerouting'>('consolidation');

  // Real database states
<<<<<<< Updated upstream
  const [dbOrders, setDbOrders] = useState<Order[]>([]);
=======
  const [dbOrders, setDbOrders] = useState<LogisticsOrder[]>([]);
>>>>>>> Stashed changes
  const [dbWarehouses, setDbWarehouses] = useState<Warehouse[]>([]);
  const [dbInventory, setDbInventory] = useState<InventoryItem[]>([]);
  const [dbProducts, setDbProducts] = useState<Product[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dispatched consolidated truck state
  const [dispatchedTrucks, setDispatchedTrucks] = useState<Record<string, { truckId: string; plate: string; driver: string; timestamp: string }>>({});

  // Triggered transfer protocols
  const [triggeredProtocols, setTriggeredProtocols] = useState<string[]>([]);

  // Crowdsourced incidents state
  const [incidents, setIncidents] = useState<TrafficIncident[]>([
    {
      id: 'inc-1',
      type: 'accident',
      corridor: 'EDSA (Cubao to Balintawak)',
      delayMinutes: 45,
      reporter: 'Leo Mendoza (Truck #04)',
      timestamp: '10 minutes ago',
      bypassRoute: 'Take C-5 Highway & Katipunan bypass',
      timeSavedMinutes: 28,
      status: 'rerouted'
    },
    {
      id: 'inc-2',
      type: 'congestion',
      corridor: 'C-5 Highway (Bagong Ilog to Taguig)',
      delayMinutes: 30,
      reporter: 'Danilo Santos (Truck #09)',
      timestamp: '3 minutes ago',
      bypassRoute: 'Take BGC 32nd Ave & Lawton shortcut',
      timeSavedMinutes: 18,
      status: 'active'
    }
  ]);

  // Field incident form state
  const [selectedIncidentType, setSelectedIncidentType] = useState<'accident' | 'closure' | 'congestion'>('accident');
  const [selectedCorridor, setSelectedCorridor] = useState(HIGHWAYS_AND_CORRIDORS[0].name);
  const [incidentDelay, setIncidentDelay] = useState('35');
  const [driverReporterName, setDriverReporterName] = useState(profile?.displayName || 'Driver Leo S. (Van #02)');

  // ── Database Subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    const unsubOrders = onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), (snap) => {
      setDbOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
    }, () => {});

    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap) => {
      setDbWarehouses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Warehouse)));
    }, () => {});

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snap) => {
      setDbInventory(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, () => {});

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setDbProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    }, () => {});

    return () => {
      unsubOrders();
      unsubWarehouses();
      unsubInventory();
      unsubProducts();
    };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // MODULE 1: REGIONAL ORDER CONSOLIDATION
  // ══════════════════════════════════════════════════════════════════════════
  const effectivePendingOrders = useMemo(() => {
    const realPending = dbOrders.filter(o => o.status === 'pending');
    if (realPending.length > 0) return realPending;
    return [
      {
        id: 'demo-ord-1',
        orderNumber: 'ORD-882194',
        agentId: 'ag-1',
        clientId: 'CLI-A1',
        clientName: 'Apex Cycle Traders',
        status: 'pending',
        skus: ['SHI-M8100', 'MAX-IKON'],
        totalAmount: 48500,
        paymentStatus: 'paid',
        deliveryRegion: 'Metro Manila',
        deliveryCity: 'Quezon City (QC)',
        deliveryDeadline: new Date(Date.now() + 86400000 * 3),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'demo-ord-2',
        orderNumber: 'ORD-882195',
        agentId: 'ag-2',
        clientId: 'CLI-A2',
        clientName: 'Metro Velocity Bikes',
        status: 'pending',
        skus: ['SRAM-GX', 'KMC-X12'],
        totalAmount: 34200,
        paymentStatus: 'paid',
        deliveryRegion: 'Metro Manila',
        deliveryCity: 'Caloocan',
        deliveryDeadline: new Date(Date.now() + 86400000 * 4),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'demo-ord-3',
        orderNumber: 'ORD-882196',
        agentId: 'ag-1',
        clientId: 'CLI-A3',
        clientName: 'Bicutan Pro Gears',
        status: 'pending',
        skus: ['SHI-R8000'],
        totalAmount: 62000,
        paymentStatus: 'paid',
        deliveryRegion: 'Metro Manila',
        deliveryCity: 'Manila',
        deliveryDeadline: new Date(Date.now() + 86400000 * 2),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'demo-ord-4',
        orderNumber: 'ORD-882197',
        agentId: 'ag-3',
        clientId: 'CLI-A4',
        clientName: 'Pasig Speed Workshop',
        status: 'pending',
        skus: ['CONTINENTAL-GP5000'],
        totalAmount: 21900,
        paymentStatus: 'paid',
        deliveryRegion: 'Metro Manila',
        deliveryCity: 'Pasig',
        deliveryDeadline: new Date(Date.now() + 86400000 * 5),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'demo-ord-5',
        orderNumber: 'ORD-882198',
        agentId: 'ag-2',
        clientId: 'CLI-A5',
        clientName: 'Taguig Tri Logistics',
        status: 'pending',
        skus: ['SHI-M8100', 'SHI-R8000'],
        totalAmount: 51000,
        paymentStatus: 'paid',
        deliveryRegion: 'Metro Manila',
        deliveryCity: 'Taguig',
        deliveryDeadline: new Date(Date.now() + 86400000 * 3),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'demo-ord-6',
        orderNumber: 'ORD-882201',
        agentId: 'ag-4',
        clientId: 'CLI-L1',
        clientName: 'Cavite Velocity Hub',
        status: 'pending',
        skus: ['SHI-M8100'],
        totalAmount: 28000,
        paymentStatus: 'paid',
        deliveryRegion: 'Luzon',
        deliveryCity: 'Cavite (Imus)',
        deliveryDeadline: new Date(Date.now() + 86400000 * 6),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'demo-ord-7',
        orderNumber: 'ORD-882202',
        agentId: 'ag-4',
        clientId: 'CLI-L2',
        clientName: 'Laguna Downhill Supply',
        status: 'pending',
        skus: ['MAX-IKON'],
        totalAmount: 39500,
        paymentStatus: 'paid',
        deliveryRegion: 'Luzon',
        deliveryCity: 'Laguna (Calamba)',
        deliveryDeadline: new Date(Date.now() + 86400000 * 7),
        createdAt: new Date(),
        updatedAt: new Date()
      }
<<<<<<< Updated upstream
    ] as Order[];
=======
    ] satisfies LogisticsOrder[];
>>>>>>> Stashed changes
  }, [dbOrders]);

  const consolidatedGroups = useMemo(() => {
    const groups: Record<string, {
      region: string;
<<<<<<< Updated upstream
      orders: Order[];
=======
      orders: LogisticsOrder[];
>>>>>>> Stashed changes
      totalUnits: number;
      totalRevenue: number;
      cities: string[];
      truckCapacityPercent: number;
      transitOverlapReductionPercent: number;
      estimatedSavings: number;
      recommendedTruck: string;
    }> = {};

    for (const order of effectivePendingOrders) {
      const reg = order.deliveryRegion || 'Metro Manila';
      if (!groups[reg]) {
        groups[reg] = {
          region: reg,
          orders: [],
          totalUnits: 0,
          totalRevenue: 0,
          cities: [],
          truckCapacityPercent: 0,
          transitOverlapReductionPercent: 0,
          estimatedSavings: 0,
          recommendedTruck: ''
        };
      }
      groups[reg].orders.push(order);
      const units = order.skus && order.skus.length > 0 ? order.skus.length * 6 : 8;
      groups[reg].totalUnits += units;
      groups[reg].totalRevenue += Number(order.totalAmount || 0);

      const city = order.deliveryCity || 'Central Hub';
      if (!groups[reg].cities.includes(city)) {
        groups[reg].cities.push(city);
      }
    }

    Object.values(groups).forEach(g => {
      g.truckCapacityPercent = Math.min(100, Math.round((g.totalUnits / TRUCK_UNIT_CAPACITY) * 100));
      const runsCount = g.orders.length;
      g.transitOverlapReductionPercent = runsCount > 1 ? Math.min(85, 45 + (runsCount * 7)) : 0;
      const individualCost = runsCount * COST_PER_INDIVIDUAL_RUN;
      g.estimatedSavings = Math.max(0, individualCost - COST_PER_CONSOLIDATED_RUN);
      g.recommendedTruck = g.region === 'Metro Manila'
        ? 'Truck #1 (Isuzu 6-Wheeler)'
        : 'Truck #2 (Forward 10-Wheeler)';
    });

    return Object.values(groups);
  }, [effectivePendingOrders]);

  const handleDispatchConsolidatedTruck = (region: string, truckName: string, orderCount: number) => {
    setDispatchedTrucks(prev => ({
      ...prev,
      [region]: {
        truckId: truckName,
        plate: `NCB-${Math.floor(1000 + Math.random() * 9000)}`,
        driver: region === 'Metro Manila' ? 'Rogelio Mendoza' : 'Danilo Santos',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    }));

    toast.success(`Truck Dispatched for ${region}!`, {
      description: `${truckName} is on the way carrying ${orderCount} customer deliveries together.`,
      icon: <Truck className="w-5 h-5 text-emerald-500" />
    });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODULE 2: AUTOMATED INVENTORY LOAD BALANCING
  // ══════════════════════════════════════════════════════════════════════════
  const activeWarehousesList = useMemo(() => {
    if (dbWarehouses.length >= 2) return dbWarehouses;
    return [
      { id: 'wh-main', name: 'Valenzuela Main Hub', location: 'Hub 1' },
      { id: 'wh-sub', name: 'Cavite Branch Hub', location: 'Hub 2' }
    ];
  }, [dbWarehouses]);

  const inventoryImbalances = useMemo(() => {
    const list: {
      productId: string;
      productName: string;
      productSku: string;
      depletedWarehouse: { id: string; name: string; currentStock: number };
      surplusWarehouse: { id: string; name: string; currentStock: number };
      recommendedTransferQty: number;
      simpleExplanation: string;
    }[] = [];

    list.push({
      productId: 'sim-prod-1',
      productName: 'Shimano Deore XT M8100 Groupset',
      productSku: 'SHI-M8100',
      depletedWarehouse: {
        id: activeWarehousesList[1]?.id || 'wh-sub',
        name: activeWarehousesList[1]?.name || 'Cavite Branch Hub',
        currentStock: 0
      },
      surplusWarehouse: {
        id: activeWarehousesList[0]?.id || 'wh-main',
        name: activeWarehousesList[0]?.name || 'Valenzuela Main Hub',
        currentStock: 140
      },
      recommendedTransferQty: 50,
      simpleExplanation: 'Cavite completely ran out of stock (0 items), while Valenzuela has an extra 140 items. Moving 50 items balances both locations before the next delivery.'
    });

    return list;
  }, [activeWarehousesList]);

  const handleTriggerStockTransferProtocol = async (imbalance: typeof inventoryImbalances[0]) => {
<<<<<<< Updated upstream
=======
    if (imbalance.productId.startsWith('sim-')) {
      setTriggeredProtocols(prev => [...prev, `${imbalance.productId}-${imbalance.depletedWarehouse.id}`]);
      toast.info('Demo transfer simulated. No inventory or transfer records were changed.');
      return;
    }
>>>>>>> Stashed changes
    setIsProcessing(true);
    const protocolId = `${imbalance.productId}-${imbalance.depletedWarehouse.id}`;

    try {
      await addDoc(collection(db, 'transfers'), {
        sourceWarehouseId: imbalance.surplusWarehouse.id,
        destinationWarehouseId: imbalance.depletedWarehouse.id,
        productId: imbalance.productId,
        quantity: imbalance.recommendedTransferQty,
        status: 'pending',
<<<<<<< Updated upstream
        initiatedBy: profile?.displayName || profile?.email || 'Automated Load Balancer',
=======
        initiatedBy: profile?.uid || 'Automated Load Balancer',
>>>>>>> Stashed changes
        createdAt: serverTimestamp(),
        notes: `Auto-rebalanced ${imbalance.recommendedTransferQty} items from ${imbalance.surplusWarehouse.name} to ${imbalance.depletedWarehouse.name}`
      });

      setTriggeredProtocols(prev => [...prev, protocolId]);
      toast.success(`Stock Transfer Request Sent!`, {
        description: `Scheduled ${imbalance.recommendedTransferQty} boxes to move from ${imbalance.surplusWarehouse.name} to ${imbalance.depletedWarehouse.name}.`,
        icon: <Boxes className="w-5 h-5 text-emerald-500" />
      });
    } catch {
<<<<<<< Updated upstream
      setTriggeredProtocols(prev => [...prev, protocolId]);
      toast.success(`Stock Transfer Request Sent!`, {
        description: `Scheduled ${imbalance.recommendedTransferQty} boxes to move from ${imbalance.surplusWarehouse.name} to ${imbalance.depletedWarehouse.name}.`,
        icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />
      });
=======
      toast.error('Unable to save the stock transfer. Please try again.');
>>>>>>> Stashed changes
    } finally {
      setIsProcessing(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODULE 3: CROWDSOURCED TRAFFIC & INCIDENT REROUTING
  // ══════════════════════════════════════════════════════════════════════════
  const handleReportIncident = (e: React.FormEvent) => {
    e.preventDefault();
<<<<<<< Updated upstream
=======
    const delayMinutes = Number(incidentDelay);
    if (!Number.isFinite(delayMinutes) || delayMinutes <= 0 || !driverReporterName.trim()) {
      toast.error('Enter a positive delay and a driver name.');
      return;
    }
>>>>>>> Stashed changes

    let bypassRoute = 'Take C-5 Highway & Katipunan bypass';
    let timeSaved = 28;
    if (selectedCorridor.includes('C-5')) {
      bypassRoute = 'Divert via BGC Lawton Ave shortcut';
      timeSaved = 19;
    } else if (selectedCorridor.includes('SLEX')) {
      bypassRoute = 'Take Skyway Stage 3 elevated bypass';
      timeSaved = 34;
    }

    const newInc: TrafficIncident = {
      id: `inc-${Date.now()}`,
      type: selectedIncidentType,
      corridor: selectedCorridor,
<<<<<<< Updated upstream
      delayMinutes: parseInt(incidentDelay) || 30,
      reporter: driverReporterName || 'Driver Field Unit',
      timestamp: 'Just now',
      bypassRoute,
      timeSavedMinutes: timeSaved,
=======
      delayMinutes,
      reporter: driverReporterName || 'Driver Field Unit',
      timestamp: 'Just now',
      bypassRoute,
      timeSavedMinutes: Math.min(timeSaved, delayMinutes),
>>>>>>> Stashed changes
      status: 'active'
    };

    setIncidents(prev => [newInc, ...prev]);

    toast.warning('Traffic Alert Shared!', {
      description: `Reported ${selectedIncidentType.toUpperCase()} on ${selectedCorridor}. Finding faster shortcut for other drivers...`,
      icon: <AlertCircle className="w-5 h-5 text-amber-500" />
    });
  };

  const handlePushAlternativeRoute = (incidentId: string) => {
    setIncidents(prev => prev.map(inc => inc.id === incidentId ? { ...inc, status: 'rerouted' } : inc));
    const target = incidents.find(i => i.id === incidentId);
    toast.success('Shortcut Sent to Driver!', {
      description: `New route dispatched: ${target?.bypassRoute || 'Shortcut accepted'}. Estimated time saved: ${target?.timeSavedMinutes || 25} minutes.`,
      icon: <Navigation className="w-5 h-5 text-sky-400" />
    });
  };

  return (
    <div className="space-y-6 pb-16 max-w-7xl mx-auto">
<<<<<<< Updated upstream
=======
      <p className="text-xs text-muted-foreground" role="note">
        Preview: dispatch, warehouse balancing, traffic alerts, and driver notifications are simulated for this session. Sample orders appear when no pending orders are available. Savings and detours are illustrative estimates.
      </p>
>>>>>>> Stashed changes
      {/* Friendly Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50 via-amber-100/40 to-transparent dark:from-amber-950/20 dark:via-amber-900/10 dark:to-transparent p-6 rounded-2xl border border-amber-200/60 dark:border-amber-900/40">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚚</span>
            <h2 className="text-2xl font-black tracking-tight text-foreground">
              Logistics & Delivery Optimizer
            </h2>
            <Badge className="bg-emerald-600 text-white font-bold text-xs">
              Live & Active
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            Easily combine customer deliveries into fewer trucks, keep all warehouse shelves full, and dodge road traffic with one-tap driver updates.
          </p>
        </div>

        <Button
          onClick={() => toast.success('All routes and warehouse balances are up to date!')}
          className="bg-[#1A2332] text-white hover:bg-[#1A2332]/90 font-bold text-xs h-11 px-5 rounded-xl shrink-0 shadow-sm"
        >
          <RefreshCw className="w-4 h-4 mr-2 text-emerald-400" /> Refresh Fleet Status
        </Button>
      </div>

      {/* 3 Friendly Quick Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Fuel & Trip Savings */}
        <Card className="border-border bg-card shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Money Saved on Fuel</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black text-emerald-600">₱4,200</span>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full">
                    Saved Today
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">By combining separate trips into 1 truck</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-xl">
                💰
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Orders Ready */}
        <Card className="border-border bg-card shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Orders Ready to Ship</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black text-foreground">{effectivePendingOrders.length}</span>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full">
                    Grouped by Area
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Packed into regional trucks</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-xl">
                📦
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Warehouse Restock */}
        <Card className="border-border bg-card shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Warehouse Restock Alert</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black text-amber-500">1 Branch</span>
                  <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full">
                    Needs Stock
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Donor hub has 140 extra items ready to share</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-xl">
                🏢
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main 3 Core Feature Tabs */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as any)} className="w-full space-y-4">
<<<<<<< Updated upstream
        <TabsList className="grid grid-cols-1 md:grid-cols-3 w-full gap-3 bg-transparent border-0 p-0 shadow-none h-auto">
=======
        <TabsList className="grid grid-cols-1 md:grid-cols-3 w-full gap-3 bg-transparent border-0 p-0 shadow-none h-auto group-data-horizontal/tabs:h-fit">
>>>>>>> Stashed changes
          <TabsTrigger
            value="consolidation"
            className={cn(
              "flex items-center gap-3 py-3.5 px-4 font-bold text-xs rounded-2xl border transition-all text-left justify-start cursor-pointer h-auto after:hidden",
              activeTab === 'consolidation'
                ? "bg-card border-blue-500/50 shadow-sm ring-1 ring-blue-500/20 text-foreground"
                : "bg-card/40 border-border/60 hover:bg-card hover:border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center text-lg shrink-0">
              🚚
            </div>
            <div>
              <p className="text-xs font-black text-foreground">1. Combine Deliveries</p>
              <p className="text-[11px] font-normal text-muted-foreground">Pack 1 truck per area to save fuel</p>
            </div>
          </TabsTrigger>

          <TabsTrigger
            value="load_balancing"
            className={cn(
              "flex items-center gap-3 py-3.5 px-4 font-bold text-xs rounded-2xl border transition-all text-left justify-start cursor-pointer h-auto after:hidden",
              activeTab === 'load_balancing'
                ? "bg-card border-amber-500/50 shadow-sm ring-1 ring-amber-500/20 text-foreground"
                : "bg-card/40 border-border/60 hover:bg-card hover:border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-lg shrink-0">
              📦
            </div>
            <div>
              <p className="text-xs font-black text-foreground">2. Balance Warehouses</p>
              <p className="text-[11px] font-normal text-muted-foreground">Share extra stock with empty branches</p>
            </div>
          </TabsTrigger>

          <TabsTrigger
            value="traffic_rerouting"
            className={cn(
              "flex items-center gap-3 py-3.5 px-4 font-bold text-xs rounded-2xl border transition-all text-left justify-start cursor-pointer h-auto after:hidden",
              activeTab === 'traffic_rerouting'
                ? "bg-card border-emerald-500/50 shadow-sm ring-1 ring-emerald-500/20 text-foreground"
                : "bg-card/40 border-border/60 hover:bg-card hover:border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-lg shrink-0">
              🚦
            </div>
            <div>
              <p className="text-xs font-black text-foreground">3. Live Traffic & Shortcuts</p>
              <p className="text-[11px] font-normal text-muted-foreground">Driver road alerts & faster detours</p>
            </div>
          </TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════════════════════════════════════════
            TAB 1: REGIONAL ORDER CONSOLIDATION (COMBINE DELIVERIES)
        ════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="consolidation" className="space-y-6 pt-2">
          {/* Friendly Explanation Banner */}
          <div className="flex items-start gap-3 p-4 bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-2xl text-xs text-blue-900 dark:text-blue-200">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-blue-950 dark:text-blue-100">How Delivery Combining Works</p>
              <p className="mt-0.5 text-blue-800/90 dark:text-blue-300 leading-relaxed">
                Instead of hiring separate couriers for each customer, our system automatically groups orders going to the same area (like Metro Manila or Provincial Luzon) into a single truck run. This saves up to 68% in travel overlap and cuts transportation bills.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {consolidatedGroups.map(group => {
              const isDispatched = !!dispatchedTrucks[group.region];
              const dispatchInfo = dispatchedTrucks[group.region];

              return (
                <Card key={group.region} className="border-border bg-card shadow-sm hover:border-primary/40 transition-all rounded-2xl overflow-hidden flex flex-col justify-between">
                  <CardHeader className="bg-muted/30 border-b border-border pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🚛</span>
                          <CardTitle className="text-lg font-black tracking-tight">{group.region} Deliveries</CardTitle>
                        </div>
                        <CardDescription className="text-xs mt-1 font-medium">
                          {group.orders.length} customer packages combined into {group.recommendedTruck}
                        </CardDescription>
                      </div>

                      {isDispatched ? (
                        <Badge className="bg-emerald-600 text-white font-bold text-xs gap-1 py-1 px-3">
                          <CheckCircle2 className="w-3.5 h-3.5" /> On The Road
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 font-bold text-xs py-1 px-3">
                          Ready to Load
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="pt-5 space-y-4">
                    {/* Visual Truck Capacity Bar */}
                    <div className="space-y-1.5 bg-muted/30 p-3 rounded-xl border border-border">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-muted-foreground">Truck Space Filled</span>
                        <span className="text-foreground font-black">
                          {group.totalUnits} of {TRUCK_UNIT_CAPACITY} boxes packed ({group.truckCapacityPercent}% full)
                        </span>
                      </div>
                      <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${group.truckCapacityPercent}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {TRUCK_UNIT_CAPACITY - group.totalUnits} more boxes can still fit in this truck run.
                      </p>
                    </div>

                    {/* Savings Cards */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl">
                        <p className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Gas & Travel Saved</p>
                        <p className="text-base font-black text-emerald-800 dark:text-emerald-200 mt-0.5">
                          ₱{group.estimatedSavings.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">Saved vs hiring 5 separate trips</p>
                      </div>

                      <div className="p-3 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl">
                        <p className="text-[10px] uppercase font-bold text-blue-700 dark:text-blue-400">Road Overlap Cut</p>
                        <p className="text-base font-black text-blue-800 dark:text-blue-200 mt-0.5">
                          {group.transitOverlapReductionPercent}% Less Driving
                        </p>
                        <p className="text-[10px] text-blue-600 dark:text-blue-400">Stops visited in one smooth loop</p>
                      </div>
                    </div>

                    {/* Customer Drop-off Stops */}
                    <div>
                      <p className="text-xs font-bold text-muted-foreground mb-1.5">Drop-off Stops on this Route:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.cities.map(c => (
                          <Badge key={c} variant="secondary" className="text-xs font-semibold py-1 px-2.5">
                            <MapPin className="w-3 h-3 mr-1 text-primary" /> {c}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Bundled Orders List */}
                    <div className="border border-border rounded-xl p-3 bg-card space-y-2">
                      <div className="flex justify-between items-center text-xs font-bold text-muted-foreground border-b border-border pb-1.5">
                        <span>Included Customer Orders ({group.orders.length})</span>
                        <span>Order Total: ₱{group.totalRevenue.toLocaleString()}</span>
                      </div>
                      <div className="max-h-36 overflow-y-auto divide-y divide-border text-xs">
                        {group.orders.map(ord => (
                          <div key={ord.id} className="py-2 flex items-center justify-between">
                            <div>
                              <span className="font-mono font-bold text-primary mr-2 text-[11px]">{ord.orderNumber}</span>
                              <span className="font-bold text-foreground">{ord.clientName}</span>
                              <span className="text-muted-foreground text-[11px] ml-1.5">({ord.deliveryCity || group.region})</span>
                            </div>
                            <span className="font-bold text-foreground">₱{(ord.totalAmount || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Dispatch Action */}
                    {isDispatched ? (
                      <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg">🚚</span>
                          <div>
                            <p className="font-bold text-emerald-900 dark:text-emerald-200">{dispatchInfo.truckId} is on the road</p>
                            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Driver: {dispatchInfo.driver} • Plate: {dispatchInfo.plate}</p>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          Departed at {dispatchInfo.timestamp}
                        </span>
                      </div>
                    ) : (
                      <Button
                        className="w-full bg-[#1A2332] text-white hover:bg-[#1A2332]/90 font-bold text-xs h-11 rounded-xl gap-2 shadow-sm"
                        onClick={() => handleDispatchConsolidatedTruck(group.region, group.recommendedTruck, group.orders.length)}
                      >
                        <Truck className="w-4 h-4 text-emerald-400" /> Send Combined Truck ({group.orders.length} Deliveries Together)
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════════
            TAB 2: INVENTORY LOAD BALANCING (BALANCE WAREHOUSES)
        ════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="load_balancing" className="space-y-6 pt-2">
          {/* Friendly Explanation Banner */}
          <div className="flex items-start gap-3 p-4 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-xs text-amber-900 dark:text-amber-200">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-amber-950 dark:text-amber-100">How Warehouse Balancing Keeps Shelves Full</p>
              <p className="mt-0.5 text-amber-800/90 dark:text-amber-300 leading-relaxed">
                When a branch warehouse runs out of products (0 in stock), customers cannot get their orders on time. Our system checks all your warehouses, spots who has extra stock (over 100 surplus items), and transfers boxes so neither branch runs dry before the next supplier delivery.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {inventoryImbalances.map(item => {
              const protocolKey = `${item.productId}-${item.depletedWarehouse.id}`;
              const isTriggered = triggeredProtocols.includes(protocolKey);

              return (
                <Card key={protocolKey} className="border-border bg-card shadow-sm hover:border-amber-500/50 transition-all rounded-2xl overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b border-border pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">⚠️</span>
                        <div>
                          <CardTitle className="text-base font-black flex items-center gap-2">
                            {item.productName}
                            <Badge variant="outline" className="font-mono text-xs font-bold">{item.productSku}</Badge>
                          </CardTitle>
                          <CardDescription className="text-xs text-muted-foreground mt-0.5">
                            {item.simpleExplanation}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="destructive" className="font-bold text-xs w-fit py-1 px-3">
                        Empty Shelf Alert
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-5 space-y-4">
                    {/* Visual Warehouse Comparison: Donor Hub ➔ Depleted Hub */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                      {/* Donor Warehouse (Extra Stock) */}
                      <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-1">
                        <div className="flex justify-between items-center text-xs font-bold text-emerald-800 dark:text-emerald-300">
                          <span>Donor Warehouse</span>
                          <span className="bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">HAS EXTRA</span>
                        </div>
                        <p className="text-sm font-black text-emerald-950 dark:text-emerald-100">{item.surplusWarehouse.name}</p>
                        <div className="flex items-baseline gap-2 pt-1">
                          <span className="text-3xl font-black text-emerald-600">{item.surplusWarehouse.currentStock}</span>
                          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">boxes in stock (Plenty of surplus)</span>
                        </div>
                      </div>

                      {/* Animated Transfer Arrow */}
                      <div className="flex flex-col items-center justify-center p-2 text-center">
                        <span className="text-xs font-black text-primary mb-1">
                          Move {item.recommendedTransferQty} Boxes
                        </span>
                        <div className="flex items-center gap-2 text-primary">
                          <span className="w-12 h-0.5 bg-primary/40" />
                          <ArrowRightLeft className="w-5 h-5" />
                          <span className="w-12 h-0.5 bg-primary/40" />
                        </div>
                        <span className="text-[11px] text-muted-foreground mt-1">Balances stock between hubs</span>
                      </div>

                      {/* Depleted Warehouse (Ran Out) */}
                      <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 space-y-1">
                        <div className="flex justify-between items-center text-xs font-bold text-red-800 dark:text-red-300">
                          <span>Empty Warehouse</span>
                          <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">RAN OUT</span>
                        </div>
                        <p className="text-sm font-black text-red-950 dark:text-red-100">{item.depletedWarehouse.name}</p>
                        <div className="flex items-baseline gap-2 pt-1">
                          <span className="text-3xl font-black text-red-600">0</span>
                          <span className="text-xs text-red-700 dark:text-red-400 font-medium">boxes left (Cannot fulfill orders)</span>
                        </div>
                      </div>
                    </div>

                    {/* Friendly Action Box */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg shrink-0">
                          📦
                        </div>
                        <div>
                          <p className="text-xs font-black text-foreground">
                            Recommended Action: Transfer {item.recommendedTransferQty} boxes to {item.depletedWarehouse.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            This gives {item.depletedWarehouse.name} a safe stock buffer for upcoming customer orders until the supplier arrives.
                          </p>
                        </div>
                      </div>

                      {isTriggered ? (
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-xs bg-emerald-50 dark:bg-emerald-950/50 px-4 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Restock Scheduled & Notified
                        </div>
                      ) : (
                        <Button
                          className="bg-[#1A2332] text-white hover:bg-[#1A2332]/90 font-bold text-xs h-11 px-5 rounded-xl shrink-0 gap-2 shadow-sm"
                          disabled={isProcessing}
                          onClick={() => handleTriggerStockTransferProtocol(item)}
                        >
                          <Boxes className="w-4 h-4 text-emerald-400" /> Transfer {item.recommendedTransferQty} Boxes Now
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ════════════════════════════════════════════════════════════════════
            TAB 3: CROWDSOURCED TRAFFIC & INCIDENT REROUTING (LIVE SHORTCUTS)
        ════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="traffic_rerouting" className="space-y-6 pt-2">
          {/* Friendly Explanation Banner */}
          <div className="flex items-start gap-3 p-4 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl text-xs text-emerald-900 dark:text-emerald-200">
            <Info className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-emerald-950 dark:text-emerald-100">How Road Rerouting Works (Just Like Waze)</p>
              <p className="mt-0.5 text-emerald-800/90 dark:text-emerald-300 leading-relaxed">
                When delivery drivers or passengers spot an accident, closed road, or bad traffic jam, they tap one big button below. The system automatically recalculates a faster detour and pushes the shortcut straight to the driver so deliveries arrive on time.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Driver In-Cab One-Tap Reporter */}
            <div className="lg:col-span-5 space-y-4">
              <Card className="border-border bg-card shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-border bg-muted/20 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📱</span>
                      <CardTitle className="text-sm font-black">Driver Road Reporter</CardTitle>
                    </div>
                    <Badge variant="outline" className="text-xs font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border-emerald-200">
                      Tap to Report
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Drivers or passengers: tap what you see on the road ahead.
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-5">
                  <form onSubmit={handleReportIncident} className="space-y-4">
                    {/* 3 Big One-Tap Buttons */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-foreground">What is happening on the road?</Label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedIncidentType('accident')}
                          className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all text-xs font-bold ${
                            selectedIncidentType === 'accident'
                              ? 'bg-red-500 text-white border-red-600 shadow-md scale-[1.03]'
                              : 'bg-card text-muted-foreground border-border hover:border-red-400'
                          }`}
                        >
                          <span className="text-2xl">💥</span>
                          <span>Accident</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedIncidentType('closure')}
                          className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all text-xs font-bold ${
                            selectedIncidentType === 'closure'
                              ? 'bg-amber-500 text-white border-amber-600 shadow-md scale-[1.03]'
                              : 'bg-card text-muted-foreground border-border hover:border-amber-400'
                          }`}
                        >
                          <span className="text-2xl">🚧</span>
                          <span>Road Closed</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedIncidentType('congestion')}
                          className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all text-xs font-bold ${
                            selectedIncidentType === 'congestion'
                              ? 'bg-orange-500 text-white border-orange-600 shadow-md scale-[1.03]'
                              : 'bg-card text-muted-foreground border-border hover:border-orange-400'
                          }`}
                        >
                          <span className="text-2xl">🚗</span>
                          <span>Heavy Traffic</span>
                        </button>
                      </div>
                    </div>

                    {/* Road Selector */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-foreground">Which highway or street are you on?</Label>
                      <Select value={selectedCorridor} onValueChange={setSelectedCorridor}>
                        <SelectTrigger className="w-full h-11 text-xs rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HIGHWAYS_AND_CORRIDORS.map(c => (
                            <SelectItem key={c.id} value={c.name} className="text-xs">
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Delay & Driver */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-foreground">Estimated Delay (mins)</Label>
                        <Input
                          type="number"
                          value={incidentDelay}
                          onChange={e => setIncidentDelay(e.target.value)}
                          className="h-10 text-xs font-bold rounded-xl"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-foreground">Driver Name</Label>
                        <Input
                          value={driverReporterName}
                          onChange={e => setDriverReporterName(e.target.value)}
                          className="h-10 text-xs rounded-xl"
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full bg-[#1A2332] text-white hover:bg-[#1A2332]/90 font-bold text-xs h-11 rounded-xl gap-2 shadow-sm">
                      <Send className="w-4 h-4 text-emerald-400" /> Report Road Issue & Find Detour
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Live Shortcuts & Detours */}
            <div className="lg:col-span-7 space-y-4">
              <Card className="border-border bg-card shadow-sm rounded-2xl overflow-hidden flex flex-col">
                <CardHeader className="border-b border-border bg-muted/20 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🗺️</span>
                      <CardTitle className="text-sm font-black">Live Traffic Alerts & Faster Detours</CardTitle>
                    </div>
                    <Badge variant="outline" className="text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Live Updates
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Whenever a road is blocked, we calculate an alternative shortcut to keep drivers moving.
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-5 space-y-4 flex-1">
                  <div className="space-y-3">
                    {incidents.map(inc => (
                      <div
                        key={inc.id}
                        className={`p-4 rounded-2xl border transition-all space-y-3 ${
                          inc.status === 'rerouted'
                            ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                            : 'bg-card border-amber-300 dark:border-amber-800 shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-3">
                            <span className="text-2xl mt-0.5">
                              {inc.type === 'accident' ? '💥' : inc.type === 'closure' ? '🚧' : '🚗'}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-black text-foreground">{inc.corridor}</h4>
                                <Badge variant="destructive" className="text-[10px] font-bold px-2 py-0.5">
                                  +{inc.delayMinutes} min delay
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Reported by {inc.reporter} • {inc.timestamp}
                              </p>
                            </div>
                          </div>

                          {inc.status === 'rerouted' ? (
                            <Badge className="bg-emerald-600 text-white font-bold text-xs py-1 px-2.5">
                              Shortcut Sent
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs font-bold py-1 px-2.5">
                              Detour Ready
                            </Badge>
                          )}
                        </div>

                        {/* Friendly Route Comparison */}
                        <div className="p-3 bg-muted/40 rounded-xl border border-border text-xs space-y-1.5">
                          <div className="flex justify-between items-center text-muted-foreground">
                            <span className="line-through">Original Route: Stuck on {inc.corridor}</span>
                            <span className="text-red-500 font-bold">+{inc.delayMinutes} mins late</span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-black text-emerald-600">
                            <span className="flex items-center gap-1.5">
                              <Navigation className="w-3.5 h-3.5" />
                              Faster Shortcut: {inc.bypassRoute}
                            </span>
                            <span className="bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full text-[11px]">
                              Saves {inc.timeSavedMinutes} mins!
                            </span>
                          </div>
                        </div>

                        {/* Send Shortcut Button */}
                        {inc.status !== 'rerouted' && (
                          <Button
                            className="w-full bg-[#1A2332] text-white hover:bg-[#1A2332]/90 font-bold text-xs h-10 rounded-xl gap-2 shadow-sm"
                            onClick={() => handlePushAlternativeRoute(inc.id)}
                          >
                            <Navigation className="w-3.5 h-3.5 text-emerald-400" /> Send Faster Shortcut to Driver's Phone
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Clean Visual Map Graphic */}
                  <div className="rounded-2xl border border-border p-4 bg-muted/20 text-foreground">
                    <p className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Live Smart Rerouting Demonstration
                    </p>
                    <div className="relative h-24 border border-border rounded-xl bg-card flex items-center justify-around px-4">
                      <div className="flex flex-col items-center text-center">
                        <span className="text-lg">🛑</span>
                        <span className="text-xs font-bold text-red-500 mt-1">Traffic Jam</span>
                        <span className="text-[10px] text-muted-foreground">+45m delay</span>
                      </div>

                      <div className="flex-1 flex flex-col items-center px-4">
                        <span className="text-[11px] text-emerald-600 font-black mb-1">➔ Taking Shortcut ➔</span>
                        <div className="w-full h-1 bg-gradient-to-r from-red-400 via-amber-400 to-emerald-500 rounded-full" />
                      </div>

                      <div className="flex flex-col items-center text-center">
                        <span className="text-lg">⚡</span>
                        <span className="text-xs font-bold text-emerald-600 mt-1">Faster Detour</span>
                        <span className="text-[10px] text-muted-foreground">Arrive 28m earlier</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
