import React from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const Privacy = () => {
  return (
    <div className="min-h-screen bg-white font-sans selection:bg-zinc-100">
      <nav className="border-b border-zinc-100 py-4 px-6 sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2">
            <span className="font-black tracking-tighter text-zinc-900">Active Pro</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm" className="text-[10px] font-black uppercase tracking-widest gap-2">
              <ArrowLeft className="w-3 h-3" /> Back home
            </Button>
          </Link>
        </div>
      </nav>

      <main className="py-24 max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-4 mb-8">
            <div className="bg-zinc-900 p-2 rounded-lg">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter text-zinc-900 uppercase">Privacy Policy</h1>
          </div>

          <p className="text-sm text-zinc-400 font-bold uppercase tracking-widest mb-12">Last Updated: May 2024</p>

          <div className="prose prose-zinc prose-sm md:prose-base max-w-none space-y-12">
            <section>
              <h2 className="text-xl font-black tracking-tight text-zinc-900 mb-4">1. DATA ENCAPSULATION</h2>
              <p className="text-zinc-600 leading-relaxed font-medium">
                Active Pro ("The System") prioritizes the absolute integrity of your logistics data. We operate on a principle of "Zero-Knowledge" for your proprietary supply chain data. All warehouse records, agent details, and financialTrajectories are stored using enterprise-grade encryption.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black tracking-tight text-zinc-900 mb-4">2. COLLECTION PARAMETERS</h2>
              <p className="text-zinc-600 leading-relaxed font-medium">
                We collect architectural log data necessary for system optimization, including sync latency, error rates, and authentication attempts. For enterprise fulfillment, we store photo validation evidence provided during the dispatch process.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black tracking-tight text-zinc-900 mb-4">3. THIRD-PARTY INFRASTRUCTURE</h2>
              <p className="text-zinc-600 leading-relaxed font-medium">
                Our core infrastructure is hosted on Firebase (Google Cloud Platform). Data processing occurs within secure VPC environments. We do not sell supply chain data to third-party marketing entities.
              </p>
            </section>

            <section className="bg-zinc-50 p-8 rounded-3xl border border-zinc-100">
              <h2 className="text-xl font-black tracking-tight text-zinc-900 mb-4">4. CONTACT FOR COMPLIANCE</h2>
              <p className="text-zinc-600 leading-relaxed font-medium">
                For GDPR or CCPA inquiries regarding data deletion or extraction, please contact our compliance department at:
                <br />
                <span className="text-zinc-900 font-black block mt-2 text-sm uppercase tracking-widest">compliance@activepro.edge</span>
              </p>
            </section>
          </div>
        </motion.div>
      </main>
    </div>
  );
};
