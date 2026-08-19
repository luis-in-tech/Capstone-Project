import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Package, 
  ShoppingCart, 
  BarChart3, 
  Truck, 
  ShieldCheck,
  Zap,
  Shield,
  Activity,
  Tag,
  UserCog,
  Settings,
  DollarSign,
  Play,
  Monitor
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TUTORIAL_PAGES = [
  {
    id: 'intro',
    title: 'Welcome to Active Pro',
    icon: <Zap className="w-8 h-8 text-zinc-900" />,
    content: 'Active Pro is a centralized logistics management system built for multi-hub warehouse environments. It synchronizes stock levels, order fulfillment, financial tracking, and staff delegation — all in real-time.',
    highlights: [
      'Real-time Firebase Sync',
      'Multi-Warehouse Architecture',
      'Role-Based Access Control',
      'Automated Financial Processing'
    ],
    videoLabel: 'System Overview'
  },
  {
    id: 'admin',
    title: 'Admin Panel',
    icon: <Shield className="w-8 h-8 text-zinc-900" />,
    content: 'The Admin Panel provides a high-level overview of your entire operation. View total revenue, order counts, registered users, and product catalog size at a glance. It also features a Top Performers section showing the best-selling products with detailed unit sales and revenue breakdowns.',
    highlights: [
      'Revenue & Order Summary Cards',
      'Top Performers with Unit Sales & Revenue',
      'User & Product Counts',
      'Monthly Revenue Chart'
    ],
    videoLabel: 'Admin Panel Walkthrough'
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: <BarChart3 className="w-8 h-8 text-zinc-900" />,
    content: 'The Dashboard gives you a real-time operational snapshot. Track total revenue, active orders, SLA breaches, and pending transports. View revenue trajectory charts, recent order activity, and low-stock product alerts — all updating live.',
    highlights: [
      'Revenue Trajectory Chart',
      'Active Orders & SLA Monitoring',
      'Low-Stock Alerts',
      'Recent Order Activity Feed'
    ],
    videoLabel: 'Dashboard Walkthrough'
  },
  {
    id: 'inventory',
    title: 'Inventory',
    icon: <Package className="w-8 h-8 text-zinc-900" />,
    content: 'The Inventory module tracks every SKU across your warehouse network. View products in table or card layout, monitor stock levels per warehouse hub, generate QR labels, and perform manual stock adjustments with full audit logging. Each product supports multiple variations (Color, Size, Model, Series) for detailed tracking.',
    highlights: [
      'SKU Tracking & Categorization',
      'Hub-Specific Stock Levels',
      'QR Code Label Generation',
      'Manual Stock Adjustment with Variations',
      'Product Detail View with Variations'
    ],
    videoLabel: 'Inventory Walkthrough'
  },
  {
    id: 'orders',
    title: 'Order Entry',
    icon: <ShoppingCart className="w-8 h-8 text-zinc-900" />,
    content: 'Orders follow a strict lifecycle: Pending → Preparing → Out for Delivery → Delivered → Completed. The system uses photo validation during dispatch for accountability. Create new orders with multiple line items, assign warehouses, and track the full order history with status updates.',
    highlights: [
      'Full Order Lifecycle Management',
      'Photo Evidence for Dispatch',
      'Automatic Stock Decrementing',
      'Multi-Item Order Creation',
      'Order History & Status Tracking'
    ],
    videoLabel: 'Order Entry Walkthrough'
  },
  {
    id: 'transport',
    title: 'Transport',
    icon: <Truck className="w-8 h-8 text-zinc-900" />,
    content: 'The Transport module handles stock movement between warehouse facilities. Initiate transport requests specifying source and destination warehouses, add multiple product items, and track the movement lifecycle: Pending → In Transit → Received. Stock levels auto-adjust upon confirmation.',
    highlights: [
      'Warehouse-to-Warehouse Transport',
      'Multi-Item Transport Requests',
      'Status Lifecycle Tracking',
      'Automatic Inventory Rebalancing',
      'Transport Detail View'
    ],
    videoLabel: 'Transport Walkthrough'
  },
  {
    id: 'finance',
    title: 'Financials',
    icon: <DollarSign className="w-8 h-8 text-zinc-900" />,
    content: 'The Financials module tracks revenue from orders against operational expenses. Record expenses by category, view profit & loss summaries, and monitor financial health with trajectory charts. Understand your margins with categorized expenditure breakdowns.',
    highlights: [
      'Profit & Loss Ledgers',
      'Categorized Expense Recording',
      'Revenue vs. Cost Analytics',
      'Financial Trajectory Charts'
    ],
    videoLabel: 'Financials Walkthrough'
  },
  {
    id: 'logistics',
    title: 'Logistics Optimizer',
    icon: <Activity className="w-8 h-8 text-zinc-900" />,
    content: 'The Logistics Optimizer provides AI-driven recommendations for your operations. Get suggestions for route consolidation, traffic rerouting, and load balancing between warehouses. Apply recommendations directly to optimize delivery efficiency and reduce fuel costs.',
    highlights: [
      'Route Consolidation Suggestions',
      'Traffic Reroute Alerts',
      'Load Balancing Recommendations',
      'Efficiency Score Dashboard'
    ],
    videoLabel: 'Logistics Optimizer Walkthrough'
  },
  {
    id: 'pricelist',
    title: 'Pricelist',
    icon: <Tag className="w-8 h-8 text-zinc-900" />,
    content: 'The Pricelist module provides a centralized catalog of all product pricing. Browse products by category tabs, search by name or SKU, and view base prices. Admins and delegated staff can add new products or edit existing pricing directly from this view.',
    highlights: [
      'Category-Based Product Tabs',
      'Search by Name or SKU',
      'Add & Edit Product Pricing',
      'Delegated Access for Staff'
    ],
    videoLabel: 'Pricelist Walkthrough'
  },
  {
    id: 'delegation',
    title: 'Staff Delegation',
    icon: <UserCog className="w-8 h-8 text-zinc-900" />,
    content: 'The Staff Delegation panel allows admins to grant specific permissions to staff members. Delegate inventory adjustment access or pricelist editing privileges to individual team members by email. Edit or revoke delegations at any time to maintain security.',
    highlights: [
      'Grant Inventory Adjustment Access',
      'Grant Pricelist Editing Privileges',
      'Edit & Revoke Delegations',
      'Email-Based Staff Lookup'
    ],
    videoLabel: 'Staff Delegation Walkthrough'
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: <Settings className="w-8 h-8 text-zinc-900" />,
    content: 'Configure your Active Pro experience. Manage your profile information, toggle between light and dark themes, view notification preferences, and check system health status including database connectivity and regional cluster info.',
    highlights: [
      'Profile Management',
      'Light / Dark Theme Toggle',
      'Notification Preferences',
      'System Health & Status'
    ],
    videoLabel: 'Settings Walkthrough'
  }
];

export const TutorialOverlay = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
  const [currentPage, setCurrentPage] = useState(0);

  const nextPage = () => currentPage < TUTORIAL_PAGES.length - 1 && setCurrentPage(prev => prev + 1);
  const prevPage = () => currentPage > 0 && setCurrentPage(prev => prev - 1);

  const current = TUTORIAL_PAGES[currentPage];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[75vw] max-w-[95vw] sm:max-w-[95vw] p-0 bg-white border-zinc-200 overflow-hidden rounded-[2rem]">
        <div className="flex flex-col md:flex-row h-[90vh] min-h-[90vh]">
          {/* Left: Module Info */}
          <div className="md:w-2/5 bg-zinc-950 p-10 flex flex-col justify-between text-white relative overflow-y-auto">
            <div className="relative z-10">
               <div className="bg-white/10 w-16 h-16 rounded-[1.5rem] flex items-center justify-center mb-8 border border-white/10">
                  {current.icon}
               </div>
               <h2 className="text-3xl font-black tracking-tighter uppercase mb-4 leading-none">{current.title}</h2>
               <div className="space-y-3">
                  {current.highlights.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                      <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                      {h}
                    </div>
                  ))}
               </div>
            </div>

            <div className="relative z-10 pt-12">
               <p className="text-sm font-medium text-zinc-400 italic">"Precision at Scale"</p>
            </div>
            
            {/* Background Grid */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="grid grid-cols-4 h-full">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="border-r border-white/20 h-full" />
                ))}
              </div>
            </div>
          </div>

          {/* Right: Content & Video Placeholder */}
          <div className="md:w-3/5 p-10 flex flex-col bg-white">
            <div className="flex-1 overflow-y-auto pr-2">
               <AnimatePresence mode="wait">
                 <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-8"
                 >
                    <p className="text-lg text-zinc-600 font-medium leading-relaxed">
                      {current.content}
                    </p>

                    {/* Video Placeholder */}
                    <div className="bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-200 aspect-video flex flex-col items-center justify-center relative group cursor-pointer hover:border-zinc-400 transition-all">
                       <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/80 to-zinc-950/95" />
                       <div className="relative z-10 flex flex-col items-center gap-4">
                          <div className="w-16 h-16 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center group-hover:bg-white/20 group-hover:scale-110 transition-all">
                             <Play className="w-6 h-6 text-white ml-0.5" />
                          </div>
                          <div className="text-center">
                             <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Video Guide</p>
                             <p className="text-sm font-bold text-white">{current.videoLabel}</p>
                          </div>
                       </div>
                       <div className="absolute bottom-3 right-3 z-10">
                          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                             <Monitor className="w-3 h-3" />
                             Coming Soon
                          </div>
                       </div>
                    </div>

                    <div className="bg-zinc-50 rounded-2xl p-6 border border-zinc-100">
                       <h4 className="text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
                          <ShieldCheck className="w-3 h-3" /> Access Control
                       </h4>
                       <p className="text-xs text-zinc-500 font-medium">
                          {current.id === 'intro' && 'Active Pro uses role-based access control. Admins have full access, while Secretaries, Agents, and Staff see only the modules relevant to their responsibilities.'}
                          {current.id === 'admin' && 'Only users with the Admin role can access the Admin Panel. This provides system-wide visibility and management controls.'}
                          {current.id === 'dashboard' && 'The Dashboard is accessible to Admin users. Data shown is scoped to the user\'s role and assigned warehouse network.'}
                          {current.id === 'inventory' && 'Inventory is visible to all roles. Stock adjustments require Admin access or a specific delegation from the Staff Delegation panel.'}
                          {current.id === 'orders' && 'Order Entry is available to all roles. Agents can create and manage their own orders, while Admins and Secretaries can view all orders system-wide.'}
                          {current.id === 'transport' && 'Transport management is restricted to Admin and Secretary roles for initiating and tracking warehouse-to-warehouse stock movements.'}
                          {current.id === 'finance' && 'The Financials module is Admin-only. It contains sensitive revenue and expense data used for business decision-making.'}
                          {current.id === 'logistics' && 'The Logistics Optimizer is available to Admin and Secretary roles for reviewing and applying AI-driven operational recommendations.'}
                          {current.id === 'pricelist' && 'The Pricelist is visible to all roles. Editing privileges require Admin access or a pricelist delegation from Staff Delegation.'}
                          {current.id === 'delegation' && 'Staff Delegation is Admin-only. It controls which staff members receive elevated permissions for Inventory and Pricelist modules.'}
                          {current.id === 'settings' && 'Settings is available to all roles. Users can manage their own profile, theme preferences, and view system status.'}
                       </p>
                    </div>
                 </motion.div>
               </AnimatePresence>
            </div>

            <div className="mt-8 flex items-center justify-between pt-6 border-t border-zinc-100">
               <div className="flex gap-1">
                  {TUTORIAL_PAGES.map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-1 rounded-full transition-all cursor-pointer ${i === currentPage ? 'w-6 bg-zinc-900' : 'w-2 bg-zinc-200 hover:bg-zinc-400'}`} 
                      onClick={() => setCurrentPage(i)}
                    />
                  ))}
               </div>
               
               <div className="flex gap-2">
                  <Button variant="ghost" onClick={prevPage} disabled={currentPage === 0} className="text-[10px] font-black uppercase"><ChevronLeft className="w-4 h-4 mr-1" /> Prev</Button>
                  {currentPage === TUTORIAL_PAGES.length - 1 ? (
                    <Button onClick={() => onOpenChange(false)} className="bg-zinc-900 text-white text-[10px] font-black uppercase px-6">Finish Guide</Button>
                  ) : (
                    <Button onClick={nextPage} className="bg-zinc-900 text-white text-[10px] font-black uppercase px-6">Next Module <ChevronRight className="w-4 h-4 ml-1" /></Button>
                  )}
               </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
