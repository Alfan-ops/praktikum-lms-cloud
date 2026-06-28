import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Avatar, AvatarFallback } from '../ui/avatar';
import {
  ArrowLeft,
  Search,
  UserPlus,
  Trash2,
  Loader2,
  AlertCircle,
  X
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3';

const API_BASE_URL = '/api'

// This interface must match the `users` table
interface Student {
  id: string; // UUID
  full_name: string;
  nim: string;
  email: string;
  enrollment_id?: number; // Will be added when fetching enrolled students
}

interface CourseEnrollmentManagerProps {
  courseOfferingId: number;
  courseName: string;
  onBack: () => void;
}

export function CourseEnrollmentManager({
  courseOfferingId,
  courseName,
  onBack
}: CourseEnrollmentManagerProps) {
  const [enrolledStudents, setEnrolledStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]); // All students in the system
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { user } = useAuth();

  const getAuthHeader = () => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch both lists in parallel
      const [enrolledRes, allRes] = await Promise.all([
        fetch(`${API_BASE_URL}/course-offerings/${courseOfferingId}/enrolled-students`, { headers: getAuthHeader() }),
        fetch(`${API_BASE_URL}/students`, { headers: getAuthHeader() }) // Get all students
      ]);

      if (!enrolledRes.ok) throw new Error('Failed to fetch enrolled students');
      if (!allRes.ok) throw new Error('Failed to fetch all students');

      const enrolledData = await enrolledRes.json();
      const allData = await allRes.json();

      setEnrolledStudents(enrolledData.students || []);
      setAllStudents(allData.students || []);

    } catch (err: any) {
      logger.error('Error fetching student data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [courseOfferingId]);

  const handleEnroll = async (student: Student) => {
    try {
      const response = await fetch(`${API_BASE_URL}/enrollments`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({
          offering_id: courseOfferingId,
          student_id: student.id
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to enroll student');
      }
      
      // Add student to the enrolled list with their new enrollment_id
      const newEnrolledStudent = { ...student, enrollment_id: data.enrollment.id };
      setEnrolledStudents(prev => [...prev, newEnrolledStudent]);
      toast.success(`${student.full_name} enrolled successfully.`);

    } catch (err: any) {
      logger.error('Error enrolling student:', err);
      toast.error(err.message);
    }
  };

  const handleUnenroll = async (student: Student) => {
    if (!student.enrollment_id) return;
    if (!window.confirm(`Are you sure you want to remove ${student.full_name} from this course?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/enrollments/${student.enrollment_id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to unenroll student');
      }
      
      // Remove student from the enrolled list
      setEnrolledStudents(prev => prev.filter(s => s.id !== student.id));
      toast.success(`${student.full_name} unenrolled successfully.`);

    } catch (err: any) {
      logger.error('Error unenrolling student:', err);
      toast.error(err.message);
    }
  };
  
  // Get initials for avatar
  const getInitials = (name: string) => {
    const parts = name.split(' ');
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (first + last).toUpperCase() || 'S';
  };

  // Filter the list of ALL students to find ones NOT yet enrolled
  const availableStudents = allStudents
    .filter(student => 
      !enrolledStudents.some(enrolled => enrolled.id === student.id)
    )
    .filter(student =>
      student.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.nim.includes(searchQuery)
    );

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" onClick={onBack} className="w-fit">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Courses
        </Button>
        <h1 className="text-xl lg:text-2xl font-semibold truncate">
          {courseName}
        </h1>
        <div className="w-fit"></div> 
      </div>
      
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
          <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>
             <X className="h-4 w-4" />
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-2 text-muted-foreground">Loading students...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Card for Adding Students */}
          <Card>
            <CardHeader>
              <CardTitle>Add Students</CardTitle>
              <CardDescription>Search for students to enroll in this course.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search by name or NIM..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {availableStudents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No matching students found or all are enrolled.
                  </p>
                ) : (
                  availableStudents.map(student => (
                    <div key={student.id} className="flex items-center justify-between p-2 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs">{getInitials(student.full_name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{student.full_name}</p>
                          <p className="text-xs text-muted-foreground">{student.nim}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleEnroll(student)}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Enroll
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          
          {/* Card for Enrolled Students */}
          <Card>
            <CardHeader>
              <CardTitle>Enrolled Students ({enrolledStudents.length})</CardTitle>
              <CardDescription>Students currently in this course.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[28rem] overflow-y-auto space-y-2">
                {enrolledStudents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No students are enrolled yet.
                  </p>
                ) : (
                  enrolledStudents.map(student => (
                    <div key={student.id} className="flex items-center justify-between p-2 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs">{getInitials(student.full_name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{student.full_name}</p>
                          <p className="text-xs text-muted-foreground">{student.nim}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleUnenroll(student)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}