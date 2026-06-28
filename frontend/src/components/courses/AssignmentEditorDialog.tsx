import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Save, Loader2, AlertCircle } from 'lucide-react';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3';

const API_BASE_URL = '/api'

// Add this interface
interface Assignment {
  id: number;
  course_id: number;
  title: string;
  description: string;
  submission_start: string;
  submission_end: string;
  max_score: number;
}

interface AssignmentEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: number;
  onSave: (newAssignment: any) => void; // Callback to add/update assignment
  getAuthHeader: () => { [key: string]: string };
  assignmentToEdit?: Assignment | null; // <-- ADD THIS PROP
  onClose: () => void; // <-- ADD THIS PROP
}

// Helper to format ISO strings to datetime-local
const toDateTimeLocal = (isoString: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
  return localISOTime;
};

export function AssignmentEditorDialog({
  open,
  onOpenChange,
  courseId,
  onSave,
  getAuthHeader,
  assignmentToEdit, // <-- New prop
  onClose // <-- New prop
}: AssignmentEditorDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [maxScore, setMaxScore] = useState(100);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!assignmentToEdit;

  // Use useEffect to populate form when assignmentToEdit changes
  useEffect(() => {
    if (isEditMode && assignmentToEdit) {
      setTitle(assignmentToEdit.title);
      setDescription(assignmentToEdit.description || '');
      setStartTime(toDateTimeLocal(assignmentToEdit.submission_start));
      setEndTime(toDateTimeLocal(assignmentToEdit.submission_end));
      setMaxScore(assignmentToEdit.max_score || 100);
    } else {
      // Reset form when not in edit mode (or prop becomes null)
      setTitle('');
      setDescription('');
      setStartTime('');
      setEndTime('');
      setMaxScore(100);
    }
  }, [assignmentToEdit, isEditMode, open]); // Re-run when dialog opens too

  const handleSubmit = async () => {
    setError(null);
    if (!title || !startTime || !endTime) {
      setError('Title, Start Time, and End Time are required.');
      return;
    }
    setLoading(true);

    const payload = {
      course_id: isEditMode ? undefined : courseId, // Only send course_id on create
      title: title,
      description: description,
      submission_start: new Date(startTime).toISOString(),
      submission_end: new Date(endTime).toISOString(),
      max_score: maxScore
    };

    const url = isEditMode
      ? `${API_BASE_URL}/assignments/${assignmentToEdit?.id}`
      : `${API_BASE_URL}/assignments`;
    
    const method = isEditMode ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method: method,
        headers: getAuthHeader(),
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${isEditMode ? 'update' : 'create'} assignment`);
      }
      
      toast.success(`Assignment ${isEditMode ? 'updated' : 'created'} successfully`);
      onSave(data.assignment || data); // Pass the new/updated assignment back
      handleClose(); // Close the dialog
      
    } catch (err: any) {
      logger.error(`Error ${isEditMode ? 'updating' : 'creating'} assignment:`, err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setLoading(false);
    onClose(); // Use the new onClose prop
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Assignment' : 'Create New Assignment'}</DialogTitle>
          <DialogDescription>
            {isEditMode 
              ? 'Update the details for this assignment.' 
              : 'This will create a new gradable assignment for this course.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              <AlertCircle className="w-4 h-4" />
              <p>{error}</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="title">Assignment Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Submission Start</Label>
              <Input id="start-time" type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">Submission End</Label>
              <Input id="end-time" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="score">Max Score</Label>
            <Input id="score" type="number" value={maxScore} onChange={(e) => setMaxScore(parseInt(e.target.value) || 100)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEditMode ? 'Save Changes' : 'Create Assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}