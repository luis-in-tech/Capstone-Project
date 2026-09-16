import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  Map as MapIcon,
  Truck,
  Zap,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Navigation,
  Box
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

const recommendations = [
  {
    id: 1,
    title: "Route Consolidation",
    description: "Combine 3 pending deliveries to Quezon City. Estimated fuel savings: 15%.",
    type: "efficiency",
    status: "pending"
  },
  {
    id: 2,
    title: "Traffic Reroute: Agent #12",
    description: "Heavy congestion detected on EDSA. Recommend alternate routing via C5.",
    type: "alert",
    status: "pending"
  },
  {
    id: 3,
    title: "Load Balancing",
    description: "Shift 50 units of Groupsets from Hub 1 to Hub 2 to anticipate weekend demand.",
    type: "inventory",
    status: "pending"
  }
];

export function LogisticsOptimizer() {
  const [activeRecommendations, setActiveRecommendations] = useState(recommendations);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [overallEfficiency, setOverallEfficiency] = useState(84);

  const applyOptimization = (id: number) => {
    setActiveRecommendations(prev => prev.map(rec =>
      rec.id === id ? { ...rec, status: 'applying' } : rec
    ));

    setTimeout(() => {
      setActiveRecommendations(prev => prev.filter(rec => rec.id !== id));
      setOverallEfficiency(prev => Math.min(100, prev + 3));
      toast.success("Optimization matrix updated and deployed.");
    }, 1500);
  };

  const handleGlobalSync = () => {
    setIsOptimizing(true);
    toast("Initiating neural route recalculation...", { icon: <Activity className="w-4 h-4 text-emerald-500 animate-pulse" /> });
    setTimeout(() => {
      setIsOptimizing(false);
      setOverallEfficiency(98);
      toast.success("Global routing synchronized perfectly.");
    }, 3000);
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground font-medium">AI-driven route telemetry and fleet management.</p>
        </div>
        <Button
          onClick={handleGlobalSync}
          disabled={isOptimizing}
          className="bg-[#1A2332] text-white hover:bg-[#1A2332]/90 font-black uppercase tracking-widest text-xs h-12 px-6 rounded-xl group"
        >
          {isOptimizing ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Zap className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform text-emerald-400" />
          )}
          {isOptimizing ? 'Recalculating...' : 'Force Global Sync'}
        </Button>
      </div>

      {/* Telemetry Dashboard */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
        <Card className="border-border">
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Fleet Efficiency</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-black text-foreground">{overallEfficiency}%</span>
                <span className="text-xs font-bold text-emerald-500 mb-1 flex items-center"><TrendingUp className="w-3 h-3 mr-1" /> Optimal</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Activity className="w-6 h-6 text-emerald-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Active Nodes</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-black text-foreground">12</span>
                <span className="text-xs font-bold text-muted-foreground mb-1">In Transit</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Truck className="w-6 h-6 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Projected Savings</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-black text-foreground">₱4.2k</span>
                <span className="text-xs font-bold text-muted-foreground mb-1">Today</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#fdd001]/10 flex items-center justify-center">
              <Zap className="w-6 h-6 text-[#fdd001]" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* Interactive Map Mockup */}
        <Card className="col-span-1 lg:col-span-2 border-border overflow-hidden flex flex-col">
          <CardHeader className="bg-muted/30 border-b border-border z-10">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                <MapIcon className="w-4 h-4" /> Live Routing Network
              </CardTitle>
              <Badge variant="outline" className="text-[8px] uppercase font-black bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1.5 inline-block" /> Real-time Tracking
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 relative bg-[#0a0f18] min-h-[400px] overflow-hidden">
            {/* Grid Background */}
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#302f2f 1px, transparent 1px), linear-gradient(90deg, #302f2f 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

            {/* Central Hub Node */}
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-[#fdd001]/20 border border-[#fdd001] flex items-center justify-center z-20"
              animate={{ boxShadow: ['0 0 0 0 rgba(253,208,1,0.4)', '0 0 0 20px rgba(253,208,1,0)'] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <Box className="w-6 h-6 text-[#fdd001]" />
            </motion.div>

            {/* Delivery Nodes & Lines */}
            {[
              { x: 20, y: 30, delay: 0 },
              { x: 80, y: 20, delay: 0.5 },
              { x: 70, y: 80, delay: 1 },
              { x: 30, y: 70, delay: 1.5 }
            ].map((pos, i) => (
              <React.Fragment key={i}>
                <svg className="absolute inset-0 w-full h-full z-10 pointer-events-none">
                  <motion.path
                    d={`M 50% 50% L ${pos.x}% ${pos.y}%`}
                    stroke="rgba(56, 189, 248, 0.4)"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 1, delay: pos.delay }}
                  />
                  <motion.circle
                    cx="0" cy="0" r="3" fill="#38bdf8"
                    animate={{
                      cx: ['50%', `${pos.x}%`],
                      cy: ['50%', `${pos.y}%`],
                      opacity: [0, 1, 0]
                    }}
                    transition={{ duration: 3, delay: pos.delay, repeat: Infinity, ease: "linear" }}
                  />
                </svg>
                <motion.div
                  className="absolute w-8 h-8 rounded-full bg-[#1A2332] border-2 border-sky-400 flex items-center justify-center z-20"
                  style={{ left: `calc(${pos.x}% - 16px)`, top: `calc(${pos.y}% - 16px)` }}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: pos.delay + 1 }}
                >
                  <Navigation className="w-3 h-3 text-sky-400" />
                </motion.div>
              </React.Fragment>
            ))}

            {/* Scanning Line Effect */}
            <motion.div
              className="absolute left-0 right-0 h-1 bg-emerald-400/50 blur-[2px] z-30"
              animate={{ top: ['0%', '100%'] }}
              transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
            />
          </CardContent>
        </Card>

        {/* Recommendations Panel */}
        <Card className="col-span-1 border-border flex flex-col">
          <CardHeader className="bg-muted/30 border-b border-border">
            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#fdd001]" /> AI Recommendations
            </CardTitle>
            <CardDescription className="text-xs font-medium text-muted-foreground">Auto-generated efficiency actions based on current matrix.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 flex-1 flex flex-col gap-4">
            <AnimatePresence>
              {activeRecommendations.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-full text-center p-8 text-muted-foreground space-y-4 border border-dashed border-border rounded-xl"
                >
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 opacity-50" />
                  <p className="font-bold text-sm">All Systems Optimal</p>
                  <p className="text-xs font-medium">No further optimizations required at this time.</p>
                </motion.div>
              ) : (
                activeRecommendations.map(rec => (
                  <motion.div
                    key={rec.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, x: -50, scale: 0.9 }}
                    className="p-4 rounded-xl border border-border bg-card shadow-sm hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`p-2 rounded-lg shrink-0 ${rec.type === 'efficiency' ? 'bg-emerald-500/10 text-emerald-600' :
                          rec.type === 'alert' ? 'bg-amber-500/10 text-amber-600' :
                            'bg-blue-500/10 text-blue-600'
                        }`}>
                        {rec.type === 'efficiency' ? <TrendingUp className="w-4 h-4" /> :
                          rec.type === 'alert' ? <AlertTriangle className="w-4 h-4" /> :
                            <Box className="w-4 h-4" />}
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-wider text-foreground">{rec.title}</h4>
                        <p className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">{rec.description}</p>
                      </div>
                    </div>
                    <Button
                      className="w-full h-8 text-[10px] font-black uppercase tracking-widest bg-primary text-primary-foreground"
                      onClick={() => applyOptimization(rec.id)}
                      disabled={rec.status === 'applying'}
                    >
                      {rec.status === 'applying' ? (
                        <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 mr-2" />
                      )}
                      {rec.status === 'applying' ? 'Deploying...' : 'Apply Optimization'}
                    </Button>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
