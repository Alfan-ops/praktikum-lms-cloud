import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Alert, AlertDescription } from '../ui/alert';
import {
  ArrowLeft,
  Search,
  User,
  Loader2,
  AlertCircle,
  FileText,
  CheckCircle,
  Save
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3';

const API_BASE_URL = '/api'

// --- Interfaces ---
interface Assignment {
  id: number;
  title: string;
}
interface EnrolledStudent {
  id: string; // UUID
  full_name: string;
  nim: string;
}
interface Submission {
  id: number;
  student_id: string;
  submission_text?: string;
  submission_file_url?: string;
  submission_file_name?: string;
  submitted_at: string;
  score?: number;
  feedback?: string;
  users: EnrolledStudent; // From the backend query
}

interface AssignmentGradingPageProps {
  assignment: Assignment;
  courseOfferingId: number;
  onBack: () => void;
  getAuthHeader: () => { [key: string]: string };
}

export function AssignmentGradingPage({
  assignment,
  courseOfferingId,
  onBack,
  getAuthHeader
}: AssignmentGradingPageProps) {
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [submissions, setSubmissions] = useState<{ [studentId: string]: Submission }>({});
  const [selectedStudent, setSelectedStudent] = useState<EnrolledStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Grading form state
  const [score, setScore] = useState<string>('');
  const [feedback, setFeedback] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, [assignment.id, courseOfferingId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch enrolled students
      const studentsRes = await fetch(
        `${API_BASE_URL}/course-offerings/${courseOfferingId}/enrolled-students`,
        { headers: getAuthHeader() }
      );
      if (!studentsRes.ok) throw new Error('Failed to fetch students');
      const studentsData = (await studentsRes.json()).students || [];
      setStudents(studentsData);

      // 2. Fetch all submissions for this assignment
      const submissionsRes = await fetch(
        `${API_BASE_URL}/assignments/${assignment.id}/submissions`,
        { headers: getAuthHeader() }
      );
      if (!submissionsRes.ok) throw new Error('Failed to fetch submissions');
      const submissionsData = (await submissionsRes.json()).submissions || [];
      
      const submissionsMap: { [studentId: string]: Submission } = {};
      submissionsData.forEach((sub: Submission) => {
        submissionsMap[sub.student_id] = sub;
      });
      setSubmissions(submissionsMap);

      // 3. Select the first student by default
      if (studentsData.length > 0) {
        handleStudentSelect(studentsData[0]);
      }

    } catch (err: any) {
      logger.error('Error fetching grading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleStudentSelect = (student: EnrolledStudent) => {
    setSelectedStudent(student);
    const submission = submissions[student.id];
    if (submission) {
      setScore(submission.score?.toString() || '');
      setFeedback(submission.feedback || '');
    } else {
      setScore('');
      setFeedback('');
    }
  };
  
  const handleSaveGrade = async () => {
    if (!selectedStudent || !submissions[selectedStudent.id]) {
      toast.error('No submission found for this student.');
      return;
    }
    
    const submissionId = submissions[selectedStudent.id].id;
    setIsSaving(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/submissions/${submissionId}/grade`,
        {
          method: 'PUT',
          headers: getAuthHeader(),
          body: JSON.stringify({
            score: parseInt(score) || 0,
            feedback: feedback
          })
        }
      );
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save grade');

      // Update local state
      setSubmissions(prev => ({
        ...prev,
        [selectedStudent.id]: data
      }));
      
      toast.success('Grade saved successfully!');

    } catch (err: any) {
      logger.error('Error saving grade:', err);
      toast.error(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const getInitials = (name: string) => {
    const parts = name.split(' ');
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (first + last).toUpperCase() || 'S';
  };

  const filteredStudents = students.filter(s =>
    s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.nim.includes(searchQuery)
  );
  
  const selectedSubmission = selectedStudent ? submissions[selectedStudent.id] : null;

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" onClick={onBack} className="w-fit">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Module
        </Button>
        <h1 className="text-xl lg:text-2xl font-semibold truncate">
          Grade: {assignment.title}
        </h1>
        <div className="w-fit"></div>
      </div>
      
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <CardDescription>{error}</CardDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Student List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Students ({students.length})</CardTitle>
              <div className="relative pt-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search student..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardHeader>
            <CardContent className="max-h-[60vh] overflow-y-auto">
              {filteredStudents.length === 0 ? (
                <p className="text-muted-foreground text-center">No students found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredStudents.map(student => (
                    <Button
                      key={student.id}
                      variant={selectedStudent?.id === student.id ? 'secondary' : 'ghost'}
                      onClick={() => handleStudentSelect(student)}
                      className="w-full justify-start h-auto"
                    >
                      <Avatar className="w-8 h-8 mr-3">
                        <AvatarFallback className="text-xs">{getInitials(student.full_name)}</AvatarFallback>
                      </Avatar>
                      <div className="text-left">
                        <p className="font-medium">{student.full_name}</p>
                        <p className="text-xs text-muted-foreground">{student.nim}</p>
                      </div>
                      {submissions[student.id] && (
                        <CheckCircle className={`w-4 h-4 ml-auto ${
                          submissions[student.id].score ? 'text-green-600' : 'text-blue-600'
                        }`} />
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Submission & Grading Panel */}
          <Card className="lg:col-span-2">
            {!selectedStudent ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Select a student to view their submission.</p>
              </div>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>{selectedStudent.full_name}</CardTitle>
                  <CardDescription>NIM: {selectedStudent.nim}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Submission Content */}
                  <div className="space-y-4">
                    <h3 className="font-semibold">Submission</h3>
                    {!selectedSubmission ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <CardDescription>This student has not submitted an answer.</CardDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-4">
                        {selectedSubmission.submission_text && (
                          <div className="space-y-2">
                            <Label>Text Answer</Label>
                            <Textarea
                              value={selectedSubmission.submission_text}
                              readOnly
                              rows={8}
                              className="bg-muted"
                            />
                          </div>
                        )}
                        {selectedSubmission.submission_file_url && (
                          <div className="space-y-2">
                            <Label>Submitted File</Label>
                            <div>
                              <Button
                                variant="outline"
                                onClick={() => window.open(selectedSubmission.submission_file_url, '_blank')}
                              >
                                <FileText className="w-4 h-4 mr-2" />
                                {selectedSubmission.submission_file_name || 'View File'}
                              </Button>
                            </div>
                          </div>
                        )}
                         <p className="text-sm text-muted-foreground">
                            Submitted on: {new Date(selectedSubmission.submitted_at).toLocaleString()}
                         </p>
                      </div>
                    )}
                  </div>
                  
                  {/* Grading Form */}
                  <div className="space-y-4 pt-6 border-t">
                    <h3 className="font-semibold">Grade</h3>
                    <div className="space-y-2">
                      <Label htmlFor="score">Score</Label>
                      <Input
                        id="score"
                        type="number"
                        placeholder="Enter score..."
                        value={score}
                        onChange={(e) => setScore(e.target.value)}
                        disabled={!selectedSubmission || isSaving}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="feedback">Feedback</Label>
                      <Textarea
                        id="feedback"
                        placeholder="Provide feedback..."
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        disabled={!selectedSubmission || isSaving}
                        rows={4}
                      />
                    </div>
                    <Button
                      onClick={handleSaveGrade}
                      disabled={!selectedSubmission || isSaving || !score}
                    >
                      {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save Grade
                    </Button>
                  </div>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}