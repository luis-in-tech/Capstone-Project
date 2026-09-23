import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Warehouse, LogIn, ArrowLeft, Mail, Lock, Eye, EyeOff, UserPlus, HelpCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

export function Auth() {
  const { signIn, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const location = useLocation();
  const [isSignUp, setIsSignUp] = useState(location.pathname === '/signup');
  const [isResetMode, setIsResetMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Please provide an email address.');
      return;
    }

    if (!isResetMode && !password) {
      setError('Please provide a password.');
      return;
    }

    setIsLoading(true);
    try {
      if (isResetMode) {
        await resetPassword(email);
        setIsResetMode(false);
      } else if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setIsResetMode(false);
    setPassword('');
    setError('');
  };

  const toggleReset = () => {
    setIsResetMode(!isResetMode);
    setIsSignUp(false);
    setError('');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover z-0"
      >
        <source src="/0722.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-background/10 z-0"></div>
      <Card className="w-full max-w-md relative z-10 shadow-2xl overflow-hidden border-border bg-card/85 backdrop-blur-sm">

        
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Logo" className="h-16 w-auto object-contain drop-shadow-md" />
          </div>
          <CardTitle className="text-2xl font-black uppercase tracking-tighter">
            {isResetMode ? 'Recover Identity' : isSignUp ? 'Account Sign Up' : 'System Access'}
          </CardTitle>
          {isResetMode && (
            <CardDescription className="text-muted-foreground font-medium text-xs">
              Initiate credential reset protocol via communication node.
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="name@corp.activepro" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background border-input pl-10 h-11 text-sm rounded-xl focus-visible:ring-ring focus-visible:border-ring transition-all font-medium"
                />
              </div>
            </div>

            {!isResetMode && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Password</Label>
                  {!isSignUp && (
                    <button 
                      type="button"
                      onClick={toggleReset}
                      className="text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <Input 
                    id="password" 
                    type={showPassword ? 'text' : 'password'} 
                    placeholder="••••••••" 
                    required 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-background border-input pl-10 pr-10 h-11 text-sm rounded-xl focus-visible:ring-ring focus-visible:border-ring transition-all font-mono"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="text-red-500 text-xs font-black uppercase tracking-widest text-center animate-in fade-in slide-in-from-top-1">
                {error}
              </div>
            )}

            <Button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-gold hover:bg-gold-alt text-navy h-12 text-xs font-black uppercase tracking-[0.1em] rounded-xl shadow-xl group"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-navy border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  {isResetMode ? 'Send Reset Link' : isSignUp ? 'Sign Up' : 'Login'}
                  <LogIn className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </form>

          {!isResetMode && (
            <button
              type="button"
              onClick={toggleMode}
              className="w-full text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              <span className="text-foreground underline underline-offset-2">
                {isSignUp ? 'Login' : 'Sign Up'}
              </span>
            </button>
          )}

          {isResetMode && (
            <Button 
              variant="ghost" 
              onClick={toggleReset}
              className="w-full text-muted-foreground hover:text-foreground text-[10px] font-black uppercase tracking-widest"
            >
              <ArrowLeft className="w-3 h-3 mr-2" /> Back to Authentication
            </Button>
          )}
        </CardContent>


      </Card>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}} />
    </div>
  );
}

