import React, { useState } from 'react';
import { AuthProvider, useAuth } from './components/auth/AuthProvider';
import { LoginForm } from './components/auth/LoginForm';
import { Sidebar } from './components/layout/Sidebar';
import { AdminDashboard } from './components/dashboard/AdminDashboard';
import { StudentDashboard } from './components/dashboard/StudentDashboard';
import { PeriodsPage } from './components/periods/PeriodsPage';
import { CoursesPage } from './components/courses/CoursesPage';
import { StudentsPage } from './components/students/StudentsPage';
import { StudentAssignmentsPage } from './components/assignments/StudentAssignmentsPage';
import { ProfilePage } from './components/profile/ProfilePage';
import { PredictiveAnalytics } from './components/analytics/PredictiveAnalytics';
import { AdvancedMonitoring } from './components/monitoring/AdvancedMonitoring';
import { ResourceManager } from './components/management/ResourceManager';
import { Toaster } from './components/ui/sonner';
import { ErrorBoundary } from './components/utils/ErrorBoundary';

type AdminPage = 'dashboard' | 'periods' | 'courses' | 'students' | 'analytics' | 'monitoring' | 'resources' | 'profile';
type StudentPage = 'dashboard' | 'periods' | 'courses' | 'assignments' | 'profile';

function AppContent() {
  const { user, loading } = useAuth();
  const [adminCurrentPage, setAdminCurrentPage] = useState<AdminPage>('dashboard');
  const [studentCurrentPage, setStudentCurrentPage] = useState<StudentPage>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <LoginForm />
      </ErrorBoundary>
    );
  }

  const isAdmin = user.user_metadata?.role === 'admin';

  const renderAdminContent = () => {
    switch (adminCurrentPage) {
      case 'dashboard':
        // --- THIS IS THE FIX ---
        return <AdminDashboard onAdminPageChange={setAdminCurrentPage} />;
      case 'periods':
        return <PeriodsPage />;
      case 'courses':
        return <CoursesPage />;
      case 'students':
        return <StudentsPage />;
      case 'analytics':
        return <PredictiveAnalytics />;
      case 'monitoring':
        return <AdvancedMonitoring />;
      case 'resources':
        return <ResourceManager />;
      case 'profile':
        return <ProfilePage />;
      default:
        // --- THIS IS THE FIX ---
        return <AdminDashboard onAdminPageChange={setAdminCurrentPage} />;
    }
  };

  const renderStudentContent = () => {
    switch (studentCurrentPage) {
      case 'dashboard':
        return <StudentDashboard />;
      case 'periods':
        return <PeriodsPage isStudent={true} />;
      case 'courses':
        return <CoursesPage isStudent={true} />;
      case 'assignments':
        return <StudentAssignmentsPage userId={user.id} />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <StudentDashboard />;
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-background">
        {/* Mobile Sidebar Overlay */}
        <div className={`
          lg:hidden fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <Sidebar 
            adminCurrentPage={adminCurrentPage}
            onAdminPageChange={setAdminCurrentPage}
            studentCurrentPage={studentCurrentPage}
            onStudentPageChange={setStudentCurrentPage}
            isMobile={true}
            onMobileMenuClose={() => setIsMobileMenuOpen(false)}
          />
        </div>

        {/* Desktop Sidebar */}
        <div className="hidden lg:block">
          <Sidebar 
            adminCurrentPage={adminCurrentPage}
            onAdminPageChange={setAdminCurrentPage}
            studentCurrentPage={studentCurrentPage}
            onStudentPageChange={setStudentCurrentPage}
            isMobile={false}
          />
        </div>

        {/* Mobile overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {/* Mobile header */}
          <div className="lg:hidden bg-background border-b border-border p-4 flex items-center justify-between">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 rounded-md hover:bg-accent"
              aria-label="Open menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="text-center">
              <h1 className="font-semibold">Lab Platform</h1>
              <p className="text-xs text-muted-foreground">Institut Teknologi Bandung</p>
            </div>
            <div className="w-10" /> {/* Spacer for centering */}
          </div>

          {/* Page content with error boundary */}
          <ErrorBoundary>
            <div className="h-full">
              {isAdmin ? renderAdminContent() : renderStudentContent()}
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
        <Toaster />
      </AuthProvider>
    </ErrorBoundary>
  );
}
