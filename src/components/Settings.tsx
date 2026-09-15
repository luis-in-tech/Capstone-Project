import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Settings as SettingsIcon, 
  User, 
  Bell, 
  Shield, 
  Database, 
  Users, 
  Cpu, 
  ToggleLeft, 
  ToggleRight, 
  CheckCircle2,
  Edit2,
  Image as ImageIcon,
  CheckCircle,
  AlertCircle,
  Sun,
  Moon
} from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { motion, AnimatePresence } from 'motion/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function Settings() {
  const { profile, updateProfileData } = useAuth();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState(true);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  const isAdmin = profile?.role === 'admin';

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;

    await updateProfileData({
      firstName,
      lastName
    });
    setIsEditProfileOpen(false);
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tighter text-foreground uppercase">System Settings</h2>
          <p className="text-muted-foreground font-medium">Manage your personal preferences and baseline configurations.</p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-center bg-muted/50 p-1.5 rounded-2xl border border-border">
          <Button 
            variant={theme === 'light' ? 'default' : 'ghost'} 
            size="sm" 
            onClick={() => setTheme('light')}
            className={`h-8 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${theme === 'light' ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Sun className="w-3.5 h-3.5 mr-2" /> Light
          </Button>
          <Button 
            variant={theme === 'dark' ? 'default' : 'ghost'} 
            size="sm" 
            onClick={() => setTheme('dark')}
            className={`h-8 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${theme === 'dark' ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Moon className="w-3.5 h-3.5 mr-2" /> Dark
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border overflow-hidden group hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-foreground" />
                <CardTitle className="text-xs font-black uppercase tracking-widest">Account Profile</CardTitle>
              </div>
              <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
                <DialogTrigger render={
                  <Button variant="ghost" size="sm" className="h-8 gap-2 text-[10px] font-black uppercase tracking-widest hover:bg-foreground hover:text-background dark:hover:bg-foreground dark:hover:text-background transition-all">
                    <Edit2 className="w-3 h-3" /> Edit Profile
                  </Button>
                } />
                <DialogContent className="rounded-[2.5rem] p-8">
                  <DialogHeader className="mb-6">
                    <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Edit Identity</DialogTitle>
                    <DialogDescription className="text-muted-foreground font-medium">Update your system identification and avatar node.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleUpdateProfile} className="space-y-6 font-sans">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">First Name</Label>
                        <Input id="firstName" name="firstName" defaultValue={profile?.firstName} required className="rounded-xl border-2 border-border h-12 focus:border-primary transition-all font-bold" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Last Name</Label>
                        <Input id="lastName" name="lastName" defaultValue={profile?.lastName} required className="rounded-xl border-2 border-border h-12 focus:border-primary transition-all font-bold" />
                      </div>
                    </div>

                    <DialogFooter className="pt-4">
                      <Button type="submit" className="w-full h-14 bg-primary text-primary-foreground font-black uppercase tracking-widest text-xs rounded-2xl group">
                       Confirm <CheckCircle className="w-4 h-4 ml-2 group-hover:scale-110 transition-transform" />
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <CardDescription className="text-xs font-medium">System identification and access metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-muted border-2 border-border overflow-hidden flex-shrink-0">
                {profile?.photoUrl ? (
                  <img src={profile.photoUrl} alt={profile.displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center font-black text-xl text-muted-foreground">
                    {profile?.displayName?.charAt(0)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Authenticated Identity</p>
                  <Badge variant="outline" className="text-[9px] uppercase font-black tracking-widest border-border py-0 h-4">{profile?.role}</Badge>
                </div>
                <p className="text-xl font-black text-foreground truncate tracking-tight leading-none">{profile?.displayName || 'N/A'}</p>
                <p className="text-xs font-medium text-muted-foreground mt-1">{profile?.email || 'N/A'}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted/40 p-3 rounded-xl border border-border">
                <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">First Name</p>
                <p className="text-xs font-bold text-foreground">{profile?.firstName || '—'}</p>
              </div>
              <div className="bg-muted/40 p-3 rounded-xl border border-border">
                <p className="text-[9px] font-black uppercase text-muted-foreground mb-1">Last Name</p>
                <p className="text-xs font-bold text-foreground">{profile?.lastName || '—'}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-dashed border-border italic text-[10px] text-muted-foreground font-medium flex items-center justify-between">
              <span>Metadata synced via regional cluster.</span>
              <div className="flex items-center gap-1.5 text-emerald-500 font-bold">
                <CheckCircle2 className="w-3 h-3" /> Encrypted
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border opacity-60 grayscale-[0.3]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground">Notifications</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/40 p-4 rounded-xl border border-border">
               <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Notice</p>
               <p className="text-xs text-muted-foreground font-medium leading-relaxed">Alert thresholds are currently controlled at the organizational level to maintain system-wide sync stability.</p>
            </div>
          </CardContent>
        </Card>
      </div>




    </div>
  );
}
