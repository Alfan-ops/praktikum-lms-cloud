import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { 
  GraduationCap, 
  UserCog, 
  Eye, 
  EyeOff,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from './AuthProvider';
import { projectId, publicAnonKey } from '../../utils/supabase/info';
import itbLogo from '../../assets/itb-logo.png';

export function LoginForm() {
  const [loginType, setLoginType] = useState<'admin' | 'student'>('student');
  const [activeTab, setActiveTab] = useState('login');
  
  // Separate state for login and signup
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupNim, setSignupNim] = useState('');
  const [signupDepartment, setSignupDepartment] = useState(''); // For admin
  
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { signIn, signUp } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: loginError } = await signIn(loginEmail, loginPassword);
    
    if (loginError) {
      setError(loginError);
    }
    // On success, AuthProvider will handle redirect
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const userData = loginType === 'admin' 
      ? { full_name: signupName, role: 'admin', department: signupDepartment, nim: null } // Send null for nim
      : { full_name: signupName, role: 'student', nim: signupNim, department: null }; // Send null for dept

    // 1. Call your custom sign-up function
    const { error: signUpError } = await signUp(signupEmail, signupPassword, userData);
    
    if (signUpError) {
      setError(signUpError);
      setLoading(false);
      return;
    }
    
    // --- *** THIS IS THE FIX FOR AUTO-LOGIN *** ---
    // 2. If signup was successful, now sign the user in
    const { error: signInError } = await signIn(signupEmail, signupPassword);
    
    if (signInError) {
      // Account was created, but auto-login failed.
      // This is better than a generic error.
      setError("Account created, but auto-login failed. Please go to Login tab.");
      setActiveTab('login');
    }
    // On success, AuthProvider handles redirect
    // --- *** END OF FIX *** ---
    
    setLoading(false);
  };

  const handleDemoLogin = (type: 'admin' | 'student') => {
    if (type === 'admin') {
      setLoginEmail('admin@itb.ac.id');
      setLoginPassword('admin123');
    } else {
      setLoginEmail('student@itb.ac.id');
      setLoginPassword('student123');
    }
    setLoginType(type);
    setActiveTab('login');
  };

  const initializeDemoUsers = async () => {
    try {
      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a2395876/auth/init-demo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        }
      });
      const result = await response.json();
      console.log('Demo users initialized:', result);
    } catch (error) {
      console.error('Failed to initialize demo users:', error);
    }
  };

  React.useEffect(() => {
    initializeDemoUsers();
  }, []);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center">
              {/* Make sure this logo path is correct */}
              <img src={itbLogo} alt="ITB Logo" className="w-10 h-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Lab Platform</h1>
              <p className="text-sm text-muted-foreground">Institut Teknologi Bandung</p>
            </div>
          </div>
          <p className="text-muted-foreground">
            Cloud-based Laboratory Learning Management System
          </p>
        </div>

        {/* Login/Signup Tabs */}
        <Card>
          <CardHeader>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {/* Login Tab */}
              <TabsContent value="login" className="space-y-4">
                <div className="text-center">
                  <CardTitle className="text-xl">Welcome Back</CardTitle>
                  <CardDescription>Sign in to your account</CardDescription>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={loginType === 'student' ? 'default' : 'outline'}
                    onClick={() => setLoginType('student')}
                    className="flex-1"
                  >
                    <GraduationCap className="w-4 h-4 mr-2" />
                    Student
                  </Button>
                  <Button
                    type="button"
                    variant={loginType === 'admin' ? 'default' : 'outline'}
                    onClick={() => setLoginType('admin')}
                    className="flex-1"
                  >
                    <UserCog className="w-4 h-4 mr-2" />
                    Admin
                  </Button>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder={loginType === 'admin' ? 'admin@itb.ac.id' : 'student@itb.ac.id'}
                      value={loginEmail} // Use login state
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={loginPassword} // Use login state
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign in'}
                  </Button>
                </form>

                <div className="mt-6 pt-4 border-t">
                  <p className="text-sm text-muted-foreground text-center mb-3">
                    Try Demo:
                  </p>
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-sm"
                      onClick={() => handleDemoLogin('student')}
                    >
                      <GraduationCap className="w-4 h-4 mr-2" />
                      Student Demo
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-sm"
                      onClick={() => handleDemoLogin('admin')}
                    >
                      <UserCog className="w-4 h-4 mr-2" />
                      Admin Demo
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Sign Up Tab */}
              <TabsContent value="signup" className="space-y-4">
                <div className="text-center">
                  <CardTitle className="text-xl">Create Account</CardTitle>
                  <CardDescription>Join the Lab Platform</CardDescription>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={loginType === 'student' ? 'default' : 'outline'}
                    onClick={() => setLoginType('student')}
                    className="flex-1"
                  >
                    <GraduationCap className="w-4 h-4 mr-2" />
                    Student
                  </Button>
                  <Button
                    type="button"
                    variant={loginType === 'admin' ? 'default' : 'outline'}
                    onClick={() => setLoginType('admin')}
                    className="flex-1"
                  >
                    <UserCog className="w-4 h-4 mr-2" />
                    Admin
                  </Button>
                </div>

                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="Enter your full name"
                      value={signupName} // Use signup state
                      onChange={(e) => setSignupName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder={loginType === 'admin' ? 'admin@itb.ac.id' : 'student@itb.ac.id'}
                      value={signupEmail} // Use signup state
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                    />
                  </div>

                  {loginType === 'student' ? (
                    <div className="space-y-2">
                      <Label htmlFor="signup-nim">NIM</Label>
                      <Input
                        id="signup-nim"
                        type="text"
                        placeholder="1301210001"
                        value={signupNim} // Use signup state
                        onChange={(e) => setSignupNim(e.target.value)}
                        required
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="signup-department">Department</Label>
                      <Input
                        id="signup-department"
                        type="text"
                        placeholder="Teknik Elektro"
                        value={signupDepartment} // Use signup state
                        onChange={(e) => setSignupDepartment(e.target.value)}
                        required
                      />
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Create a password (min 6 chars)"
                        value={signupPassword} // Use signup state
                        onChange={(e) => setSignupPassword(e.target.value)}
                        required
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Creating account...' : 'Create account'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>© 2024 Institut Teknologi Bandung</p>
          <p>Laboratory Management Platform</p>
        </div>
      </div>
    </div>
  );
}