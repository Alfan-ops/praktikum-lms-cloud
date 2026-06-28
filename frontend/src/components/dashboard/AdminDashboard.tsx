import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { MonitoringCharts } from '../monitoring/MonitoringCharts';
import { 
  Users, 
  BookOpen, 
  Play, 
  Search,
  Plus,
  MoreVertical,
  Clock,
  CheckCircle,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3';
import { Alert, AlertDescription } from '../ui/alert';

// --- NEW: Define AdminPage type ---
type AdminPage = 'dashboard' | 'periods' | 'courses' | 'students' | 'analytics' | 'monitoring' | 'resources' | 'profile';

// --- NEW: Interface for Course data ---
interface Course {
  id: number; // This is the MASTER course ID from the 'courses' table
  offering_id: number; // This is the ID from the 'course_offerings' table
  course_code: string;
  course_name: string;
  description: string;
  instructor_name: string;
  students_count?: number;
  modules_count?: number;
  status?: 'active' | 'draft' | 'completed' | 'upcoming';
}

// --- NEW: Interface for Dashboard props ---
interface AdminDashboardProps {
  onAdminPageChange: (page: AdminPage) => void; 
}

// --- NEW: API URL ---
const API_BASE_URL = '/api';

export function AdminDashboard({ onAdminPageChange }: AdminDashboardProps) { // <-- Use props
  const [searchQuery, setSearchQuery] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState({
    activeCourses: 0,
    totalStudents: 0,
    activePracticum: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user, getAuthHeader } = useAuth();

  useEffect(() => {
    if (user && getAuthHeader) {
      fetchDashboardData();
    }
  }, [user, getAuthHeader]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);

    // FIX: Check if getAuthHeader is available
    if (!getAuthHeader) {
      setError("Authentication function not ready.");
      setLoading(false);
      return;
    }

    try {
      const authHeaders = getAuthHeader();
      
      // Fetch courses and students in parallel
      const [coursesRes, studentsRes, schedulesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/courses`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/students`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/schedules`, { headers: authHeaders }) // Fetch schedules
      ]);

      if (!coursesRes.ok) throw new Error('Failed to load courses');
      const coursesData = await coursesRes.json();
      const activeCourses = coursesData.courses || [];
      setCourses(activeCourses.slice(0, 6)); // Only show 6 courses on dashboard

      if (!studentsRes.ok) throw new Error('Failed to load students');
      const studentsData = await studentsRes.json();
      const totalStudents = studentsData.students ? studentsData.students.length : 0;

      let activePracticum = 0;
      if (schedulesRes.ok) {
        const schedulesData = await schedulesRes.json();
        activePracticum = (schedulesData.schedules || []).filter((s: any) => s.status === 'ACTIVE').length;
      }

      // Update stats
      setStats({
        activeCourses: activeCourses.length,
        totalStudents: totalStudents,
        activePracticum: activePracticum
      });
      
    } catch (err: any) {
      logger.error('Failed to load dashboard data:', err);
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredCourses = courses.filter(course =>
    course.course_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (course.description && course.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // --- NEW: Handle clicks ---
  const handleNewCourseClick = () => {
    onAdminPageChange('courses');
  };
  
  const handleCourseClick = (course: Course) => {
    onAdminPageChange('courses');
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2">Hello, Admin 👋</h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            Welcome back to your laboratory management platform
          </p>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Mata Kuliah Aktif</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.activeCourses}</div>
            <p className="text-xs text-muted-foreground">
              Courses in active period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Jumlah Mahasiswa</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.totalStudents}</div>
            <p className="text-xs text-muted-foreground">
              Total registered students
            </p>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Praktikum Aktif</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.activePracticum}</div>
            <p className="text-xs text-muted-foreground">
              Sessions running now
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monitoring Charts */}
      <Card>
        <CardHeader>
          <CardTitle>System Monitoring</CardTitle>
          <p className="text-sm text-muted-foreground">
            Real-time resource usage of all lab containers (24h)
          </p>
        </CardHeader>
        <CardContent>
          <MonitoringCharts />
        </CardContent>
      </Card>

      {/* Course Access */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Course Management</CardTitle>
              <p className="text-sm text-muted-foreground">
                Manage mata kuliah dan praktikum
              </p>
            </div>
            <Button className="w-full sm:w-auto" onClick={handleNewCourseClick}>
              <Plus className="w-4 h-4 mr-2" />
              New Course
            </Button>
          </div>
          <div className="flex items-center space-x-2 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : error ? (
             <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCourses.map((course) => (
                <Card 
                  key={course.id} 
                  // --- FIX: Add flex flex-col h-full ---
                  className="border border-border hover:shadow-md transition-shadow flex flex-col h-full"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div 
                        className="space-y-1 flex-1 min-w-0 cursor-pointer"
                        onClick={() => handleCourseClick(course)}
                      >
                        <CardTitle className="text-base lg:text-lg leading-tight">{course.course_name}</CardTitle>
                        <p className="text-sm text-muted-foreground line-clamp-2">{course.description || 'No description'}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="flex-shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  {/* --- FIX: Add flex flex-col flex-grow --- */}
                  <CardContent className="pt-0 flex flex-col flex-grow">
                     {/* --- FIX: Add flex-grow and justify-end --- */}
                    <div className="space-y-3 flex flex-col flex-grow justify-end">
                      {/* Div kosong ini akan "tumbuh" untuk mengisi ruang ekstra */}
                      <div className="flex-grow" />
                      
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Students</span>
                        <span>{course.students_count || 0}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Instructor</span>
                        <span className="truncate ml-2">{course.instructor_name}</span>
                      </div>
                      <Badge 
                        variant={course.status === 'active' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {course.status || 'active'}
                      </Badge>
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={() => handleCourseClick(course)}
                      >
                        Manage
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}