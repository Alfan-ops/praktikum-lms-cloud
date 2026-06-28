import { useState, useEffect } from 'react';
import { ArrowLeft, BookOpen, Clock, User, FileText, Link as LinkIcon, CheckCircle, Award, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { toast } from 'sonner@2.0.3';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { AssignmentSubmissionCard } from './AssignmentSubmissionCard';

const API_BASE_URL = '/api'; // Use proxied URL

interface CourseDetailPageProps {
  courseId: string;
  onBack: () => void;
}

// Interfaces to match our backend API
interface Course {
  id: number;
  course_code: string;
  course_name: string;
  description?: string;
  instructor_name?: string;
}

interface Module {
  id: number;
  course_id: number;
  module_title: string;
  description: string;
}

interface ModuleContent {
  id: number;
  module_id: number;
  content_type: 'text' | 'file' | 'assignment' | 'virtual_lab';
  content_data: any;
  order_index: number;
}

interface Assignment {
  id: number;
  course_id: number;
  title: string;
  description: string;
  submission_start: string;
  submission_end: string;
  max_score: number;
  created_at: string;
}

interface Submission {
  id: number;
  assignment_id: number;
  student_id: string;
}

export function CourseDetailPage({ courseId, onBack }: CourseDetailPageProps) {
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [moduleContents, setModuleContents] = useState<{ [key: string]: ModuleContent[] }>({});
  const [assignments, setAssignments] = useState<{ [key: string]: Assignment }>({});
  const [loading, setLoading] = useState(true);
  
  const [labState, setLabState] = useState<{ [moduleId: number]: { loading: boolean; url?: string } }>({});
  
  // --- FIX: State to hold submission status ---
  const [submissions, setSubmissions] = useState<{ [assignmentId: number]: boolean }>({});

  const { user } = useAuth();

  // Helper to get auth token
  const getAuthHeader = () => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  useEffect(() => {
    if (courseId && user) { // Only fetch if user and courseId are available
      fetchCourseData();
    }
  }, [courseId, user]); // Add user dependency

  const fetchCourseData = async () => {
    try {
      setLoading(true);
      
      // 1. Fetch course details
      const courseRes = await fetch(
        `${API_BASE_URL}/courses/${courseId}`,
        { headers: getAuthHeader() }
      );
      if (!courseRes.ok) throw new Error('Failed to fetch course details');
      const courseData = await courseRes.json();
      setCourse(courseData);

      // 2. Fetch modules
      const modulesRes = await fetch(
        `${API_BASE_URL}/courses/${courseId}/modules`,
        { headers: getAuthHeader() }
      );
      if (!modulesRes.ok) throw new Error('Failed to fetch modules');
      const modulesData = (await modulesRes.json()).modules;
      setModules(modulesData.sort((a: Module, b: Module) => a.module_title.localeCompare(b.module_title)));

      // 3. Fetch module contents for each module
      const contentsPromises = modulesData.map(async (module: Module) => {
        const contentsRes = await fetch(
          `${API_BASE_URL}/modules/${module.id}/content`,
          { headers: getAuthHeader() }
        );
        if (!contentsRes.ok) return { moduleId: module.id, contents: [] };
        const contents = (await contentsRes.json()).content;
        return { moduleId: module.id, contents: contents.sort((a: ModuleContent, b: ModuleContent) => a.order_index - b.order_index) };
      });

      const contentsResults = await Promise.all(contentsPromises);
      const contentsMap: { [key: string]: ModuleContent[] } = {};
      contentsResults.forEach(result => {
        contentsMap[result.moduleId] = result.contents;
      });
      setModuleContents(contentsMap);

      // 4. Fetch assignments for this course
      const assignmentsRes = await fetch(
        `${API_BASE_URL}/courses/${courseId}/assignments`,
        { headers: getAuthHeader() }
      );
      if (assignmentsRes.ok) {
        const assignmentsData = (await assignmentsRes.json()).assignments;
        const assignmentsMap: { [key: string]: Assignment } = {};
        assignmentsData.forEach((assignment: Assignment) => {
          assignmentsMap[assignment.id] = assignment;
        });
        setAssignments(assignmentsMap);
      }

      // --- FIX: 5. Fetch submission status for this student ---
      if (user) {
        const subRes = await fetch(
          `${API_BASE_URL}/submissions?student_id=${user.id}`,
          { headers: getAuthHeader() }
        );
        if (subRes.ok) {
          const subs: Submission[] = await subRes.json();
          const subMap: { [assignmentId: number]: boolean } = {};
          subs.forEach((sub: any) => {
            subMap[sub.assignment_id] = true;
          });
          setSubmissions(subMap);
        }
      }

    } catch (error: any) {
      logger.error('Error fetching course data:', error);
      toast.error('Failed to load course data');
    } finally {
      setLoading(false);
    }
  };

  // --- FIX: Updated handleStartLab function ---
  const handleStartLab = async (moduleId: number, labName: string) => {
    logger.info(`Attempting to start lab for module: ${moduleId}`);
    setLabState(prev => ({ ...prev, [moduleId]: { loading: true, url: undefined } }));

    // Show a generic loading toast
    const loadingToast = toast.loading(`Connecting to lab: ${labName}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/labs/start`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({ module_id: moduleId })
      });

      const data = await response.json();

      if (!response.ok) {
        // Use the error message from the backend
        throw new Error(data.message || 'Failed to start lab session.');
      }

      // Success!
      toast.success(`Lab is ready! Opening new tab...`, { id: loadingToast });
      
      // Set the URL, which will make the "Join Lab" button appear
      setLabState(prev => ({ ...prev, [moduleId]: { loading: false, url: data.session.notebook_url } }));
      
      // --- Automatically open the lab ---
      window.open(data.session.notebook_url, '_blank');

    } catch (err: any) {
      logger.error('Error starting lab:', err);
      // Show the *real* error message from the backend
      toast.error(err.message || 'An error occurred.', { id: loadingToast });
      setLabState(prev => ({ ...prev, [moduleId]: { loading: false, url: undefined } }));
    }
  };

  // --- FIX: Helper function to calculate progress ---
  const calculateProgress = (moduleId: number) => {
    const contents = moduleContents[moduleId] || [];
    const assignmentContents = contents.filter(c => c.content_type === 'assignment');
    
    if (assignmentContents.length === 0) {
      return 100; // If no assignments, module is 100% complete
    }

    let completed = 0;
    assignmentContents.forEach(c => {
      const assignmentId = c.content_data.assignment_id;
      if (submissions[assignmentId]) { // Check if this assignment is in our submission map
        completed++;
      }
    });

    return (completed / assignmentContents.length) * 100;
  };

  const renderModuleContent = (content: ModuleContent) => {
    switch (content.content_type) {
      case 'text':
        return (
          <div className="p-4 bg-background rounded-lg border">
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 mt-1 text-muted-foreground" />
              <div 
                className="prose prose-sm max-w-none" 
                dangerouslySetInnerHTML={{ __html: content.content_data.text.replace(/\n/g, '<br />') }} 
              />
            </div>
          </div>
        );

      case 'file':
        return (
          <div className="p-4 bg-background rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{content.content_data.file_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {content.content_data.file_size ? `${(content.content_data.file_size / 1024).toFixed(2)} KB` : 'File'}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(content.content_data.file_url, '_blank')}
              >
                Open File
              </Button>
            </div>
          </div>
        );

      case 'virtual_lab':
          const state = labState[content.module_id] || { loading: false, url: undefined };
          return (
            <div className="p-4 bg-background rounded-lg border border-purple-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded">
                    <LinkIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{content.content_data.lab_name || 'Virtual Lab'}</p>
                    <p className="text-sm text-muted-foreground">Praktikum Session</p>
                  </div>
                </div>
                
                {state.url ? (
                  <Button
                    size="sm"
                    asChild
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    <a href={state.url} target="_blank" rel="noopener noreferrer">
                      Join Lab
                    </a>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="default"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={state.loading}
                    onClick={() => handleStartLab(content.module_id, content.content_data.lab_name)}
                  >
                    {state.loading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      'Launch Lab'
                    )}
                  </Button>
                )}
              </div>
            </div>
          );

      case 'assignment':
        const assignment = assignments[content.content_data.assignment_id];
        if (!assignment) return null;
        return (
          <AssignmentSubmissionCard
            assignment={assignment}
            courseId={courseId}
            showGrade={true} // Students should see their grade
            userId={user?.id}
          />
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="animate-spin h-12 w-12 text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading course...</p>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-12 p-4 lg:p-6">
        <p className="text-muted-foreground">Course not found</p>
        <Button onClick={onBack} className="mt-4">Go Back</Button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Courses
        </Button>
      </div>

      {/* Course Information Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Badge variant="secondary">{course.course_code}</Badge>
              </div>
              <CardTitle className="text-2xl">{course.course_name}</CardTitle>
              {course.instructor_name && (
                <CardDescription className="flex items-center gap-2 mt-2 text-base">
                  <User className="w-4 h-4" />
                  {course.instructor_name}
                </CardDescription>
              )}
            </div>
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
        </CardHeader>
        {course.description && (
          <CardContent>
            <Separator className="mb-4" />
            <p className="text-muted-foreground">{course.description}</p>
          </CardContent>
        )}
      </Card>

      {/* Modules Section */}
      <Card>
        <CardHeader>
          <CardTitle>Course Modules</CardTitle>
          <CardDescription>
            Access all course materials, assignments, and virtual labs
          </CardDescription>
        </CardHeader>
        <CardContent>
          {modules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No modules available yet
            </div>
          ) : (
            <Accordion type="multiple" className="w-full">
              {modules.map((module) => {
                // --- FIX: Calculate progress here ---
                const progress = calculateProgress(module.id);
                
                return (
                  <AccordionItem key={module.id} value={module.id.toString()}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <span className="text-base font-medium">{module.module_title}</span>
                      </div>
                      {/* --- FIX: Add the progress badge --- */}
                      <Badge variant={progress === 100 ? "default" : "outline"} className="ml-auto mr-4">
                        {progress === 100 ? <CheckCircle className="w-4 h-4 mr-1" /> : null}
                        {progress.toFixed(0)}%
                      </Badge>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pt-4 pl-11">
                        {moduleContents[module.id]?.length === 0 || !moduleContents[module.id] ? (
                          <p className="text-muted-foreground text-sm">No content added yet</p>
                        ) : (
                          moduleContents[module.id].map((content) => (
                            <div key={content.id}>
                              {renderModuleContent(content)}
                            </div>
                          ))
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}