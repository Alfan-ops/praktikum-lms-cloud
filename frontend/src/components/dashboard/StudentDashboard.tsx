import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { 
  BookOpen, 
  Search,
  Clock,
  CheckCircle,
  PlayCircle,
  Calendar,
  User,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3';

const API_BASE_URL = '/api';

interface EnrolledCourse {
  id: number;
  offering_id: number;
  course_code: string;
  course_name: string;
  description: string;
  instructor_name: string;
  progress: number;
  status: 'active' | 'completed' | 'upcoming'; // We'll infer this
  modules_count: number;
  students_count: number;
}

interface Deadline {
  course_title: string;
  assignment_title: string;
  due_date: string;
}

export function StudentDashboard() {
  const [searchQuery, setSearchQuery] = useState('');
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
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
    try {
      const authHeaders = getAuthHeader();

      const [coursesRes, deadlinesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/my-courses`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/my-deadlines`, { headers: authHeaders })
      ]);

      if (!coursesRes.ok) throw new Error('Failed to load your courses');
      const coursesData = await coursesRes.json();
      setEnrolledCourses(coursesData.courses || []);

      if (!deadlinesRes.ok) throw new Error('Failed to load deadlines');
      const deadlinesData = await deadlinesRes.json();
      setDeadlines(deadlinesData.deadlines || []);

    } catch (err: any) {
      logger.error('Error fetching dashboard data:', err);
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getCourseStatus = (course: EnrolledCourse): 'active' | 'completed' | 'upcoming' => {
    if (course.progress === 100) return 'completed';
    if (course.progress > 0) return 'active';
    return 'upcoming';
  };

  const formatDueDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredCourses = enrolledCourses.filter(course =>
    course.course_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    course.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Quick stats
  const activeCourses = enrolledCourses.filter(c => getCourseStatus(c) === 'active').length;
  const completedCourses = enrolledCourses.filter(c => getCourseStatus(c) === 'completed').length;
  const totalProgress = enrolledCourses.length > 0 
    ? Math.round(
        enrolledCourses.reduce((sum, course) => sum + course.progress, 0) / enrolledCourses.length
      )
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle /> Error Loading Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
            <Button onClick={fetchDashboardData} className="mt-4">Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2">Hello, {user?.user_metadata?.name || 'Student'} 👋</h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            Welcome back to your learning platform
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Active Courses</CardTitle>
            <PlayCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{activeCourses}</div>
            <p className="text-xs text-muted-foreground">
              Currently enrolled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{completedCourses}</div>
            <p className="text-xs text-muted-foreground">
              Courses finished
            </p>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Overall Progress</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{totalProgress}%</div>
            <p className="text-xs text-muted-foreground">
              Average completion
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Deadlines */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Upcoming Deadlines
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {deadlines.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No upcoming deadlines. Great job!
              </p>
            ) : (
              deadlines.map(deadline => (
                <div key={`${deadline.course_title}-${deadline.assignment_title}`} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-2 h-2 bg-destructive rounded-full flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{deadline.course_title}</p>
                      <p className="text-sm text-muted-foreground">{deadline.assignment_title}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="flex-shrink-0">
                    <Clock className="w-3 h-3 mr-1" />
                    Due {formatDueDate(deadline.due_date)}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* My Courses */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle>My Courses</CardTitle>
              <p className="text-sm text-muted-foreground">
                Your enrolled courses and progress
              </p>
            </div>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredCourses.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4 lg:col-span-2">
                No courses found.
              </p>
            )}
            {filteredCourses.map((course) => {
              const status = getCourseStatus(course);
              return (
                <Card key={course.id} className="border border-border hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1 min-w-0">
                        <CardTitle className="text-base lg:text-lg leading-tight">{course.course_name}</CardTitle>
                        <p className="text-sm text-muted-foreground line-clamp-2">{course.description}</p>
                      </div>
                      <Badge 
                        variant={status === 'active' ? 'default' : 
                                status === 'completed' ? 'secondary' : 'outline'}
                        className="flex-shrink-0 ml-2"
                      >
                        {status === 'active' && <PlayCircle className="w-3 h-3 mr-1" />}
                        {status === 'completed' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {status === 'upcoming' && <Clock className="w-3 h-3 mr-1" />}
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{course.instructor_name}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Modules</span>
                        <span>{course.modules_count}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Progress</span>
                        <span className="text-sm">{course.progress.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div 
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${course.progress.toFixed(0)}%` }}
                        />
                      </div>
                      <Button variant="outline" className="w-full">
                        {status === 'upcoming' ? 'View Details' : 'Continue Learning'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}