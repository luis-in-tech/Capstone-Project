import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Package, 
  Warehouse, 
  BarChart3, 
  Rocket, 
  ArrowRight, 
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  Truck
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Active Pro',
    description: 'The next generation of warehouse management and supply chain synchronization.',
    icon: <Package className="w-12 h-12 text-zinc-900" />,
    color: 'bg-zinc-100'
  },
  {
    id: 'inventory',
    title: 'Multi-Hub Inventory',
    description: 'Track stock levels across unlimited global locations with millisecond precision.',
    icon: <Warehouse className="w-12 h-12 text-zinc-900" />,
    color: 'bg-zinc-100'
  },
  {
    id: 'finance',
    title: 'Financial Trajectories',
    description: 'Automated P&L ledgers and financial forecasting based on real-time order data.',
    icon: <BarChart3 className="w-12 h-12 text-zinc-900" />,
    color: 'bg-zinc-100'
  },
  {
    id: 'dispatch',
    title: 'Verified Fulfillment',
    description: 'Use photo validation to ensure every order is dispatched with absolute proof.',
    icon: <Truck className="w-12 h-12 text-zinc-900" />,
    color: 'bg-zinc-100'
  }
];

export const Onboarding = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const navigate = useNavigate();

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      navigate('/login');
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    } else {
      navigate('/');
    }
  };

  const step = STEPS[currentStep];

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col font-sans">
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-zinc-200">
        <motion.div 
          initial={{ width: '0%' }}
          animate={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
          className="h-full bg-zinc-900"
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="max-w-xl w-full text-center"
          >
            <div className={`w-24 h-24 ${step.color} rounded-[2rem] flex items-center justify-center mx-auto mb-10 shadow-sm border border-zinc-200/50`}>
              {step.icon}
            </div>
            
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900 mb-6 uppercase">
              {step.title}
            </h1>
            
            <p className="text-lg text-zinc-500 font-medium leading-relaxed mb-12">
              {step.description}
            </p>

            <div className="grid grid-cols-1 gap-4 mb-12">
               <div className="bg-white p-4 rounded-2xl border border-zinc-200 flex items-center gap-4 text-left">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Ready for Enterprise Integration</span>
               </div>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="fixed bottom-12 left-0 w-full px-6">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            <Button 
                variant="ghost" 
                onClick={handleBack}
                className="text-xs font-black uppercase tracking-widest gap-2 text-zinc-400 hover:text-zinc-900"
            >
              <ArrowLeft className="w-4 h-4" /> {currentStep === 0 ? 'Exit' : 'Back'}
            </Button>

            <div className="flex gap-2">
              {STEPS.map((_, i) => (
                <div 
                  key={i} 
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentStep ? 'bg-zinc-900' : 'bg-zinc-200'}`}
                />
              ))}
            </div>

            <Button 
                onClick={handleNext}
                className="bg-zinc-900 text-white text-xs font-black uppercase tracking-widest px-8 h-12 rounded-xl group"
            >
              {currentStep === STEPS.length - 1 ? 'Start System' : 'Next'} 
              <ChevronRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </div>

      {/* Decorative Branding */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 pointer-events-none opacity-10">
        <span className="text-8xl font-black tracking-[1em] text-zinc-900 select-none">ACTIVE PRO</span>
      </div>
    </div>
  );
};
