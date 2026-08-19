import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { 
  Package, 
  ShieldCheck, 
  TrendingUp, 
  Users, 
  ArrowRight, 
  CheckCircle2,
  Warehouse,
  BarChart3,
  Truck,
  Globe,
  Database,
  Layers,
  Cpu
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const LandingPage = () => {
  const [isDemoOpen, setIsDemoOpen] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col font-sans selection:bg-zinc-200">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-zinc-900 p-1.5 rounded-lg">
              <Package className="w-5 h-5 text-white" />
            </div>
            <span className="font-black tracking-tighter text-lg text-zinc-900">VMS<span className="text-zinc-400">PRO</span></span>
          </div>
          
          <div className="hidden md:flex items-center gap-8">
            <Link to="/about" className="text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors uppercase tracking-widest">About</Link>
            <a href="#features" className="text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors uppercase tracking-widest">Features</a>
          </div>

          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost" className="text-xs font-bold uppercase tracking-widest">Login</Button>
            </Link>
            <Link to="/onboarding">
              <Button className="bg-zinc-900 text-white text-xs font-bold uppercase tracking-widest px-6 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-24 pb-32 overflow-hidden bg-white">
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="max-w-3xl">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-100 rounded-full mb-6 border border-zinc-200">
                   <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Enterprise Ready V2.0</span>
                </div>
                <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-zinc-900 leading-[0.9] mb-8">
                  PRECISION<br />
                  LOGISTICS<br />
                  MANAGEMENT.
                </h1>
                <p className="text-lg text-zinc-500 font-medium max-w-xl mb-10 leading-relaxed">
                  Streamline your entire supply chain with Active Pro. Advanced inventory tracking, 
                  real-time financial analytics, and automated order fulfillment in one powerful dashboard.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link to="/onboarding">
                    <Button size="lg" className="h-14 px-8 bg-zinc-900 text-white font-black uppercase tracking-widest text-sm hover:translate-y-[-2px] transition-all shadow-xl shadow-zinc-200 group">
                      Initialize System <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                  <Button 
                    variant="outline" 
                    size="lg" 
                    onClick={() => setIsDemoOpen(true)}
                    className="h-14 px-8 border-2 border-zinc-200 font-black uppercase tracking-widest text-sm hover:bg-zinc-50"
                  >
                    View Enterprise Demo
                  </Button>
                </div>
              </motion.div>
            </div>
          </div>
          
          {/* Decorative Elements */}
          <div className="absolute top-0 right-0 w-1/2 h-full hidden lg:block">
            <div className="relative h-full">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.1, scale: 1 }}
                transition={{ duration: 1 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Warehouse className="w-[800px] h-[800px] text-zinc-900" />
              </motion.div>
              <div className="absolute top-20 right-20 w-80 h-80 bg-zinc-100 rounded-3xl border border-zinc-200 -rotate-12 shadow-2xl flex items-center justify-center p-8 overflow-hidden">
                <div className="w-full space-y-4 opacity-50">
                   <div className="h-4 bg-zinc-300 rounded w-full" />
                   <div className="h-4 bg-zinc-300 rounded w-2/3" />
                   <div className="h-32 bg-zinc-200 rounded w-full" />
                   <div className="h-4 bg-zinc-300 rounded w-full" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features - Bento Grid Style */}
        <section id="features" className="py-32 bg-zinc-50">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-20">
              <h2 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 mb-4">The Infrastructure</h2>
              <h3 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900">ENGINEERED FOR SCALE.</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-white p-10 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-shadow group">
                <div className="bg-zinc-900 w-12 h-12 rounded-xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <h4 className="text-2xl font-black tracking-tight mb-4">Advanced Financial Analytics</h4>
                <p className="text-zinc-500 font-medium leading-relaxed">
                  Real-time trajectory charts, profit and loss ledgers, and automated expense categorization. 
                  Identify high-margin periods and manage operations with data-driven precision.
                </p>
              </div>

              <div className="bg-zinc-900 p-10 rounded-3xl border border-zinc-800 shadow-xl text-white group">
                <div className="bg-white w-12 h-12 rounded-xl flex items-center justify-center mb-6 text-zinc-900 group-hover:scale-110 transition-transform">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-2xl font-black tracking-tight mb-4 text-white">Military Grade Security</h4>
                <p className="text-zinc-400 font-medium leading-relaxed">
                  Role-based access control (RBAC) ensures your business data is only accessible to authorized personnel.
                </p>
              </div>

              <div className="bg-white p-10 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-shadow group">
                <div className="bg-zinc-100 w-12 h-12 rounded-xl flex items-center justify-center mb-6 text-zinc-900 group-hover:scale-110 transition-transform">
                  <Warehouse className="w-6 h-6" />
                </div>
                <h4 className="text-2xl font-black tracking-tight mb-4">Multi-Hub Warehousing</h4>
                <p className="text-zinc-500 font-medium leading-relaxed">
                  Manage inventory across multiple locations with automated stock transfers and real-time level monitoring.
                </p>
              </div>

              <div className="md:col-span-2 bg-zinc-100 p-10 rounded-3xl border border-zinc-200 shadow-sm group">
                <div className="flex flex-col md:flex-row gap-10 items-center">
                  <div className="flex-1">
                    <div className="bg-zinc-900 w-12 h-12 rounded-xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                      <Truck className="w-6 h-6" />
                    </div>
                    <h4 className="text-2xl font-black tracking-tight mb-4">Intelligent Fulfillment</h4>
                    <p className="text-zinc-500 font-medium leading-relaxed">
                      Photo-validated dispatch, automatic stock decrementing, and real-time order status tracking from 'Pending' to 'Completed'.
                    </p>
                  </div>
                  <div className="flex-1 w-full flex justify-center">
                    <div className="grid grid-cols-2 gap-4">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm w-24 h-24 flex items-center justify-center">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500 opacity-20" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="py-32 bg-white">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col lg:flex-row items-center gap-20">
              <div className="lg:w-1/2">
                <div className="relative">
                  <div className="aspect-square bg-zinc-100 rounded-[4rem] overflow-hidden border border-zinc-200 p-12">
                     <div className="w-full h-full border-4 border-dashed border-zinc-300 rounded-[2.5rem] flex items-center justify-center">
                        <Users className="w-32 h-32 text-zinc-300" />
                     </div>
                  </div>
                  <div className="absolute -bottom-10 -right-10 bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-2xl hidden md:block">
                    <p className="text-3xl font-black text-white tracking-tighter">99.9%</p>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Inventory Accuracy</p>
                  </div>
                </div>
              </div>
              <div className="lg:w-1/2">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 mb-6">Our Mission</h2>
                <h3 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900 mb-8 leading-tight">
                  ELIMINATING THE CHAOS IN SUPPLY CHAIN.
                </h3>
                <p className="text-lg text-zinc-500 font-medium leading-relaxed mb-10">
                  Active Pro was founded on the belief that enterprise-grade logistics software should be intuitive, 
                  fast, and accessible. We help businesses transition from chaotic spreadsheets to 
                  integrated data systems that drive growth and reduce operational waste.
                </p>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <h5 className="text-3xl font-black text-zinc-900 tracking-tighter mb-1">500k+</h5>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Orders Processed</p>
                  </div>
                  <div>
                    <h5 className="text-3xl font-black text-zinc-900 tracking-tighter mb-1">200+</h5>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Active Warehouses</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-32 bg-zinc-900 text-white relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 text-center relative z-10">
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-10 leading-none">
              READY TO <br />
              <span className="text-zinc-500">REVOLUTIONIZE</span> <br />
              YOUR LOGISTICS?
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
               <Link to="/onboarding">
                <Button size="lg" className="h-16 px-12 bg-white text-zinc-900 font-black uppercase tracking-widest text-sm hover:bg-zinc-100 transition-all shadow-xl shadow-black/20">
                  Initialize Account
                </Button>
               </Link>
            </div>
          </div>
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10 pointer-events-none">
             <div className="grid grid-cols-12 h-full w-full">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="border-r border-white/20 h-full" />
                ))}
             </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-zinc-100 py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-zinc-900 p-1.5 rounded-lg">
              <Package className="w-5 h-5 text-white" />
            </div>
            <span className="font-black tracking-tighter text-lg text-zinc-900">VMS<span className="text-zinc-400">PRO</span></span>
          </div>
          
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
            © 2024 ACTIVE PRO LOGISTICS SYSTEMS. ALL RIGHTS RESERVED.
          </p>

          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-colors">Privacy</Link>
            <Link to="/terms" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-colors">Terms</Link>
          </div>
        </div>
      </footer>

      {/* Enterprise Showcase Dialog */}
      <Dialog open={isDemoOpen} onOpenChange={setIsDemoOpen}>
        <DialogContent className="max-w-5xl p-0 bg-white border-none shadow-2xl overflow-hidden rounded-[2.5rem]">
          <div className="flex flex-col lg:flex-row h-[85vh]">
            {/* Left: Interactive Preview */}
            <div className="lg:w-2/3 bg-zinc-950 p-12 relative flex items-center justify-center overflow-hidden">
               <div className="absolute inset-0 opacity-20">
                  <div className="grid grid-cols-6 h-full">
                     {Array.from({ length: 6 }).map((_, i) => (
                       <div key={i} className="border-r border-white/20 h-full" />
                     ))}
                  </div>
               </div>
               
               <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="relative z-10 w-full"
               >
                 <div className="bg-white rounded-3xl shadow-2xl p-8 border border-white/20 overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                       <div className="flex gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-400" />
                          <div className="w-3 h-3 rounded-full bg-amber-400" />
                          <div className="w-3 h-3 rounded-full bg-emerald-400" />
                       </div>
                       <div className="px-3 py-1 bg-zinc-100 rounded-lg">
                          <span className="text-[10px] font-black uppercase text-zinc-400">Environment: PROD-ALPHA-01</span>
                       </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div className="space-y-6">
                          <div className="h-4 w-1/2 bg-zinc-100 rounded-full" />
                          <div className="h-32 bg-zinc-50 rounded-2xl border-2 border-dashed border-zinc-200 flex items-center justify-center">
                             <BarChart3 className="w-12 h-12 text-zinc-200" />
                          </div>
                          <div className="space-y-2">
                             <div className="h-3 bg-zinc-100 rounded-full w-full" />
                             <div className="h-3 bg-zinc-100 rounded-full w-4/5" />
                          </div>
                       </div>
                       <div className="space-y-6">
                          <div className="h-4 w-1/3 bg-zinc-100 rounded-full" />
                          <div className="space-y-4">
                             {[1, 2, 3].map(i => (
                               <div key={i} className="flex gap-4 items-center">
                                  <div className="w-10 h-10 bg-zinc-900 rounded-lg" />
                                  <div className="flex-1 space-y-1">
                                     <div className="h-2 bg-zinc-100 rounded-full w-full" />
                                     <div className="h-2 bg-zinc-100 rounded-full w-2/3" />
                                  </div>
                               </div>
                             ))}
                          </div>
                       </div>
                    </div>
                 </div>
               </motion.div>

               <div className="absolute bottom-12 left-12 flex gap-4">
                  <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
                     <p className="text-white text-[10px] font-black uppercase tracking-widest">Active Hubs</p>
                     <p className="text-emerald-400 font-black text-lg">24</p>
                  </div>
                  <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
                     <p className="text-white text-[10px] font-black uppercase tracking-widest">Sync Latency</p>
                     <p className="text-blue-400 font-black text-lg">12ms</p>
                  </div>
               </div>
            </div>

            {/* Right: Feature Walkthrough */}
            <div className="lg:w-1/3 p-12 overflow-y-auto bg-white border-l border-zinc-100">
               <DialogHeader className="mb-12">
                  <DialogTitle className="text-3xl font-black tracking-tighter text-zinc-900 mb-2 uppercase">Platform Showcase</DialogTitle>
                  <DialogDescription className="text-zinc-500 font-medium">
                     Experience the core engines powering Active Pro enterprises.
                  </DialogDescription>
               </DialogHeader>

               <div className="space-y-10">
                  <div className="group">
                     <div className="flex gap-4 items-start mb-4">
                        <div className="bg-zinc-100 p-2 rounded-xl text-zinc-900 group-hover:bg-zinc-900 group-hover:text-white transition-colors duration-500">
                           <Database className="w-5 h-5" />
                        </div>
                        <h5 className="text-sm font-black uppercase tracking-widest pt-1.5">Reactive Core</h5>
                     </div>
                     <p className="text-sm text-zinc-500 font-medium leading-relaxed">
                        Our hybrid Firestore/Vite architecture ensures every stock change is propagated to every terminal in the warehouse in real-time.
                     </p>
                  </div>

                  <div className="group">
                     <div className="flex gap-4 items-start mb-4">
                        <div className="bg-zinc-100 p-2 rounded-xl text-zinc-900 group-hover:bg-zinc-900 group-hover:text-white transition-colors duration-500">
                           <Layers className="w-5 h-5" />
                        </div>
                        <h5 className="text-sm font-black uppercase tracking-widest pt-1.5">Multi-Hub Sync</h5>
                     </div>
                     <p className="text-sm text-zinc-500 font-medium leading-relaxed">
                        Enterprise customers can segment inventory by region, city, or specific warehouse hub with granular local permissions.
                     </p>
                  </div>

                  <div className="group">
                     <div className="flex gap-4 items-start mb-4">
                        <div className="bg-zinc-100 p-2 rounded-xl text-zinc-900 group-hover:bg-zinc-900 group-hover:text-white transition-colors duration-500">
                           <Cpu className="w-5 h-5" />
                        </div>
                        <h5 className="text-sm font-black uppercase tracking-widest pt-1.5">Autonomous Ops</h5>
                     </div>
                     <p className="text-sm text-zinc-500 font-medium leading-relaxed">
                        Automated stock decrementing and financial ledger balancing triggered on every verified dispatch.
                     </p>
                  </div>
               </div>

               <div className="pt-16">
                  <Link to="/onboarding" onClick={() => setIsDemoOpen(false)} className="block">
                    <Button className="w-full h-14 bg-zinc-900 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl shadow-zinc-200">
                       Request Full Access <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </Link>
                  <p className="text-center mt-6 text-[10px] font-black uppercase tracking-widest text-zinc-300">
                     ISO-27001 Certified System
                  </p>
               </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
