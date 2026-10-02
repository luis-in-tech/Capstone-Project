import { PageHeading } from './PageHeading';
import React, { useState, useEffect } from 'react';
import { db } from '../lib/supabaseAdapter';
import { collection, onSnapshot, addDoc, query, orderBy, serverTimestamp, updateDoc, doc } from '../lib/supabaseAdapter';
import { Expense, Order, ExpenseCategory } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight,
  FileText,
  PieChart as PieChartIcon,
  BarChart as BarChartIcon,
  Settings,
  Edit2,
  Archive,
  RefreshCcw,
  Trash2,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Download,
  Calendar,
  FileSpreadsheet
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface PLRow {
  name?: string;
  section?: string;
  jan?: number;
  feb?: number;
  mar?: number;
  total?: number;
  pct?: string;
  isHeader?: boolean;
  isSubheader?: boolean;
  isTotal?: boolean;
  isGrandTotal?: boolean;
  isFinalNetIncome?: boolean;
  indent?: boolean;
  highlight?: 'emerald' | 'rose' | 'gold';
}

export const PL_STATEMENT_ROWS: PLRow[] = [
  { section: 'Ordinary Income/Expense', isHeader: true },
  { section: 'Income', isSubheader: true },
  { name: 'Sales', jan: 8357633.01, feb: 7275887.33, mar: 6555467.70, total: 22188988.04, pct: '103.19%', indent: true },
  { name: 'Shipping and Delivery Income', jan: 13440.00, feb: 12750.00, mar: 13650.00, total: 39840.00, pct: '0.19%', indent: true },
  { name: 'DISCOUNT', jan: -252702.08, feb: -215941.08, mar: -258731.48, total: -727374.64, pct: '-3.38%', indent: true },
  { name: 'EXPENSES', jan: 0.00, feb: 900.00, mar: 0.00, total: 900.00, pct: '0.00%', indent: true },
  { name: 'Total Income', jan: 8118370.93, feb: 7073596.25, mar: 6310386.22, total: 21502353.40, pct: '100.00%', isTotal: true, highlight: 'emerald' },
  { section: 'Cost of Goods Sold', isSubheader: true },
  { name: 'Cost of Goods Sold', jan: 5904520.17, feb: 6100297.72, mar: 5082247.40, total: 17087065.29, pct: '79.47%', indent: true },
  { name: 'Freight and Shipping Costs', jan: -405.00, feb: -185.00, mar: -640.00, total: -1230.00, pct: '-0.01%', indent: true },
  { name: 'Total COGS', jan: 5904115.17, feb: 6100112.72, mar: 5081607.40, total: 17085835.29, pct: '79.46%', isTotal: true, highlight: 'rose' },
  { name: 'Gross Profit', jan: 2214255.76, feb: 973483.53, mar: 1228778.82, total: 4416518.11, pct: '20.54%', isGrandTotal: true, highlight: 'emerald' },
  { section: 'Expense', isSubheader: true },
  { name: 'Office Supplies', jan: -230.00, feb: -345.00, mar: -690.00, total: -1265.00, pct: '-0.01%', indent: true },
  { name: 'Travel Expense', jan: 2500.00, feb: 9000.00, mar: 3000.00, total: 14500.00, pct: '0.07%', indent: true },
  { name: 'Utilities', jan: 0.00, feb: 0.00, mar: 0.00, total: 0.00, pct: '0.00%', indent: true },
  { name: 'Total Expense', jan: 2270.00, feb: 8655.00, mar: 2310.00, total: 13235.00, pct: '0.06%', isTotal: true, highlight: 'rose' },
  { name: 'Net Ordinary Income', jan: 2211985.76, feb: 964828.53, mar: 1226468.82, total: 4403283.11, pct: '20.48%', isGrandTotal: true },
  { section: 'Other Income/Expense', isHeader: true },
  { section: 'Other Expense', isSubheader: true },
  { name: 'Ask My Accountant', jan: -2515.17, feb: -13735.76, mar: -2611.22, total: -18862.15, pct: '-0.09%', indent: true },
  { name: 'OTHER EXPENSE', jan: 12670.27, feb: 4000.00, mar: 25710.23, total: 42380.50, pct: '0.20%', indent: true },
  { name: 'Total Other Expense', jan: 10155.10, feb: -9735.76, mar: 23099.01, total: 23518.35, pct: '0.11%', isTotal: true, highlight: 'rose' },
  { name: 'Net Other Income', jan: -10155.10, feb: 9735.76, mar: -23099.01, total: -23518.35, pct: '-0.11%', isTotal: true },
  { name: 'Net Income', jan: 2201830.66, feb: 974564.29, mar: 1203369.81, total: 4379764.76, pct: '20.37%', isFinalNetIncome: true, highlight: 'gold' }
];

export const formatCurrency = (val: number | undefined) => {
  if (val === undefined) return '';
  const isNegative = val < 0;
  const absVal = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return isNegative ? `-₱${absVal}` : `₱${absVal}`;
};

export function Finance() {
  const { profile } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<'2025' | '2026' | 'all'>('2025');
  const [activeLedgerTab, setActiveLedgerTab] = useState<'statement' | 'ledger'>('statement');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isEditExpenseOpen, setIsEditExpenseOpen] = useState(false);

  type SortKey = 'date' | 'category' | 'amount' | 'orderId';
  type SortDirection = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    const unsubExpenses = onSnapshot(query(collection(db, 'expenses'), orderBy('date', 'desc')), (snap) => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'expenses');
    });
    const unsubOrders = onSnapshot(collection(db, 'orders'), (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'orders');
    });
    const unsubCategories = onSnapshot(query(collection(db, 'expenseCategories'), orderBy('createdAt', 'asc')), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseCategory)));
    }, (error) => {
      handleSupabaseError(error, OperationType.GET, 'expenseCategories');
    });

    return () => {
      unsubExpenses();
      unsubOrders();
      unsubCategories();
    };
  }, []);

  const parseDate = (d: any): Date | null => {
    if (!d) return null;
    if (typeof d?.toDate === 'function') return d.toDate();
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    if (typeof d === 'string' || typeof d === 'number') {
      const parsed = new Date(d);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  const filteredOrders = React.useMemo(() => {
    if (selectedPeriod === 'all') return orders;
    return orders.filter(o => {
      const d = parseDate(o.createdAt);
      return d && d.getFullYear().toString() === selectedPeriod;
    });
  }, [orders, selectedPeriod]);

  const filteredExpenses = React.useMemo(() => {
    if (selectedPeriod === 'all') return expenses;
    return expenses.filter(e => {
      const d = parseDate(e.date);
      return d && d.getFullYear().toString() === selectedPeriod;
    });
  }, [expenses, selectedPeriod]);

  const displayRevenue = React.useMemo(() => {
    if (selectedPeriod === '2025') return 21502353.40;
    return filteredOrders
      .filter(o => ['delivered', 'completed'].includes(o.status))
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [filteredOrders, selectedPeriod]);

  const displayExpenses = React.useMemo(() => {
    if (selectedPeriod === '2025') return 17122588.64;
    return filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [filteredExpenses, selectedPeriod]);

  const displayGrossProfit = React.useMemo(() => {
    if (selectedPeriod === '2025') return 4416518.11;
    const directCogs = filteredExpenses
      .filter(e => (e.category || '').toLowerCase().includes('cost of goods') || (e.category || '').toLowerCase().includes('freight'))
      .reduce((sum, e) => sum + (e.amount || 0), 0);
    return displayRevenue - directCogs;
  }, [displayRevenue, filteredExpenses, selectedPeriod]);

  const displayNetProfit = React.useMemo(() => {
    if (selectedPeriod === '2025') return 4379764.76;
    return displayRevenue - displayExpenses;
  }, [displayRevenue, displayExpenses, selectedPeriod]);

  const grossMargin = displayRevenue > 0 ? ((displayGrossProfit / displayRevenue) * 100).toFixed(2) : '0.00';
  const netMargin = displayRevenue > 0 ? ((displayNetProfit / displayRevenue) * 100).toFixed(2) : '0.00';

  // Process data for the performance chart
  const chartData = React.useMemo(() => {
    if (selectedPeriod === '2025') {
      return [
        { name: 'Jan 25', Revenue: 8118370.93, Expenses: 5916540.27, Net: 2201830.66 },
        { name: 'Feb 25', Revenue: 7073596.25, Expenses: 6099031.96, Net: 974564.29 },
        { name: 'Mar 25', Revenue: 6310386.22, Expenses: 5107016.41, Net: 1203369.81 },
      ];
    }

    if (selectedPeriod === '2026') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return monthNames.map((mName, mIdx) => {
        const monthOrders = orders.filter(o => {
          if (!['delivered', 'completed'].includes(o.status)) return false;
          const d = parseDate(o.createdAt);
          return d && d.getFullYear() === 2026 && d.getMonth() === mIdx;
        });
        const monthExpenses = expenses.filter(e => {
          const d = parseDate(e.date);
          return d && d.getFullYear() === 2026 && d.getMonth() === mIdx;
        });
        const rev = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const exp = monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        return {
          name: `${mName} 26`,
          Revenue: rev,
          Expenses: exp,
          Net: rev - exp,
        };
      });
    }

    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      const monthName = d.toLocaleString('default', { month: 'short' });
      const year = d.getFullYear();
      const monthKey = `${monthName} ${year}`;

      const monthOrders = orders.filter(o => {
        if (!['delivered', 'completed'].includes(o.status)) return false;
        const date = parseDate(o.createdAt);
        return date && `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}` === monthKey;
      });

      const monthExpenses = expenses.filter(e => {
        const date = parseDate(e.date);
        return date && `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}` === monthKey;
      });

      return {
        name: monthName,
        Revenue: monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
        Expenses: monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
      };
    });
  }, [selectedPeriod, orders, expenses]);

  const chartData12Months = React.useMemo(() => {
    if (selectedPeriod === '2025') {
      return [
        { name: 'Jan 25', Revenue: 8118370.93, Expenses: 5916540.27 },
        { name: 'Feb 25', Revenue: 7073596.25, Expenses: 6099031.96 },
        { name: 'Mar 25', Revenue: 6310386.22, Expenses: 5107016.41 },
        { name: 'Apr 25', Revenue: 0, Expenses: 0 },
        { name: 'May 25', Revenue: 0, Expenses: 0 },
        { name: 'Jun 25', Revenue: 0, Expenses: 0 },
        { name: 'Jul 25', Revenue: 0, Expenses: 0 },
        { name: 'Aug 25', Revenue: 0, Expenses: 0 },
        { name: 'Sep 25', Revenue: 0, Expenses: 0 },
        { name: 'Oct 25', Revenue: 0, Expenses: 0 },
        { name: 'Nov 25', Revenue: 0, Expenses: 0 },
        { name: 'Dec 25', Revenue: 0, Expenses: 0 },
      ];
    }

    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      const monthName = d.toLocaleString('default', { month: 'short' });
      const year = d.getFullYear();
      const monthKey = `${monthName} ${year}`;

      const monthOrders = orders.filter(o => {
        if (!['delivered', 'completed'].includes(o.status)) return false;
        const date = parseDate(o.createdAt);
        return date && `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}` === monthKey;
      });

      const monthExpenses = expenses.filter(e => {
        const date = parseDate(e.date);
        return date && `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}` === monthKey;
      });

      return {
        name: monthName,
        Revenue: monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
        Expenses: monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
      };
    });
  }, [selectedPeriod, orders, expenses]);

  const currentMonthDate = new Date();
  const currentMonthName = currentMonthDate.toLocaleString('default', { month: 'short' });
  const currentMonthYear = currentMonthDate.getFullYear();

  const pieData = React.useMemo(() => {
    if (selectedPeriod === '2025') {
      return [
        { name: 'Cost of Goods Sold', value: 17087065.29, isActive: true },
        { name: 'OTHER EXPENSE', value: 42380.50, isActive: true },
        { name: 'Travel Expense', value: 14500.00, isActive: true },
        { name: 'Office Supplies', value: 1265.00, isActive: true },
        { name: 'Freight and Shipping Costs', value: 1230.00, isActive: true },
        { name: 'Ask My Accountant', value: 18862.15, isActive: true },
      ].sort((a, b) => b.value - a.value);
    }

    const currentMonthKey = `${currentMonthName} ${currentMonthYear}`;
    const currentMonthExpenses = filteredExpenses.filter(e => {
      const date = parseDate(e.date);
      return date && `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}` === currentMonthKey;
    });

    const categoryTotals: Record<string, number> = {};
    (currentMonthExpenses.length > 0 ? currentMonthExpenses : filteredExpenses).forEach(e => {
      const cat = e.category || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + Math.abs(e.amount || 0);
    });

    return Object.entries(categoryTotals)
      .map(([name, value]) => {
        const cat = categories.find(c => c.name === name);
        return { 
          name: cat && !cat.isActive ? `${name} (Archived)` : name, 
          value,
          isActive: cat ? cat.isActive : true
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [selectedPeriod, filteredExpenses, categories, currentMonthName, currentMonthYear]);

  const exportPLStatementCSV = () => {
    const csvContent = [
      '"Active Pro B2B Supplies - Audited Profit & Loss Statement"',
      '"Period: January 2025 to March 2025 (FY 2025 Q1)"',
      '""',
      '"Account / Line Item","Jan 25","Feb 25","Mar 25","Total Q1 2025","% of Total Income"',
      '"Ordinary Income/Expense","","","","",""',
      '"Income","","","","",""',
      '"Sales",8357633.01,7275887.33,6555467.70,22188988.04,"103.19%"',
      '"Shipping and Delivery Income",13440.00,12750.00,13650.00,39840.00,"0.19%"',
      '"DISCOUNT",-252702.08,-215941.08,-258731.48,-727374.64,"-3.38%"',
      '"EXPENSES",0.00,900.00,0.00,900.00,"0.00%"',
      '"Total Income",8118370.93,7073596.25,6310386.22,21502353.40,"100.00%"',
      '"Cost of Goods Sold","","","","",""',
      '"Cost of Goods Sold",5904520.17,6100297.72,5082247.40,17087065.29,"79.47%"',
      '"Freight and Shipping Costs",-405.00,-185.00,-640.00,-1230.00,"-0.01%"',
      '"Total COGS",5904115.17,6100112.72,5081607.40,17085835.29,"79.46%"',
      '"Gross Profit",2214255.76,973483.53,1228778.82,4416518.11,"20.54%"',
      '"Expense","","","","",""',
      '"Office Supplies",-230.00,-345.00,-690.00,-1265.00,"-0.01%"',
      '"Travel Expense",2500.00,9000.00,3000.00,14500.00,"0.07%"',
      '"Utilities",0.00,0.00,0.00,0.00,"0.00%"',
      '"Total Expense",2270.00,8655.00,2310.00,13235.00,"0.06%"',
      '"Net Ordinary Income",2211985.76,964828.53,1226468.82,4403283.11,"20.48%"',
      '"Other Income/Expense","","","","",""',
      '"Other Expense","","","","",""',
      '"Ask My Accountant",-2515.17,-13735.76,-2611.22,-18862.15,"-0.09%"',
      '"OTHER EXPENSE",12670.27,4000.00,25710.23,42380.50,"0.20%"',
      '"Total Other Expense",10155.10,-9735.76,23099.01,23518.35,"0.11%"',
      '"Net Other Income",-10155.10,9735.76,-23099.01,-23518.35,"-0.11%"',
      '"Net Income",2201830.66,974564.29,1203369.81,4379764.76,"20.37%"'
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ActivePro_ProfitAndLoss_Q1_2025.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Official Q1 2025 P&L Statement exported to CSV');
  };

  const PIE_COLORS = ['#fdd001', '#fbcc0e', '#1A2332', '#302f2f', '#7a7672', '#a0a0a0'];

  const handleAddExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const orderId = formData.get('orderId') as string;
    
    const dateVal = formData.get('date') as string;
    
    const newExpense = {
      category: formData.get('category'),
      description: formData.get('description'),
      amount: Number(formData.get('amount')),
      date: dateVal ? new Date(dateVal) : serverTimestamp(),
      recordedBy: profile?.uid,
      ...(orderId && orderId !== 'none' ? { orderId } : {})
    };

    try {
      await addDoc(collection(db, 'expenses'), newExpense);
      setIsAddExpenseOpen(false);
      toast.success('Operational expense recorded');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'expenses');
    }
  };

  const handleUpdateExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingExpense) return;

    const formData = new FormData(e.currentTarget);
    const orderId = formData.get('orderId') as string;
    
    const dateVal = formData.get('date') as string;
    
    const updatedExpense = {
      category: formData.get('category'),
      description: formData.get('description'),
      amount: Number(formData.get('amount')),
      date: dateVal ? new Date(dateVal) : editingExpense.date,
      ...(orderId && orderId !== 'none' ? { orderId } : { orderId: null })
    };

    try {
      await updateDoc(doc(db, 'expenses', editingExpense.id), updatedExpense);
      setIsEditExpenseOpen(false);
      setEditingExpense(null);
      toast.success('Expense record updated');
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `expenses/${editingExpense.id}`);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense record? This action is permanent.')) return;
    try {
      // For deletion we reach for a lower-level UI but here we just use native confirm for safety
      const { deleteDoc } = await import('../lib/supabaseAdapter');
      await deleteDoc(doc(db, 'expenses', id));
      toast.success('Expense record deleted');
    } catch (err) {
      handleSupabaseError(err, OperationType.DELETE, `expenses/${id}`);
    }
  };

  const handleAddCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    
    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Category with this name already exists');
      return;
    }

    const isActive = formData.get('status') === 'active';
    const newCategory = {
      name,
      description: formData.get('description'),
      isActive,
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'expenseCategories'), newCategory);
      setIsAddCategoryOpen(false);
      toast.success('Expense category added');
    } catch (err) {
      handleSupabaseError(err, OperationType.CREATE, 'expenseCategories');
    }
  };

  const toggleCategoryStatus = async (category: ExpenseCategory) => {
    const action = category.isActive ? 'archive' : 'activate';
    if (!confirm(`Are you sure you want to ${action} the "${category.name}" category?`)) return;
    
    try {
      await updateDoc(doc(db, 'expenseCategories', category.id), {
        isActive: !category.isActive
      });
      toast.success(`Category ${category.isActive ? 'archived' : 'activated'} successfully`);
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `expenseCategories/${category.id}`);
    }
  };

  const handleEditCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingCategory) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    if (categories.some(c => c.id !== editingCategory.id && c.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Another category with this name already exists');
      return;
    }

    try {
      await updateDoc(doc(db, 'expenseCategories', editingCategory.id), {
        name,
        description
      });
      setIsEditCategoryOpen(false);
      setEditingCategory(null);
      toast.success('Category updated successfully');
    } catch (err) {
      handleSupabaseError(err, OperationType.UPDATE, `expenseCategories/${editingCategory.id}`);
    }
  };

  const activeCategories = categories.filter(c => c.isActive);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    let valA: any;
    let valB: any;

    if (sortKey === 'date') {
      valA = parseDate(a.date)?.getTime() ?? 0;
      valB = parseDate(b.date)?.getTime() ?? 0;
    } else if (sortKey === 'orderId') {
      const orderA = orders.find(o => o.id === a.orderId);
      const orderB = orders.find(o => o.id === b.orderId);
      valA = orderA?.orderNumber || '';
      valB = orderB?.orderNumber || '';
    } else if (sortKey === 'category') {
      valA = a.category || '';
      valB = b.category || '';
    } else if (sortKey === 'amount') {
      valA = a.amount || 0;
      valB = b.amount || 0;
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeading title="Financials" subtitle="Track revenue, expenses, and audited profit & loss statements." />
        
        {/* Period Selector Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground ml-2 mr-1" />
            <Button
              variant={selectedPeriod === '2025' ? 'default' : 'ghost'}
              size="sm"
              className={`h-7 px-3 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                selectedPeriod === '2025' 
                  ? 'bg-[#1A2332] text-white shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => setSelectedPeriod('2025')}
            >
              FY 2025 (Q1 P&L)
            </Button>
            <Button
              variant={selectedPeriod === '2026' ? 'default' : 'ghost'}
              size="sm"
              className={`h-7 px-3 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                selectedPeriod === '2026' 
                  ? 'bg-[#1A2332] text-white shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => setSelectedPeriod('2026')}
            >
              FY 2026 (Live Ops)
            </Button>
            <Button
              variant={selectedPeriod === 'all' ? 'default' : 'ghost'}
              size="sm"
              className={`h-7 px-3 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                selectedPeriod === 'all' 
                  ? 'bg-[#1A2332] text-white shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => setSelectedPeriod('all')}
            >
              All Periods
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 px-3 text-[10px] font-black uppercase tracking-wider border-border hover:bg-muted"
            onClick={exportPLStatementCSV}
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" /> Export P&L (CSV)
          </Button>
        </div>
      </div>

      {/* Financial Health Summary (4 KPIs) */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/20 dark:border-emerald-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
              ₱{displayRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-emerald-600 font-bold mt-1">
              {selectedPeriod === '2025' ? 'Q1 Net Total Income' : 'Confirmed B2B Sales'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500/30 bg-red-50/20 dark:bg-red-950/20 dark:border-red-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-red-600">Total COGS & Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-red-600 dark:text-red-400 tracking-tight">
              ₱{displayExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-red-600 font-bold mt-1">
              {selectedPeriod === '2025' ? 'COGS + SGA + Audit Expenses' : 'SGA & Operational Costs'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/20 dark:border-amber-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Gross Profit</CardTitle>
            <Wallet className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
              ₱{displayGrossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-amber-600 font-bold mt-1">
              {grossMargin}% Gross Margin
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-black tracking-tight ${displayNetProfit >= 0 ? 'text-foreground' : 'text-red-500'}`}>
              ₱{displayNetProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-muted-foreground font-bold mt-1">
              {netMargin}% Net Margin
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Chart */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="pb-2 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xs font-black uppercase tracking-widest text-foreground flex items-center gap-2">
              <BarChartIcon className="w-4 h-4" /> Financial Performance
            </CardTitle>
            <CardDescription className="text-[10px] font-medium text-muted-foreground mt-0.5">Historical Revenue vs Operational Expenditure</CardDescription>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Revenue</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Expenses</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 h-[300px] overflow-hidden">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart 
              data={chartData} 
              margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
              barGap={2}
              barCategoryGap="25%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 700, fill: '#71717a' }} 
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 700, fill: '#71717a' }}
                tickFormatter={(value) => `₱${value >= 1000 ? (value / 1000) + 'k' : value}`}
              />
              <Tooltip 
                cursor={{ fill: 'rgba(253,208,1,0.06)' }}
                contentStyle={{ 
                  borderRadius: '8px', 
                  border: '1px solid #302f2f', 
                  backgroundColor: '#1A2332',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 'bold'
                }}
                formatter={(value: number) => [`₱${value.toLocaleString()}`, '']}
              />
              <Bar 
                dataKey="Revenue" 
                fill="#10b981" 
                radius={[2, 2, 0, 0]} 
              />
              <Bar 
                dataKey="Expenses" 
                fill="#ef4444" 
                radius={[2, 2, 0, 0]} 
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Trajectory Chart */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="pb-2 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xs font-black uppercase tracking-widest text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Financial Trajectory (12 Months)
            </CardTitle>
            <CardDescription className="text-[10px] font-medium text-muted-foreground mt-0.5">Annual Trend of Revenue vs Expenses</CardDescription>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-emerald-500" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Revenue</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-red-500" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Expenses</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 h-[300px] overflow-hidden">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData12Months} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 700, fill: '#71717a' }} 
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 700, fill: '#71717a' }}
                tickFormatter={(value) => `₱${value >= 1000 ? (value / 1000) + 'k' : value}`}
              />
              <Tooltip 
                contentStyle={{ 
                  borderRadius: '8px', 
                  border: '1px solid #302f2f', 
                  backgroundColor: '#1A2332',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 'bold'
                }}
                formatter={(value: number) => [`₱${value.toLocaleString()}`, '']}
              />
              <Line 
                type="monotone" 
                dataKey="Revenue" 
                stroke="#10b981" 
                strokeWidth={3}
                dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
              <Line 
                type="monotone" 
                dataKey="Expenses" 
                stroke="#ef4444" 
                strokeWidth={3}
                dot={{ r: 4, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Profit & Loss Detailed Table */}
        <div className="flex-1 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Button
                variant={activeLedgerTab === 'statement' ? 'default' : 'outline'}
                size="sm"
                className={`h-8 gap-2 px-3 text-[10px] font-black uppercase tracking-wider transition-all ${
                  activeLedgerTab === 'statement' ? 'bg-[#1A2332] text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveLedgerTab('statement')}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" /> Audited P&L Statement (Q1 2025)
              </Button>
              <Button
                variant={activeLedgerTab === 'ledger' ? 'default' : 'outline'}
                size="sm"
                className={`h-8 gap-2 px-3 text-[10px] font-black uppercase tracking-wider transition-all ${
                  activeLedgerTab === 'ledger' ? 'bg-[#1A2332] text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveLedgerTab('ledger')}
              >
                <FileText className="w-3.5 h-3.5" /> Itemized Expense Ledger
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeLedgerTab === 'statement' ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 bg-emerald-50/40 text-[9px] font-black uppercase tracking-widest px-2.5 py-1">
                    Audited Closed Period
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-3 text-[10px] font-black uppercase tracking-wider"
                    onClick={exportPLStatementCSV}
                  >
                    <Download className="w-3 h-3 text-emerald-600" /> Export CSV
                  </Button>
                </div>
              ) : (
                <>
                  <Dialog open={isManageCategoriesOpen} onOpenChange={setIsManageCategoriesOpen}>
                <DialogTrigger render={
                  <Button variant="outline" className="h-7 gap-2 px-3 text-[10px] font-bold uppercase tracking-tight">
                    <Settings className="w-3 h-3" /> Manage Categories
                  </Button>
                } />
                <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Expense Category Management</DialogTitle>
                    <DialogDescription>Add, edit, or archive operational expenditure classifications.</DialogDescription>
                  </DialogHeader>
                  
                  <div className="flex-1 overflow-y-auto py-4 space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Inventory of Categories</h4>
                      <Dialog open={isAddCategoryOpen} onOpenChange={setIsAddCategoryOpen}>
                        <DialogTrigger render={
                          <Button size="sm" className="h-7 gap-2 px-3 text-[10px] font-bold uppercase">
                            <Plus className="w-3 h-3" /> Create New
                          </Button>
                        } />
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Add Expense Category</DialogTitle>
                          </DialogHeader>
                          <form onSubmit={handleAddCategory} className="space-y-4 pt-2">
                            <div className="space-y-2">
                              <Label htmlFor="name">Category Name</Label>
                              <Input id="name" name="name" required placeholder="e.g., Marketing, Logistics..." />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="desc">Description (Optional)</Label>
                              <Input id="desc" name="description" placeholder="Brief purpose..." />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="status">Initial Status</Label>
                              <Select name="status" defaultValue="active">
                                <SelectTrigger id="status">
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="active">Active</SelectItem>
                                  <SelectItem value="archived">Archived</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <DialogFooter>
                              <Button type="submit" className="w-full">Save Category</Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>

                      <div className="border rounded-2xl overflow-hidden bg-card border-border">
                        <Table>
                          <TableHeader className="bg-muted/50 border-b border-border">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="text-[10px] font-black uppercase tracking-widest py-4 pl-6 text-muted-foreground">Classification Details</TableHead>
                              <TableHead className="text-[10px] font-black uppercase tracking-widest py-4 text-center text-muted-foreground">Current Status</TableHead>
                              <TableHead className="text-[10px] font-black uppercase tracking-widest py-4 pr-6 text-right text-muted-foreground">Management</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {categories.map((cat) => (
                              <TableRow key={cat.id} className="group hover:bg-muted/30 border-b border-border last:border-0 transition-colors">
                                <TableCell className="pl-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-black text-foreground uppercase tracking-tight">{cat.name}</span>
                                    {cat.description && (
                                      <span className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5 line-clamp-1 max-w-[280px]">
                                        {cat.description}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center py-4">
                                  <Badge 
                                    className={`text-[9px] font-black uppercase tracking-widest rounded-md px-2 py-0.5 shadow-none border-none ${
                                      cat.isActive 
                                        ? "bg-emerald-100 text-emerald-700" 
                                        : "bg-zinc-100 text-zinc-400"
                                    }`}
                                  >
                                    {cat.isActive ? 'Active' : 'Archived'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="pr-6 py-4">
                                  <div className="flex justify-end items-center gap-1.5 font-sans">
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="h-8 px-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground shadow-none" 
                                      onClick={() => {
                                        setEditingCategory(cat);
                                        setIsEditCategoryOpen(true);
                                      }}
                                    >
                                      Edit
                                    </Button>
                                    <Separator orientation="vertical" className="h-3 bg-border" />
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className={`h-8 px-2 text-[10px] font-black uppercase tracking-widest shadow-none ${
                                        cat.isActive 
                                          ? "text-red-400 hover:text-red-600 hover:bg-red-50" 
                                          : "text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50"
                                      }`} 
                                      onClick={() => toggleCategoryStatus(cat)}
                                    >
                                      {cat.isActive ? 'Archive' : 'Activate'}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          {categories.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center py-8 text-xs italic text-zinc-400">
                                No categories defined.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <Dialog open={isEditCategoryOpen} onOpenChange={(open) => {
                      setIsEditCategoryOpen(open);
                      if (!open) setEditingCategory(null);
                    }}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Edit Category</DialogTitle>
                        </DialogHeader>
                        {editingCategory && (
                          <form onSubmit={handleEditCategory} className="space-y-4 pt-2">
                            <div className="space-y-2">
                              <Label htmlFor="edit-name">Category Name</Label>
                              <Input id="edit-name" name="name" defaultValue={editingCategory.name} required />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="edit-desc">Description (Optional)</Label>
                              <Input id="edit-desc" name="description" defaultValue={editingCategory.description} />
                            </div>
                            <DialogFooter>
                              <Button type="submit" className="w-full">Update Classification</Button>
                            </DialogFooter>
                          </form>
                        )}
                      </DialogContent>
                    </Dialog>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={isAddCategoryOpen} onOpenChange={setIsAddCategoryOpen}>
                <DialogTrigger render={
                  <Button variant="outline" className="h-7 gap-2 px-3 border-2 border-zinc-200 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-900 hover:text-white transition-all">
                    <Plus className="w-3 h-3" /> New Category
                  </Button>
                } />
                <DialogContent className="rounded-[2rem]">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-black uppercase tracking-tighter">Add Expense Category</DialogTitle>
                    <DialogDescription className="text-zinc-500 font-medium">Define a new classification for operational expenditure.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleAddCategory} className="space-y-6 pt-4 font-sans">
                    <div className="space-y-2">
                      <Label htmlFor="cat-name" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Category Name</Label>
                      <Input id="cat-name" name="name" required placeholder="e.g., Marketing, Logistics..." className="rounded-xl border-2 border-zinc-100 focus:border-zinc-900 transition-all h-12" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cat-desc" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Description (Optional)</Label>
                      <Input id="cat-desc" name="description" placeholder="Briefly describe the purpose of this category..." className="rounded-xl border-2 border-zinc-100 focus:border-zinc-900 transition-all h-12" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cat-status" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Initial Status</Label>
                      <Select name="status" defaultValue="active">
                        <SelectTrigger id="cat-status" className="rounded-xl border-2 border-zinc-100 h-12">
                          <SelectValue placeholder="Select initial state" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="active" className="text-xs font-bold uppercase tracking-widest">Active/Live</SelectItem>
                          <SelectItem value="archived" className="text-xs font-bold uppercase tracking-widest">Archived/Draft</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter className="pt-4">
                       <Button type="submit" className="w-full h-14 bg-[#1A2332] text-white font-black uppercase tracking-widest text-xs rounded-2xl">
                        Register Category <Plus className="w-4 h-4 ml-2" />
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              <Dialog open={isAddExpenseOpen} onOpenChange={setIsAddExpenseOpen}>
                <DialogTrigger render={
                   <Button className="h-7 gap-2 px-3 bg-[#1A2332] text-white rounded-lg inline-flex items-center justify-center text-xs font-black uppercase tracking-widest transition-all hover:bg-[#1A2332]/90">
                    <Plus className="w-3 h-3" /> Record Entry
                  </Button>
                } />
                <DialogContent className="rounded-[2rem] max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-black uppercase tracking-tighter">Record Operational Expense</DialogTitle>
                    <DialogDescription className="text-zinc-500 font-medium">Map local shop expenses to the centralized financial reporting system.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleAddExpense} className="space-y-5 pt-4 font-sans">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="expense-category" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Category</Label>
                        <Select name="category" required>
                          <SelectTrigger id="expense-category" className="rounded-xl border-2 border-border h-11">
                            <SelectValue placeholder="Classification" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {activeCategories.map(cat => (
                              <SelectItem key={cat.id} value={cat.name} className="text-xs font-bold uppercase tracking-widest">{cat.name}</SelectItem>
                            ))}
                            {activeCategories.length === 0 && (
                              <div className="p-3 text-[10px] text-zinc-400 italic font-medium uppercase tracking-tighter">No active categories.</div>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="expense-date" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Expense Date</Label>
                        <Input id="expense-date" name="date" type="date" defaultValue={new Date().toISOString().split('T')[0]} required className="rounded-xl border-2 border-border h-11" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="expense-amount" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Amount (₱)</Label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-black text-sm">₱</span>
                        <Input id="expense-amount" name="amount" type="number" step="0.01" required placeholder="0.00" className="rounded-xl border-2 border-border h-12 pl-8 focus:border-zinc-900 transition-all font-black" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="expense-description" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Description</Label>
                      <Input id="expense-description" name="description" placeholder="Operational details..." className="rounded-xl border-2 border-border h-12 focus:border-zinc-900 transition-all" />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="expense-order" className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Linked Order (Optional)</Label>
                      <Select name="orderId">
                        <SelectTrigger id="expense-order" className="w-full rounded-xl border-2 border-border h-11">
                          <SelectValue placeholder="No order linked" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="none" className="text-xs font-bold uppercase tracking-widest">None / General</SelectItem>
                          {orders
                            .sort((a, b) => b.orderNumber.localeCompare(a.orderNumber))
                            .map(order => (
                              <SelectItem key={order.id} value={order.id} className="text-xs font-bold uppercase tracking-widest">
                                {order.orderNumber} - {order.clientName}
                              </SelectItem>
                            ))
                          }
                        </SelectContent>
                      </Select>
                      <p className="text-[9px] text-zinc-400 font-medium italic">Link this expense to a specific B2B order for job-costing.</p>
                    </div>

                    <DialogFooter className="pt-2">
                       <Button type="submit" className="w-full h-14 bg-[#1A2332] text-white font-black uppercase tracking-widest text-xs rounded-2xl" disabled={activeCategories.length === 0}>
                        Post to Ledger <ArrowUpRight className="w-4 h-4 ml-2" />
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
                </>
              )}
            </div>
          </div>

          {activeLedgerTab === 'statement' ? (
            <div className="bg-background border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/40 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-foreground">
                    Active Pro B2B Supplies — Profit and Loss Statement
                  </h4>
                  <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    January through March 2025 (FY 2025 Q1 Official Audited Statement)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-bold border-none">
                    Audited Closed Period
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-[10px] font-black uppercase tracking-wider"
                    onClick={exportPLStatementCSV}
                  >
                    <Download className="w-3 h-3 text-emerald-600" /> CSV
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto w-full">
                <Table>
                  <TableHeader className="bg-muted/70">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground py-3 pl-6 min-w-[260px]">
                        Account / Line Item
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-right text-muted-foreground py-3 min-w-[130px]">
                        Jan 25
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-right text-muted-foreground py-3 min-w-[130px]">
                        Feb 25
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-right text-muted-foreground py-3 min-w-[130px]">
                        Mar 25
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-right text-foreground py-3 font-bold min-w-[150px] bg-muted/90">
                        Total Q1 2025
                      </TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-widest text-right text-muted-foreground py-3 pr-6 min-w-[110px]">
                        % of Income
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PL_STATEMENT_ROWS.map((row, idx) => {
                      if (row.isHeader) {
                        return (
                          <TableRow key={idx} className="bg-muted/40 border-y border-border hover:bg-muted/50">
                            <TableCell colSpan={6} className="py-2.5 pl-6 font-black text-xs uppercase tracking-widest text-foreground">
                              {row.section}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      if (row.isSubheader) {
                        return (
                          <TableRow key={idx} className="hover:bg-transparent border-none">
                            <TableCell colSpan={6} className="py-2 pl-8 font-bold text-xs uppercase tracking-wider text-muted-foreground">
                              {row.section}
                            </TableCell>
                          </TableRow>
                        );
                      }

                      const isHighlightEmerald = row.highlight === 'emerald';
                      const isHighlightRose = row.highlight === 'rose';
                      const isHighlightGold = row.highlight === 'gold';

                      return (
                        <TableRow 
                          key={idx} 
                          className={`border-b border-border/60 transition-colors ${
                            row.isFinalNetIncome 
                              ? 'bg-amber-500/10 hover:bg-amber-500/15 font-black border-t-2 border-b-2 border-amber-500/50' 
                              : row.isGrandTotal 
                              ? 'bg-muted/50 font-black' 
                              : row.isTotal 
                              ? 'bg-muted/30 font-bold' 
                              : 'hover:bg-muted/20'
                          }`}
                        >
                          <TableCell className={`py-2.5 ${row.indent ? 'pl-12 text-xs font-medium text-foreground' : 'pl-8 font-bold text-xs text-foreground'}`}>
                            {row.name}
                          </TableCell>
                          <TableCell className={`py-2.5 text-right text-xs ${row.isFinalNetIncome || row.isTotal || row.isGrandTotal ? 'font-bold' : 'text-muted-foreground font-mono'}`}>
                            {formatCurrency(row.jan)}
                          </TableCell>
                          <TableCell className={`py-2.5 text-right text-xs ${row.isFinalNetIncome || row.isTotal || row.isGrandTotal ? 'font-bold' : 'text-muted-foreground font-mono'}`}>
                            {formatCurrency(row.feb)}
                          </TableCell>
                          <TableCell className={`py-2.5 text-right text-xs ${row.isFinalNetIncome || row.isTotal || row.isGrandTotal ? 'font-bold' : 'text-muted-foreground font-mono'}`}>
                            {formatCurrency(row.mar)}
                          </TableCell>
                          <TableCell className={`py-2.5 text-right text-xs font-black bg-muted/20 ${
                            isHighlightEmerald 
                              ? 'text-emerald-600 dark:text-emerald-400' 
                              : isHighlightRose 
                              ? 'text-red-600 dark:text-red-400' 
                              : isHighlightGold 
                              ? 'text-amber-600 dark:text-amber-400 text-sm' 
                              : 'text-foreground'
                          }`}>
                            {formatCurrency(row.total)}
                          </TableCell>
                          <TableCell className="py-2.5 pr-6 text-right text-xs font-semibold text-muted-foreground">
                            {row.pct}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <>
          {/* Mobile Card View */}
          <div className="lg:hidden space-y-3 mb-8">
            {sortedExpenses.map((e) => {
              const linkedOrder = e.orderId ? orders.find(o => o.id === e.orderId) : null;
              return (
                <div key={e.id} className="bg-background border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Badge variant="outline" className="text-[9px] font-black uppercase bg-muted border-border text-muted-foreground mb-1">
                        {e.category}
                      </Badge>
                      {linkedOrder && (
                        <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-tighter">
                          Order: {linkedOrder.orderNumber}
                        </p>
                      )}
                      <p className="text-xs font-semibold text-foreground truncate">{e.description}</p>
                    </div>
                    <span className="shrink-0 text-sm font-black text-red-600">-₱{e.amount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {typeof e.date?.toDate === 'function' ? e.date.toDate().toLocaleDateString() : 'N/A'}
                    </span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={() => { setEditingExpense(e); setIsEditExpenseOpen(true); }}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        onClick={() => handleDeleteExpense(e.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {expenses.length === 0 && (
              <div className="text-center py-8 text-zinc-400 text-xs italic">No expense records found.</div>
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block bg-background border border-border rounded-xl overflow-hidden mb-8">
            <div className="overflow-x-auto w-full">
              <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead 
                        className="text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-muted transition-colors min-w-[100px]"
                        onClick={() => toggleSort('date')}
                      >
                        <div className="flex items-center gap-1">
                          Date {sortKey === 'date' ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-muted transition-colors min-w-[120px]"
                        onClick={() => toggleSort('category')}
                      >
                        <div className="flex items-center gap-1">
                          Category {sortKey === 'category' ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-[10px] font-bold uppercase tracking-widest cursor-pointer hover:bg-muted transition-colors min-w-[200px]"
                        onClick={() => toggleSort('orderId')}
                      >
                        <div className="flex items-center gap-1">
                          Order / Desc {sortKey === 'orderId' ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-[10px] font-bold uppercase tracking-widest text-right cursor-pointer hover:bg-muted transition-colors min-w-[100px]"
                        onClick={() => toggleSort('amount')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Amount {sortKey === 'amount' ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                        </div>
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right min-w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedExpenses.map((e) => {
                      const linkedOrder = e.orderId ? orders.find(o => o.id === e.orderId) : null;
                      return (
                        <TableRow key={e.id} className="group">
                          <TableCell className="text-xs text-muted-foreground font-medium">
                            {typeof e.date?.toDate === 'function' ? e.date.toDate().toLocaleDateString() : 'N/A'}
                          </TableCell>
                          <TableCell>
                             <Badge variant="outline" className="text-[9px] font-black uppercase bg-muted border-border text-muted-foreground">
                              {e.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-semibold text-foreground max-w-[250px]">
                            <div className="flex flex-col">
                              {linkedOrder && (
                                <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-tighter mb-0.5">
                                  Linked Order: {linkedOrder.orderNumber}
                                </span>
                              )}
                              <span className="truncate">{e.description}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-black text-xs text-red-600">
                            -₱{e.amount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted" 
                                onClick={() => {
                                  setEditingExpense(e);
                                  setIsEditExpenseOpen(true);
                                }}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10" 
                                onClick={() => handleDeleteExpense(e.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  {expenses.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center h-24 text-zinc-400 text-xs italic">
                        No expense records found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
            </>
          )}

          <Dialog open={isEditExpenseOpen} onOpenChange={setIsEditExpenseOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Expense Record</DialogTitle>
                <DialogDescription>Modify existing financial expenditure data.</DialogDescription>
              </DialogHeader>
              {editingExpense && (
                <form onSubmit={handleUpdateExpense} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-expense-category">Category</Label>
                    <Select name="category" defaultValue={editingExpense.category}>
                      <SelectTrigger id="edit-expense-category">
                        <SelectValue placeholder="Select classification" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map(cat => (
                          <SelectItem 
                            key={cat.id} 
                            value={cat.name}
                            disabled={!cat.isActive && editingExpense.category !== cat.name}
                          >
                            {cat.name} {!cat.isActive && '(Archived)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-expense-date">Expense Date</Label>
                    <Input 
                      id="edit-expense-date" 
                      name="date" 
                      type="date" 
                      defaultValue={
                        editingExpense.date 
                          ? (typeof editingExpense.date.toDate === 'function' 
                              ? editingExpense.date.toDate() 
                              : new Date(editingExpense.date as any)
                            ).toISOString().split('T')[0]
                          : new Date().toISOString().split('T')[0]
                      } 
                      required 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-expense-amount">Amount (₱)</Label>
                    <Input id="edit-expense-amount" name="amount" type="number" step="0.01" defaultValue={editingExpense.amount} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-expense-description">Description</Label>
                    <Input id="edit-expense-description" name="description" defaultValue={editingExpense.description} placeholder="Details about the expense..." />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-expense-orderId">Linked Order (Optional)</Label>
                    <Select name="orderId" defaultValue={editingExpense.orderId || 'none'}>
                      <SelectTrigger id="edit-expense-orderId" className="w-full">
                        <SelectValue placeholder="No order linked" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None / General Expense</SelectItem>
                        {orders
                          .sort((a, b) => b.orderNumber.localeCompare(a.orderNumber))
                          .map(order => (
                            <SelectItem key={order.id} value={order.id}>
                              {order.orderNumber} - {order.clientName}
                            </SelectItem>
                          ))
                        }
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button type="submit" className="w-full">Save Changes</Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

        </div>

        {/* Financial Policy & Compliance Sidebar */}
        <div className="w-full lg:w-80 space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-[#fdd001]" />
                <CardTitle className="text-xs font-black uppercase tracking-widest text-foreground">Expense Allocation</CardTitle>
              </div>
              <CardDescription className="text-[10px] font-medium text-muted-foreground mt-0.5">{currentMonthName} {currentMonthYear} Distribution</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="h-[200px] w-full">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                         contentStyle={{ 
                           borderRadius: '8px', 
                           border: '1px solid #1A2332', 
                           backgroundColor: '#1A2332',
                           color: '#fdd001',
                           fontSize: '11px',
                           fontWeight: 'bold'
                         }}
                         formatter={(value: number, name: string) => {
                           const total = pieData.reduce((acc, curr) => acc + curr.value, 0);
                           const percent = ((value / total) * 100).toFixed(1);
                           return [`₱${value.toLocaleString()} (${percent}%)`, name];
                         }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                   <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground italic">
                    No expense data for this month.
                  </div>
                )}
              </div>
              
              {pieData.length > 0 && (
                <div className="mt-4 space-y-2">
                  {pieData.slice(0, 4).map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} 
                        />
                        <span className="text-[10px] font-bold text-muted-foreground truncate max-w-[120px]">{item.name}</span>
                      </div>
                       <span className="text-[10px] font-black text-foreground">₱{item.value.toLocaleString()}</span>
                    </div>
                  ))}
                  {pieData.length > 4 && (
                    <p className="text-[9px] text-muted-foreground font-medium text-center pt-1">+{pieData.length - 4} more categories</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[#1A2332] bg-[#1A2332] text-white overflow-hidden shadow-sm">
             <div className="p-4 space-y-2">
               <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">System Report Generator</h4>
               <p className="text-xs text-zinc-300 leading-normal">
                 Export the audited Q1 2025 Profit & Loss statement for external CPA, executive, and regulatory audit.
               </p>
             </div>
             <Button className="w-full rounded-none h-12 bg-white text-black hover:bg-zinc-200 font-bold tracking-tight gap-2" onClick={exportPLStatementCSV}>
               <Download className="w-4 h-4 text-emerald-700" />
               Generate Monthly P&L (CSV)
             </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
