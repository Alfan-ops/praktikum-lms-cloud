import React, { useState, useEffect } from 'react';
import { Calendar, Clock, FileText, Upload, CheckCircle, AlertCircle, Award, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription } from '../ui/alert';
import { toast } from 'sonner@2.0.3';
import { useAuth } from '../auth/AuthProvider'; // *** FIX: Use AuthProvider
import { logger } from '../utils/logger';

const API_BASE_URL = '/api'

interface Assignment {
  id: number;
  course_id: string;
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
  submission_text?: string;
  submission_file_url?: string;
  submission_file_name?: string;
  submitted_at: string;
  score?: number;
  feedback?: string;
}

interface AssignmentSubmissionCardProps {
  assignment: Assignment;
  courseId: string;
  showGrade?: boolean;
  userId?: string;
}

export function AssignmentSubmissionCard({ 
  assignment, 
  courseId, 
  showGrade = false,
  userId 
}: AssignmentSubmissionCardProps) {
  const [submissionText, setSubmissionText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSubmission, setLoadingSubmission] = useState(true);

  const { user } = useAuth(); // *** FIX: Get user from auth ***

  // *** FIX: Get auth token helper ***
  const getAuthHeader = (isFormData: boolean = false) => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;

    if (!token) {
      logger.warn('Auth token not found for API call');
      return isFormData ? {} : { 'Content-Type': 'application/json' };
    }
    
    if (isFormData) {
      // Don't set Content-Type, browser does it with boundary
      return { 'Authorization': `Bearer ${token}` };
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  useEffect(() => {
    if (userId) {
      fetchExistingSubmission();
    } else {
      setLoadingSubmission(false);
    }
  }, [assignment.id, userId]);

  const fetchExistingSubmission = async () => {
    if (!userId) return;
    try {
      setLoadingSubmission(true);
      // *** FIX: Use new API endpoint ***
      const res = await fetch(
        `${API_BASE_URL}/submissions?assignment_id=${assignment.id}&student_id=${userId}`,
        {
          headers: getAuthHeader(), // *** FIX: Use auth header ***
        }
      );

      if (res.ok) {
        const submissions: Submission[] = await res.json();
        if (submissions.length > 0) {
          const submission = submissions[0];
          setExistingSubmission(submission);
          setSubmissionText(submission.submission_text || '');
        }
      }
    } catch (error) {
      logger.error('Error fetching submission:', error);
    } finally {
      setLoadingSubmission(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleSaveAnswer = async () => {
    if (!userId) {
      toast.error('User not authenticated');
      return;
    }

    if (!submissionText.trim() && !selectedFile) {
      toast.error('Please provide a text answer or upload a file');
      return;
    }

    try {
      setLoading(true);

      let fileUrl = existingSubmission?.submission_file_url;
      let fileName = existingSubmission?.submission_file_name;

      // Upload file if selected
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);

        // *** FIX: Use new API endpoint and auth ***
        const uploadRes = await fetch(
          `${API_BASE_URL}/upload-submission`,
          {
            method: 'POST',
            headers: getAuthHeader(true), // Use FormData auth header
            body: formData,
          }
        );

        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error || 'Failed to upload file');
        }
        const uploadData = await uploadRes.json();
        fileUrl = uploadData.file_url;
        fileName = uploadData.file_name; // Use name from server
      }

      // Submit or update submission
      const submissionData = {
        assignment_id: assignment.id,
        submission_text: submissionText.trim() || null,
        submission_file_url: fileUrl || null,
        submission_file_name: fileName || null,
      };

      // *** FIX: Use new API endpoint and auth ***
      const res = await fetch(`${API_BASE_URL}/submissions`, {
        method: 'POST', // The backend will check if it exists and update or create
        headers: getAuthHeader(),
        body: JSON.stringify(submissionData),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save submission');
      }

      const savedSubmission = await res.json();
      setExistingSubmission(savedSubmission);
      setSelectedFile(null); // Clear selected file after successful save
      
      toast.success(existingSubmission ? 'Answer updated successfully' : 'Answer submitted successfully');
    } catch (error: any) {
      logger.error('Error saving submission:', error);
      toast.error(error.message || 'Failed to save answer');
    } finally {
      setLoading(false);
    }
  };

  const isBeforeStart = new Date() < new Date(assignment.submission_start);
  const isAfterEnd = new Date() > new Date(assignment.submission_end);
  const isOpen = !isBeforeStart && !isAfterEnd;

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/30">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <Badge variant={isOpen ? 'default' : isBeforeStart ? 'secondary' : 'destructive'}>
                {isBeforeStart ? 'Not Open' : isAfterEnd ? 'Closed' : 'Open'}
              </Badge>
              {existingSubmission && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Submitted
                </Badge>
              )}
            </div>
            <CardTitle>{assignment.title}</CardTitle>
            <CardDescription className="mt-2">{assignment.description}</CardDescription>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-start gap-3 p-3 bg-white rounded-lg border">
            <Calendar className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">Submission Start</p>
              <p className="font-medium">{formatDateTime(assignment.submission_start)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-white rounded-lg border">
            <Clock className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">Submission End</p>
              <p className="font-medium">{formatDateTime(assignment.submission_end)}</p>
            </div>
          </div>
        </div>

        {showGrade && existingSubmission && existingSubmission.score !== null && existingSubmission.score !== undefined && (
          <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <Award className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Your Grade</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {existingSubmission.score} / {assignment.max_score}
                  </p>
                </div>
              </div>
              {existingSubmission.feedback && (
                <div className="text-right">
                  <p className="text-sm text-gray-600">Feedback</p>
                  <p className="text-sm font-medium text-gray-800 max-w-xs">{existingSubmission.feedback}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {!isOpen && !existingSubmission && (
          <Alert variant={isBeforeStart ? 'default' : 'destructive'}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {isBeforeStart
                ? 'This assignment is not open yet. You can submit once the submission period starts.'
                : 'This assignment is now closed. No further submissions are allowed.'}
            </AlertDescription>
          </Alert>
        )}
        
        <div className="space-y-4 p-4 bg-white rounded-lg border">
          <div>
            <label className="block text-sm font-medium mb-2">Your Answer (Text)</label>
            <Textarea
              placeholder="Type your answer here..."
              value={submissionText}
              onChange={(e) => setSubmissionText(e.target.value)}
              rows={6}
              disabled={!isOpen || loading || loadingSubmission}
              className="resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Upload File (Optional)</label>
            <div className="flex items-center gap-3">
              <Input
                type="file"
                onChange={handleFileChange}
                disabled={!isOpen || loading || loadingSubmission}
                className="flex-1"
              />
              {selectedFile && (
                <Badge variant="secondary" className="shrink-0">
                  {selectedFile.name}
                </Badge>
              )}
            </div>
            {existingSubmission?.submission_file_name && !selectedFile && (
              <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                <FileText className="w-4 h-4" />
                <span>Current file: {existingSubmission.submission_file_name}</span>
                {existingSubmission.submission_file_url && (
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto"
                    onClick={() => window.open(existingSubmission.submission_file_url, '_blank')}
                  >
                    View
                  </Button>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={handleSaveAnswer}
            disabled={(!isOpen && !existingSubmission) || loading || loadingSubmission || (!submissionText.trim() && !selectedFile && !existingSubmission) }
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : existingSubmission ? (
              <CheckCircle className="w-4 h-4 mr-2" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            {existingSubmission ? 'Update Answer' : 'Save Answer'}
          </Button>

          {existingSubmission && (
            <p className="text-sm text-center text-gray-500">
              Last submitted: {formatDateTime(existingSubmission.submitted_at)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}