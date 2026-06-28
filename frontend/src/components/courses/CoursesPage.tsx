import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { CourseModuleEditor } from './CourseModuleEditor';
import { CourseEnrollmentManager } from './CourseEnrollmentManager';
import { CourseDetailPage } from './CourseDetailPage'; 
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../ui/dialog';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Users,
  BookOpen,
  MoreVertical,
  AlertCircle,
  Loader2,
  X,
  Save,
  Video,
  FileText
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';

// API base URL
const API_BASE_URL = '/api';

// --- Interfaces ---
interface Course {
  id: number; // This is the MASTER course ID from the 'courses' table
  offering_id: number; // This is the ID from the 'course_offerings' table
  course_code: string;
  course_name: string;
  description: string;
  instructor_name: string;
  students_count?: number; // From backend
  modules_count?: number;  // From backend
  status?: 'active' | 'draft' | 'completed' | 'upcoming';
  progress?: number; // For student view
}

interface CoursesPageProps {
  isStudent?: boolean;
}

export function CoursesPage({ isStudent = false }: CoursesPageProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [view, setView] = useState<'list' | 'modules' | 'enrollment'>('list');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const [courseForm, setCourseForm] = useState({
    id: 0, 
    course_code: '',
    course_name: '',
    description: '',
    instructor: ''
  });

  const { user, getAuthHeader } = useAuth(); // FIX: Dapatkan getAuthHeader

  // --- API Interaction Functions (Courses) ---

  const fetchCourses = async () => {
    logger.info(`Fetching courses (isStudent: ${isStudent})...`);
    setLoading(true);
    setError(null);

    // FIX: Pastikan getAuthHeader ada sebelum memanggil
    if (!getAuthHeader) {
      setError("Fungsi autentikasi belum siap.");
      setLoading(false);
      return;
    }

    const url = isStudent 
      ? `${API_BASE_URL}/my-courses`  // The secure endpoint for students
      : `${API_BASE_URL}/courses`;   // The admin endpoint for all courses

    try {
      const response = await fetch(url, {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      setCourses(data.courses || []);
      logger.info(`Fetched ${data.courses?.length || 0} courses.`);

    } catch (err: any) {
      logger.error('Error fetching courses:', err);
      setError(err.message || 'Failed to fetch courses.');
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    logger.info('Attempting to add course:', courseForm);
    setError(null); 

    if (!courseForm.course_code || !courseForm.course_name) {
      setError('Course Code and Course Name are required.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/courses`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify(courseForm)
      });

      const data = await response.json();
      if (!response.ok) { throw new Error(data.error || `HTTP error! status: ${response.status}`); }

      logger.info('Course added successfully:', data.course);
      setIsAddDialogOpen(false);
      await fetchCourses(); 
    
    } catch (err: any) {
      logger.error('Error adding course:', err);
      setError(err.message || 'Failed to add course.');
    }
  };
  
  const handleEditCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    const courseId = courseForm.id;
    logger.info(`Attempting to edit course ${courseId}:`, courseForm);
    setError(null); 

    if (!courseId) {
      setError('Course ID is missing, cannot update.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/courses/${courseId}`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify(courseForm) 
      });
      const data = await response.json();
      if (!response.ok) { throw new Error(data.error || `HTTP error! status: ${response.status}`); }
      logger.info('Course updated successfully:', data.course);
      setIsEditDialogOpen(false);
      await fetchCourses(); // Full refresh
    } catch (err: any) {
      logger.error(`Error updating course ${courseId}:`, err);
      setError(err.message || 'Failed to update course.');
    }
  };

  const handleDeleteCourse = async (offeringId: number, courseName: string) => {
    if (!window.confirm(`Are you sure you want to delete the offering for "${courseName}"? This will remove it from the active period.`)) {
      return;
    }
    logger.info(`Attempting to delete course offering ${offeringId}`);
    setError(null);
    try {
       const response = await fetch(`${API_BASE_URL}/course-offerings/${offeringId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await response.json();
      if (!response.ok) { throw new Error(data.error || `HTTP error! status: ${response.status}`); }
      logger.info(`Course offering ${offeringId} deleted successfully.`);
      await fetchCourses(); // Refresh list
    } catch (err: any) {
       logger.error(`Error deleting course offering ${offeringId}:`, err);
       setError(err.message || 'Failed to delete course offering.');
    }
  };

  useEffect(() => {
    if (getAuthHeader) { // Cek jika getAuthHeader sudah ada
      fetchCourses();
    }
  }, [isStudent, getAuthHeader]); // Tambahkan getAuthHeader sebagai dependensi

  const openAddDialog = () => {
    setError(null);
    setCourseForm({ id: 0, course_code: '', course_name: '', description: '', instructor: '' });
    setIsAddDialogOpen(true);
  };
  
  const openEditDialog = (course: Course) => {
    setError(null);
    setCourseForm({
      id: course.id,
      course_code: course.course_code,
      course_name: course.course_name,
      description: course.description,
      instructor: course.instructor_name 
    });
    setIsEditDialogOpen(true);
  };

  const filteredCourses = courses.filter(course =>
    course.course_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    course.course_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (course.description && course.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const renderCourseList = () => (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2">
            {isStudent ? 'My Courses' : 'Course Management'}
          </h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            {isStudent
              ? 'Access your enrolled courses and track progress'
              : 'Manage courses for the active period'}
          </p>
        </div>
        {!isStudent && (
          <Button className="w-full sm:w-auto" onClick={openAddDialog}>
            <Plus className="w-4 h-4 mr-2" />
            New Course
          </Button>
        )}
      </div>

      {error && !isAddDialogOpen && !isEditDialogOpen && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>
               <X className="h-4 w-4" />
            </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search courses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              disabled={loading}
            />
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-2 text-muted-foreground">Loading Courses...</p>
        </div>
      ) : filteredCourses.length === 0 ? (
        <Card>
           <CardContent className="text-center py-12 text-muted-foreground">
             <BookOpen className="h-12 w-12 mx-auto mb-4" />
             <p>{isStudent ? 'You are not enrolled in any courses.' : 'No courses found for the active period.'}</p>
             {!isStudent && <p className="mt-2">Click "+ New Course" to add one.</p>}
           </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
          {filteredCourses.map((course) => (
            <Card
              key={course.offering_id} 
              // --- FIX: Add flex flex-col h-full ---
              className="border border-border hover:shadow-lg transition-all flex flex-col h-full"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div 
                    className="space-y-1 flex-1 min-w-0 cursor-pointer" 
                    onClick={() => {
                      setSelectedCourse(course);
                      setView('modules');
                    }}
                  >
                    <CardTitle className="text-base lg:text-lg leading-tight">{course.course_name}</CardTitle>
                    <Badge variant="outline" className="w-fit">{course.course_code}</Badge>
                    <p className="text-sm text-muted-foreground line-clamp-2">{course.description || 'No description'}</p>
                  </div>
                  {!isStudent && (
                    <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              {/* --- FIX: Add flex-grow and flex-col --- */}
              <CardContent className="pt-0 flex flex-col flex-grow">
                {/* --- FIX: Add flex-grow and justify-end --- */}
                <div className="space-y-3 flex flex-col flex-grow justify-end">
                  {/* Div kosong ini akan "tumbuh" untuk mengisi ruang ekstra */}
                  <div className="flex-grow" />
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Instructor</span>
                    <span className="truncate ml-2">{course.instructor_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Students</span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {course.students_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Modules</span>
                    <span className="flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      {course.modules_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Badge
                      variant={course.status === 'active' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {course.status || 'active'}
                    </Badge>
                  </div>
                  
                  {isStudent && (
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${course.progress.toFixed(0)}%` }}
                      />
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button 
                      variant="outline" 
                      className="flex-1" 
                      size="sm"
                      onClick={() => {
                        setSelectedCourse(course);
                        setView('modules');
                      }}
                    >
                      {isStudent ? 'Continue' : 'Manage Modules'}
                    </Button>
                    {!isStudent && (
                      <>
                        <Button variant="outline" size="sm" onClick={(e) => { 
                          e.stopPropagation(); 
                          setSelectedCourse(course); 
                          setView('enrollment');
                        }}>
                          <Users className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEditDialog(course); }}>
                          <Edit className="w-4 h-4" />
                        </Button>
                         <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleDeleteCourse(course.offering_id, course.course_name); }} className="text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
  
  const renderAddDialog = () => (
    <Dialog open={isAddDialogOpen} onOpenChange={(open) => { setIsAddDialogOpen(open); setError(null); }}>
      <DialogContent>
        <form onSubmit={handleAddCourse}>
          <DialogHeader>
            <DialogTitle>Add New Course</DialogTitle>
            <DialogDescription>
              Create a new course. It will be automatically added to the current active period.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
             {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                   <AlertCircle className="w-4 h-4" />
                   <p>{error}</p>
                </div>
             )}
             <div className="space-y-2">
               <Label htmlFor="course_code">Course Code</Label>
               <Input id="course_code" value={courseForm.course_code} onChange={(e) => setCourseForm({...courseForm, course_code: e.target.value})} placeholder="e.g., ET2108" required />
             </div>
             <div className="space-y-2">
               <Label htmlFor="course_name">Course Name</Label>
               <Input id="course_name" value={courseForm.course_name} onChange={(e) => setCourseForm({...courseForm, course_name: e.target.value})} placeholder="e.g., Rangkaian Listrik" required />
             </div>
             <div className="space-y-2">
               <Label htmlFor="instructor">Instructor</Label>
               <Input id="instructor" value={courseForm.instructor} onChange={(e) => setCourseForm({...courseForm, instructor: e.target.value})} placeholder="e.g., Dr. Ahmad Santoso" />
             </div>
             <div className="space-y-2">
               <Label htmlFor="description">Description</Label>
               <Textarea id="description" value={courseForm.description} onChange={(e) => setCourseForm({...courseForm, description: e.target.value})} placeholder="A brief description of the course..." />
             </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button type="submit">
              <Plus className="w-4 h-4 mr-2" /> Add Course
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  const renderEditDialog = () => (
    <Dialog open={isEditDialogOpen} onOpenChange={(open) => { setIsEditDialogOpen(open); setError(null); }}>
      <DialogContent>
        <form onSubmit={handleEditCourse}>
          <DialogHeader>
            <DialogTitle>Edit Course Details</DialogTitle>
            <DialogDescription>
              Update the master details for this course. This will affect all periods.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
             {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                   <AlertCircle className="w-4 h-4" />
                   <p>{error}</p>
                </div>
             )}
             <div className="space-y-2">
               <Label htmlFor="edit_course_code">Course Code</Label>
               <Input id="edit_course_code" value={courseForm.course_code} onChange={(e) => setCourseForm({...courseForm, course_code: e.target.value})} required />
             </div>
             <div className="space-y-2">
               <Label htmlFor="edit_course_name">Course Name</Label>
               <Input id="edit_course_name" value={courseForm.course_name} onChange={(e) => setCourseForm({...courseForm, course_name: e.target.value})} required />
             </div>
             <div className="space-y-2">
               <Label htmlFor="edit_description">Description</Label>
               <Textarea id="edit_description" value={courseForm.description} onChange={(e) => setCourseForm({...courseForm, description: e.target.value})} />
             </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button type="submit">
              <Save className="w-4 h-4 mr-2" /> Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  
// --- MAIN RETURN LOGIC ---
if (view === 'modules' && selectedCourse) {
  if (isStudent) {
    // STUDENT: Show the read-only viewer
    return (
      <CourseDetailPage
        courseId={selectedCourse.id.toString()} // Pass the master course ID
        onBack={() => {
          setView('list');
          setSelectedCourse(null);
          fetchCourses();
        }}
      />
    );
  } else {
    // ADMIN: Show the module editor
    return (
      <CourseModuleEditor
        courseId={selectedCourse.id} // Pass MASTER course ID
        courseOfferingId={selectedCourse.offering_id} 
        courseName={selectedCourse.course_name}
        onBack={() => {
          setView('list');
          setSelectedCourse(null);
          fetchCourses();
        }}
      />
    );
  }
}

if (view === 'enrollment' && selectedCourse) {
  return (
    <CourseEnrollmentManager
      courseOfferingId={selectedCourse.offering_id}
      courseName={selectedCourse.course_name}
      onBack={() => {
        setView('list');
        setSelectedCourse(null);
        fetchCourses();
      }}
    />
  );
}

  // Default view: Show the list
  return (
    <>
      {renderCourseList()}
      {renderAddDialog()}
      {renderEditDialog()}
    </>
  );
}