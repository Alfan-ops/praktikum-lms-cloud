import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Search, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { AssignmentSubmissionCard } from '../courses/AssignmentSubmissionCard';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';

const API_BASE_URL = '/api'

interface Assignment {
  id: number;
  course_id: number;
  title: string;
  description: string;
  submission_start: string;
  submission_end: string;
  max_score: number;
  created_at: string;
  course?: {
    course_code: string;
    course_name: string;
  };
}

interface Submission {
  id: number;
  assignment_id: number;
  student_id: string;
  submitted_at: string;
  score?: number;
}

interface Course {
  id: number;
  course_code: string;
  course_name: string;
}

export function StudentAssignmentsPage({ userId }: { userId: string }) { // Added prop type
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState('all');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<{ [key: string]: Submission }>({});
  const [loading, setLoading] = useState(true);

  const { user } = useAuth(); // Get auth context

  const getAuthHeader = () => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  useEffect(() => {
    if (userId) {
      fetchAssignments();
    }
  }, [userId]);

  const fetchAssignments = async () => {
    try {
      setLoading(true);

      // --- *** THIS IS THE FIX *** ---
      // 1. Fetch the courses the student is enrolled in
      const coursesRes = await fetch(`${API_BASE_URL}/my-courses`, {
        headers: getAuthHeader()
      });
      if (!coursesRes.ok) throw new Error('Failed to fetch enrolled courses');
      const enrolledCourses: Course[] = (await coursesRes.json()).courses || [];
      
      if (enrolledCourses.length === 0) {
        setAssignments([]);
        setLoading(false);
        return;
      }

      // 2. Fetch assignments for each enrolled course
      const assignmentsPromises = enrolledCourses.map(async (course: Course) => {
        const assignmentsRes = await fetch(`${API_BASE_URL}/courses/${course.id}/assignments`, {
          headers: getAuthHeader()
        });
        if (!assignmentsRes.ok) return [];
        const assignmentsData = (await assignmentsRes.json()).assignments || [];
        
        // Add course info to each assignment
        return assignmentsData.map((assignment: Assignment) => ({
          ...assignment,
          course: {
            course_code: course.course_code,
            course_name: course.course_name,
          }
        }));
      });

      const assignmentsResults = await Promise.all(assignmentsPromises);
      const allAssignments = assignmentsResults.flat();
      setAssignments(allAssignments);
      // --- *** END OF FIX *** ---

      // Fetch submissions for all assignments
      if (allAssignments.length > 0) {
        const assignmentIds = allAssignments.map(a => a.id);
        
        // We need a new endpoint to fetch submissions in bulk
        // For now, let's fetch one by one (less efficient, but works)
        const submissionsPromises = allAssignments.map(async (assignment: Assignment) => {
          // We need a /my-submission-for-assignment/:id endpoint
          // Let's assume the old endpoint works for now
          const submissionsRes = await fetch(
            `${API_BASE_URL}/submissions?assignment_id=${assignment.id}&student_id=${userId}`, {
            headers: getAuthHeader()
          });

          if (submissionsRes.ok) {
            const submissionsData = await submissionsRes.json();
            if (submissionsData.length > 0) {
              return { assignmentId: assignment.id, submission: submissionsData[0] };
            }
          }
          return null;
        });

        const submissionsResults = await Promise.all(submissionsPromises);
        const submissionsMap: { [key: string]: Submission } = {};
        submissionsResults.forEach(result => {
          if (result) {
            submissionsMap[result.assignmentId] = result.submission;
          }
        });
        setSubmissions(submissionsMap);
      }
    } catch (error: any) {
      console.error('Error fetching assignments:', error);
      toast.error(error.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };
  
  // We need to create the /submissions endpoint in management.py
  // Let's add that.

  const getAssignmentStatus = (assignment: Assignment) => {
    const now = new Date();
    const start = new Date(assignment.submission_start);
    const end = new Date(assignment.submission_end);
    const submission = submissions[assignment.id];

    if (submission) {
      if (submission.score !== null && submission.score !== undefined) {
        return 'graded';
      }
      return 'submitted';
    }

    if (now < start) return 'not-open';
    if (now > end) return 'overdue';
    return 'open';
  };

  const filteredAssignments = assignments.filter(assignment => {
    const matchesSearch = 
      assignment.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      assignment.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      assignment.course?.course_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      assignment.course?.course_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const status = getAssignmentStatus(assignment);
    const matchesTab = 
      selectedTab === 'all' || 
      (selectedTab === 'open' && status === 'open') ||
      (selectedTab === 'submitted' && status === 'submitted') ||
      (selectedTab === 'graded' && status === 'graded') ||
      (selectedTab === 'overdue' && status === 'overdue');
    
    return matchesSearch && matchesTab;
  });

  const stats = {
    total: assignments.length,
    open: assignments.filter(a => getAssignmentStatus(a) === 'open').length,
    submitted: assignments.filter(a => getAssignmentStatus(a) === 'submitted').length,
    graded: assignments.filter(a => getAssignmentStatus(a) === 'graded').length,
    overdue: assignments.filter(a => getAssignmentStatus(a) === 'overdue').length,
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl mb-2">My Assignments</h1>
        <p className="text-muted-foreground text-sm lg:text-base">
          View and submit assignments from all your courses
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Total</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Open</CardTitle>
            <FileText className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl text-blue-600">{stats.open}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Submitted</CardTitle>
            <FileText className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl text-green-600">{stats.submitted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Graded</CardTitle>
            <FileText className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl text-purple-600">{stats.graded}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Overdue</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl text-red-600">{stats.overdue}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Tabs */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search assignments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Tabs value={selectedTab} onValueChange={setSelectedTab}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="submitted">Submitted</TabsTrigger>
                <TabsTrigger value="graded">Graded</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
      </Card>

      {/* Assignments List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="animate-spin h-12 w-12 text-primary mx-auto" />
            <p className="mt-4 text-muted-foreground">Loading assignments...</p>
          </div>
        </div>
      ) : filteredAssignments.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-8">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                No assignments found matching your criteria
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredAssignments.map((assignment) => (
            <div key={assignment.id} className="space-y-2">
              {assignment.course && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {assignment.course.course_code}
                  </Badge>
                  <span className="text-sm text-gray-600">
                    {assignment.course.course_name}
                  </span>
                </div>
              )}
              <AssignmentSubmissionCard
                assignment={assignment}
                courseId={assignment.course_id.toString()}
                showGrade={true}
                userId={userId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}