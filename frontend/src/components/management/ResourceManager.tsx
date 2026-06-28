import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { MultiSelect } from 'react-multi-select-component'; 
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3';
import { AlertCircle, Loader2, Settings, Trash2, Edit } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

const API_BASE_URL = '/api'; // Use proxied URL

// --- Interfaces ---
interface Course {
  id: number; // This is the 'courses' table ID
  offering_id: number; // This is the 'course_offerings' table ID
  course_code: string;
  course_name: string;
}
interface Module {
  id: number;
  module_title: string;
}
interface Student {
  id: string; // UUID
  full_name: string;
  nim: string;
}

// Interface for the new schedule list
interface Schedule {
  id: number;
  start_time: string;
  end_time: string;
  status: string;
  cpu_limit: string;
  memory_limit: string;
  storage_limit: string;
  users: {
    full_name: string;
    nim: string;
  } | null;
  modules: {
    module_title: string;
    courses: {
      course_code: string;
      course_name: string;
    } | null;
  } | null;
}

// Helper to format ISO strings to datetime-local
const toDateTimeLocal = (isoString: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
  return localISOTime;
};

export function ResourceManager() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  // Form State
  const [selectedOfferingId, setSelectedOfferingId] = useState<string>("");
  const [selectedModuleId, setSelectedModuleId] = useState<string>("");
  const [selectedStudents, setSelectedStudents] = useState<{ label: string, value: string }[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [limits, setLimits] = useState({ cpu: '1', memory: '1g', storage: '2g' });

  // Loading State
  const [loading, setLoading] = useState({ courses: true, modules: false, students: false, submitting: false });
  const [error, setError] = useState<string | null>(null);
  
  // State for schedule list
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  
  // State for editing
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [editForm, setEditForm] = useState({
    start_time: '',
    end_time: '',
    cpu_limit: '',
    memory_limit: '',
    storage_limit: ''
  });

  const { user } = useAuth();

  const getAuthHeader = () => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  // --- Data Fetching ---

  const fetchSchedules = async () => {
    setLoadingSchedules(true);
    try {
      const res = await fetch(`${API_BASE_URL}/schedules`, { headers: getAuthHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSchedules(data.schedules || []);
    } catch (err: any) {
      setError(err.message);
      toast.error("Failed to load existing schedules.");
    } finally {
      setLoadingSchedules(false);
    }
  };

  // Fetch courses AND schedules on component mount
  useEffect(() => {
    const fetchCourses = async () => {
      setLoading(prev => ({ ...prev, courses: true }));
      try {
        const res = await fetch(`${API_BASE_URL}/courses`, { headers: getAuthHeader() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setCourses(data.courses || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(prev => ({ ...prev, courses: false }));
      }
    };
    
    fetchCourses();
    fetchSchedules(); // Also fetch schedules
  }, []);

  const handleCourseChange = async (offeringId: string) => {
    if (!offeringId) {
      setSelectedOfferingId("");
      setSelectedModuleId("");
      setModules([]);
      setStudents([]);
      return;
    }
    setSelectedOfferingId(offeringId);
    setSelectedModuleId("");
    
    const course = courses.find(c => c.offering_id === parseInt(offeringId));
    if (!course) return;

    setLoading(prev => ({ ...prev, modules: true, students: true }));
    setError(null);
    try {
      // Fetch Modules for the master course ID
      const modRes = await fetch(`${API_BASE_URL}/courses/${course.id}/modules`, { headers: getAuthHeader() });
      const modData = await modRes.json();
      if (!modRes.ok) throw new Error(modData.error);
      setModules(modData.modules || []);

      // Fetch Students for the offering ID
      const stuRes = await fetch(`${API_BASE_URL}/course-offerings/${offeringId}/students`, { headers: getAuthHeader() });
      const stuData = await stuRes.json();
      if (!stuRes.ok) throw new Error(stuData.error);
      setStudents(stuData.students || []);

    } catch (err: any) {
      setError(err.message);
      setModules([]);
      setStudents([]);
    } finally {
      setLoading(prev => ({ ...prev, modules: false, students: false }));
    }
  };

  // --- Form Submission ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedModuleId || selectedStudents.length === 0 || !startTime || !endTime) {
      setError("Please fill in all fields: Module, Students, Start Time, and End Time.");
      return;
    }
    setLoading(prev => ({ ...prev, submitting: true }));
    
    const payload = {
      module_id: parseInt(selectedModuleId),
      student_ids: selectedStudents.map(s => s.value), // Pass list of UUIDs
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      limits: limits
    };

    try {
      const res = await fetch(`${API_BASE_URL}/schedules`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(data.message || "Sessions scheduled successfully!");
      
      // Reset form
      setSelectedModuleId("");
      setSelectedStudents([]);
      setStartTime('');
      setEndTime('');

      await fetchSchedules(); // Refresh the schedule list

    } catch (err: any) {
      setError(err.message);
      toast.error(err.message || "Failed to create schedules.");
    } finally {
      setLoading(prev => ({ ...prev, submitting: false }));
    }
  };

  // --- Handle Schedule Actions ---
  const handleDeleteSchedule = async (scheduleId: number) => {
    if (!window.confirm("Are you sure you want to delete this schedule?")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      toast.success("Schedule deleted successfully!");
      setSchedules(prev => prev.filter(s => s.id !== scheduleId)); // Remove from list
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message || "Failed to delete schedule.");
    }
  };

  const handleOpenEditDialog = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setEditForm({
      start_time: toDateTimeLocal(schedule.start_time),
      end_time: toDateTimeLocal(schedule.end_time),
      cpu_limit: schedule.cpu_limit,
      memory_limit: schedule.memory_limit,
      storage_limit: schedule.storage_limit,
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule) return;

    setLoading(prev => ({ ...prev, submitting: true }));
    setError(null);

    const payload = {
      start_time: new Date(editForm.start_time).toISOString(),
      end_time: new Date(editForm.end_time).toISOString(),
      cpu_limit: editForm.cpu_limit,
      memory_limit: editForm.memory_limit,
      storage_limit: editForm.storage_limit,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/schedules/${editingSchedule.id}`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Schedule updated successfully!");
      setIsEditDialogOpen(false);
      setEditingSchedule(null);
      await fetchSchedules(); // Refresh the list

    } catch (err: any) {
      setError(err.message);
      toast.error(err.message || "Failed to update schedule.");
    } finally {
      setLoading(prev => ({ ...prev, submitting: false }));
    }
  };


  const studentOptions = students.map(s => ({
    label: `${s.full_name} (${s.nim})`,
    value: s.id
  }));

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      <h1 className="text-2xl lg:text-3xl mb-2 flex items-center gap-2">
        <Settings className="h-7 w-7 text-primary" />
        Resource Scheduler
      </h1>
      <p className="text-muted-foreground text-sm lg:text-base">
        Schedule praktikum sessions for students with specific resource allocations.
      </p>

      {/* --- Create Schedule Form Card --- */}
      <Card>
        <CardHeader>
          <CardTitle>Create New Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: Course */}
            <div className="space-y-2">
              <Label>1. Select Course (from active period)</Label>
              <Select onValueChange={handleCourseChange} value={selectedOfferingId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a course..." />
                </SelectTrigger>
                <SelectContent>
                  {loading.courses ? (
                    <SelectItem value="loading" disabled>Loading...</SelectItem>
                  ) : (
                    courses.map(course => (
                      <SelectItem key={course.offering_id} value={course.offering_id.toString()}>
                        {course.course_name} ({course.course_code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: Module */}
            <div className="space-y-2">
              <Label>2. Select Module</Label>
              <Select 
                onValueChange={setSelectedModuleId} 
                value={selectedModuleId}
                disabled={!selectedOfferingId || loading.modules}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a module..." />
                </SelectTrigger>
                <SelectContent>
                  {loading.modules ? (
                    <SelectItem value="loading" disabled>Loading...</SelectItem>
                  ) : (
                    modules.map(module => (
                      <SelectItem key={module.id} value={module.id.toString()}>
                        {module.module_title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Step 3: Students */}
            <div className="space-y-2">
              <Label>3. Select Students</Label>
              <MultiSelect
                options={studentOptions}
                value={selectedStudents}
                onChange={setSelectedStudents}
                labelledBy="Select Students"
                isLoading={loading.students}
                disabled={!selectedOfferingId || loading.students}
              />
            </div>
            
            {/* Step 4: Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="start-time">4. Start Time</Label>
                <Input
                  id="start-time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-time">5. End Time</Label>
                <Input
                  id="end-time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            
            {/* --- MODIFIED: Step 6: Resources (with labels) --- */}
            <div className="space-y-2">
              <Label>6. Resource Limits</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div className="space-y-2">
                  <Label htmlFor="cpu-limit" className="mb-1.5">CPU (Cores)</Label>
                  <Input
                    id="cpu-limit"
                    placeholder="e.g., 1.5"
                    value={limits.cpu}
                    onChange={(e) => setLimits(p => ({...p, cpu: e.target.value}))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mem-limit" className="mb-1.5">Memory (e.g., 2g)</Label>
                  <Input
                    id="mem-limit"
                    placeholder="e.g., 2g"
                    value={limits.memory}
                    onChange={(e) => setLimits(p => ({...p, memory: e.target.value}))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="storage-limit" className="mb-1.5">Storage (e.g., 5g)</Label>
                  <Input
                    id="storage-limit"
                    placeholder="e.g., 5g"
                    value={limits.storage}
                    onChange={(e) => setLimits(p => ({...p, storage: e.target.value}))}
                  />
                </div>

              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Use 'g' for gigabytes (e.g., '2g') and '.' for cores (e.g., '0.5'). These are Docker limits.
              </p>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                <AlertCircle className="w-4 h-4" />
                <p>{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading.submitting}>
              {loading.submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Schedule {selectedStudents.length || ''} Session(s)
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* --- Card for Existing Schedules (with re-ordered columns) --- */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Schedules</CardTitle>
          <CardDescription>
            List of all currently scheduled lab sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingSchedules ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin inline" /> Loading schedules...
                    </TableCell>
                  </TableRow>
                ) : schedules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      No schedules created yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  schedules.map(schedule => (
                    <TableRow key={schedule.id}>
                      <TableCell>{schedule.modules?.courses?.course_name || 'N/A'}</TableCell>
                      <TableCell>{schedule.modules?.module_title || 'N/A'}</TableCell>
                      <TableCell>{new Date(schedule.start_time).toLocaleString()}</TableCell>
                      <TableCell>{new Date(schedule.end_time).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="font-medium">{schedule.users?.full_name || 'N/A'}</div>
                        <div className="text-sm text-muted-foreground">{schedule.users?.nim || ''}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={schedule.status === 'ACTIVE' ? 'default' : 'secondary'}>
                          {schedule.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEditDialog(schedule)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteSchedule(schedule.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* --- NEW: Edit Schedule Dialog --- */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Schedule</DialogTitle>
            <CardDescription>
              Editing for: {editingSchedule?.users?.full_name} <br/>
              Module: {editingSchedule?.modules?.module_title}
            </CardDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateSchedule}>
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="edit-start-time">Start Time</Label>
                  <Input
                    id="edit-start-time"
                    type="datetime-local"
                    value={editForm.start_time}
                    onChange={(e) => setEditForm(p => ({...p, start_time: e.target.value}))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-end-time">End Time</Label>
                  <Input
                    id="edit-end-time"
                    type="datetime-local"
                    value={editForm.end_time}
                    onChange={(e) => setEditForm(p => ({...p, end_time: e.target.value}))}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Resource Limits</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="edit-cpu-limit" className="mb-1.5">CPU (Cores)</Label>
                    <Input
                      id="edit-cpu-limit"
                      value={editForm.cpu_limit}
                      onChange={(e) => setEditForm(p => ({...p, cpu_limit: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-mem-limit" className="mb-1.5">Memory (e.g., 2g)</Label>
                    <Input
                      id="edit-mem-limit"
                      value={editForm.memory_limit}
                      onChange={(e) => setEditForm(p => ({...p, memory_limit: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-storage-limit" className="mb-1.5">Storage (e.g., 5g)</Label>
                    <Input
                      id="edit-storage-limit"
                      value={editForm.storage_limit}
                      onChange={(e) => setEditForm(p => ({...p, storage_limit: e.target.value}))}
                    />
                  </div>
                </div>
              </div>
              
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  <AlertCircle className="w-4 h-4" />
                  <p>{error}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading.submitting}>
                {loading.submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}