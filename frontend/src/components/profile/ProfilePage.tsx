import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { 
  User, 
  Mail, 
  Calendar, 
  GraduationCap, 
  Building,
  Edit,
  Save,
  X,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

export function ProfilePage() {
  const { user, updateProfile, signOut } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: user?.user_metadata?.name || '',
    nim: user?.user_metadata?.nim || '',
    semester: user?.user_metadata?.semester || '',
    major: user?.user_metadata?.major || '',
  });

  const handleSave = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    const { error: updateError } = await updateProfile(formData);
    
    if (updateError) {
      setError(updateError);
    } else {
      setSuccess('Profile updated successfully!');
      setIsEditing(false);
    }
    
    setLoading(false);
  };

  const handleCancel = () => {
    setFormData({
      name: user?.user_metadata?.name || '',
      nim: user?.user_metadata?.nim || '',
      semester: user?.user_metadata?.semester || '',
      major: user?.user_metadata?.major || '',
    });
    setIsEditing(false);
    setError('');
    setSuccess('');
  };

  const isStudent = user?.user_metadata?.role === 'student';
  const isAdmin = user?.user_metadata?.role === 'admin';

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2">My Profile</h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            Manage your account information and preferences
          </p>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} className="w-full sm:w-auto">
              <Edit className="w-4 h-4 mr-2" />
              Edit Profile
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={handleCancel}
                className="w-full sm:w-auto"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={loading}
                className="w-full sm:w-auto"
              >
                <Save className="w-4 h-4 mr-2" />
                {loading ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Profile Content */}
      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Profile Info Card */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  {isEditing ? (
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder="Enter your full name"
                    />
                  ) : (
                    <div className="flex items-center gap-2 p-2 border rounded">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span>{user?.user_metadata?.name || 'Not set'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <div className="flex items-center gap-2 p-2 border rounded bg-muted">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span>{user?.email}</span>
                    <Badge variant="outline" className="ml-auto">Verified</Badge>
                  </div>
                </div>

                {isStudent && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="nim">NIM</Label>
                      {isEditing ? (
                        <Input
                          id="nim"
                          value={formData.nim}
                          onChange={(e) => setFormData({...formData, nim: e.target.value})}
                          placeholder="Enter your NIM"
                        />
                      ) : (
                        <div className="flex items-center gap-2 p-2 border rounded">
                          <GraduationCap className="w-4 h-4 text-muted-foreground" />
                          <span>{user?.user_metadata?.nim || 'Not set'}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="major">Major</Label>
                      {isEditing ? (
                        <Input
                          id="major"
                          value={formData.major}
                          onChange={(e) => setFormData({...formData, major: e.target.value})}
                          placeholder="Enter your major"
                        />
                      ) : (
                        <div className="flex items-center gap-2 p-2 border rounded">
                          <Building className="w-4 h-4 text-muted-foreground" />
                          <span>{user?.user_metadata?.major || 'Not set'}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="semester">Semester</Label>
                      {isEditing ? (
                        <Input
                          id="semester"
                          type="number"
                          value={formData.semester}
                          onChange={(e) => setFormData({...formData, semester: e.target.value})}
                          placeholder="Enter your semester"
                        />
                      ) : (
                        <div className="flex items-center gap-2 p-2 border rounded">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          <span>Semester {user?.user_metadata?.semester || 'Not set'}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Profile Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle>Profile Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col items-center text-center space-y-4">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src="" />
                    <AvatarFallback className="text-lg">
                      {user?.user_metadata?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold">{user?.user_metadata?.name || 'User'}</h3>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                  <Badge variant={isAdmin ? 'default' : 'secondary'}>
                    {isAdmin ? 'Administrator' : 'Student'}
                  </Badge>
                </div>

                <div className="space-y-2 pt-4 border-t">
                  <h4 className="font-medium">Quick Info</h4>
                  {isStudent && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">NIM:</span>
                        <span>{user?.user_metadata?.nim || 'Not set'}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Semester:</span>
                        <span>{user?.user_metadata?.semester || 'Not set'}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Account Type:</span>
                    <span>{user?.user_metadata?.role || 'User'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Account Tab */}
        <TabsContent value="account" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Account Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Account Status</h4>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Active</Badge>
                    <span className="text-sm text-muted-foreground">Your account is active and verified</span>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">User ID</h4>
                  <div className="p-2 bg-muted rounded text-sm font-mono">
                    {user?.id}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Member Since</h4>
                  <p className="text-sm text-muted-foreground">
                    {new Date().toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Password</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Change your password to keep your account secure
                  </p>
                  <Button variant="outline">Change Password</Button>
                </div>
                
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2 text-destructive">Danger Zone</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Sign out of your account
                  </p>
                  <Button variant="destructive" onClick={signOut}>
                    Sign Out
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}