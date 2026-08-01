import React from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, Target, Zap, Globe, Package, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export const About = () => {
  return (
    <div className="min-h-screen bg-white">
      {/* Sub-Nav */}
      <nav className="border-b border-zinc-100 py-4 px-6 sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2">
            <Package className="w-5 h-5 text-zinc-900" />
            <span className="font-black tracking-tighter text-zinc-900">Active Pro</span>
          </Link>
          <Link to="/login">
            <Button variant="outline" size="sm" className="text-[10px] font-black uppercase tracking-widest">Login / Join</Button>
          </Link>
        </div>
      </nav>

      <main className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-zinc-900 mb-12">
              REDEFINING<br />CENTRALIZED<br />LOGISTICS.
            </h1>
            
            <div className="space-y-12">
              <section>
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 mb-6 underline decoration-2 underline-offset-8">The Philosophy</h2>
                <p className="text-xl text-zinc-600 font-medium leading-relaxed">
                  Active Pro was born out of a simple observation: the tools used to manage multi-warehousing 
                  are often either too simplistic for growth or too complex for agility. We've built 
                  a system that bridges that gap, providing enterprise-grade power with a consumer-grade experience.
                </p>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 py-12">
                <div className="space-y-4">
                   <div className="bg-zinc-100 w-12 h-12 rounded-2xl flex items-center justify-center">
                     <Target className="w-6 h-6 text-zinc-900" />
                   </div>
                   <h3 className="text-lg font-black tracking-tight">Our Focus</h3>
                   <p className="text-zinc-500 font-medium">To provide the most accurate real-time inventory synchronization across global multi-hub environments.</p>
                </div>
                <div className="space-y-4">
                   <div className="bg-zinc-100 w-12 h-12 rounded-2xl flex items-center justify-center">
                     <Zap className="w-6 h-6 text-zinc-900" />
                   </div>
                   <h3 className="text-lg font-black tracking-tight">Our Speed</h3>
                   <p className="text-zinc-500 font-medium">Built on top-tier cloud infrastructure, ensuring that every stock transfer and order update happens in milliseconds.</p>
                </div>
              </div>

              <section className="bg-zinc-950 rounded-[3rem] p-12 text-white overflow-hidden relative group">
                <div className="relative z-10">
                  <h2 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500 mb-6">The Technology</h2>
                  <p className="text-2xl font-bold tracking-tight mb-8">
                    Fully integrated with Firebase for real-time reactivity and ITIL 4 compliant service management principles.
                  </p>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/10">
                       <ShieldCheck className="w-3 h-3 text-emerald-400" />
                       <span className="text-[10px] font-black uppercase">Secure RBAC</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/10">
                       <Globe className="w-3 h-3 text-blue-400" />
                       <span className="text-[10px] font-black uppercase">Edge Global</span>
                    </div>
                  </div>
                </div>
                <Globe className="absolute -bottom-20 -right-20 w-80 h-80 text-white/5 group-hover:scale-110 transition-transform duration-[2s]" />
              </section>

              <section>
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 mb-6">The Roadmap</h2>
                <div className="space-y-6">
                  {[
                    { phase: 'Phase 1', title: 'Inventory Core', desc: 'Centralized multi-warehouse management.' },
                    { phase: 'Phase 2', title: 'Financial Intelligence', desc: 'Automated P&L and trajectory analytics.' },
                    { phase: 'Phase 3', title: 'Mobile Fulfillment', desc: 'Photo Validation & Real-time GPS Tracking.' },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-6 items-start">
                      <span className="text-[10px] font-black uppercase text-zinc-400 pt-1.5 min-w-[60px]">{item.phase}</span>
                      <div>
                        <h4 className="text-lg font-black tracking-tight text-zinc-900">{item.title}</h4>
                        <p className="text-zinc-500 font-medium">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            
            <div className="pt-24 flex justify-center">
              <Link to="/login">
                <Button size="lg" className="h-14 px-10 bg-zinc-900 text-white font-black uppercase tracking-widest text-sm hover:translate-y-[-2px] transition-all">
                  Join the Network
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};
