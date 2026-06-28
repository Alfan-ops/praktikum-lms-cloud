import React from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
  LayoutDashboard, 
  Calendar, 
  BookOpen, 
  Users, 
  ClipboardList,
  LogOut,
  User,
  X,
  UserCircle,
  Brain,
  Activity,
  Settings
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

type AdminPage = 'dashboard' | 'periods' | 'courses' | 'students' | 'analytics' | 'monitoring' | 'resources' | 'profile';
type StudentPage = 'dashboard' | 'periods' | 'courses' | 'assignments' | 'profile';

interface SidebarProps {
  adminCurrentPage: AdminPage;
  onAdminPageChange: (page: AdminPage) => void;
  studentCurrentPage: StudentPage;
  onStudentPageChange: (page: StudentPage) => void;
  isMobile?: boolean;
  onMobileMenuClose?: () => void;
}

export function Sidebar({ 
  adminCurrentPage, 
  onAdminPageChange,
  studentCurrentPage,
  onStudentPageChange,
  isMobile,
  onMobileMenuClose
}: SidebarProps) {
  const { user, signOut } = useAuth();
  
  const isAdmin = user?.user_metadata?.role === 'admin';
  const isStudent = user?.user_metadata?.role === 'student';

  const adminMenuItems = [
    { id: 'dashboard' as AdminPage, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'periods' as AdminPage, label: 'Periods', icon: Calendar },
    { id: 'courses' as AdminPage, label: 'Courses', icon: BookOpen },
    { id: 'students' as AdminPage, label: 'Students', icon: Users },
    { id: 'analytics' as AdminPage, label: 'Analytics', icon: Brain },
    { id: 'monitoring' as AdminPage, label: 'Monitoring', icon: Activity },
    { id: 'resources' as AdminPage, label: 'Resources', icon: Settings },
    { id: 'profile' as AdminPage, label: 'My Profile', icon: UserCircle },
  ];

  const studentMenuItems = [
    { id: 'dashboard' as StudentPage, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'periods' as StudentPage, label: 'Periods', icon: Calendar },
    { id: 'courses' as StudentPage, label: 'Courses', icon: BookOpen },
    { id: 'assignments' as StudentPage, label: 'Assignments', icon: ClipboardList },
    { id: 'profile' as StudentPage, label: 'My Profile', icon: UserCircle },
  ];

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      {/* Mobile close button */}
      {isMobile && onMobileMenuClose && (
        <div className="lg:hidden p-4 border-b border-sidebar-border flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMobileMenuClose}
            className="p-2"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}
      
      {/* Header */}
      <div className={`p-6 border-b border-sidebar-border ${isMobile ? 'pt-2' : ''}`}>
        <h1 className="text-xl font-semibold text-sidebar-foreground">Lab Telematika</h1>
        <p className="text-sm text-sidebar-foreground/70 mt-1">Institut Teknologi Bandung</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="space-y-2">
          {isAdmin ? (
            adminMenuItems.map((item) => (
              <Button
                key={item.id}
                variant={adminCurrentPage === item.id ? 'secondary' : 'ghost'}
                className="w-full justify-start"
                onClick={() => {
                  onAdminPageChange(item.id);
                  if (isMobile && onMobileMenuClose) {
                    onMobileMenuClose();
                  }
                }}
              >
                <item.icon className="w-4 h-4 mr-3" />
                {item.label}
              </Button>
            ))
          ) : (
            studentMenuItems.map((item) => (
              <Button
                key={item.id}
                variant={studentCurrentPage === item.id ? 'secondary' : 'ghost'}
                className="w-full justify-start"
                onClick={() => {
                  onStudentPageChange(item.id);
                  if (isMobile && onMobileMenuClose) {
                    onMobileMenuClose();
                  }
                }}
              >
                <item.icon className="w-4 h-4 mr-3" />
                {item.label}
              </Button>
            ))
          )}
        </div>
      </nav>

      {/* User Info */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-sidebar-primary rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'User'}
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {isAdmin ? 'Administrator' : isStudent ? user?.user_metadata?.nim || 'Student' : 'User'}
              </Badge>
            </div>
          </div>
        </div>
        <Button 
          variant="outline" 
          className="w-full" 
          onClick={signOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </div>
  );
}