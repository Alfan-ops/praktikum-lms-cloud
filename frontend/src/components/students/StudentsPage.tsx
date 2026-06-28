import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../ui/dialog';
import {
  Search,
  Mail,
  User,
  GraduationCap,
  Download,
  Plus,
  Trash2,
  AlertCircle,
  X,
  Upload, // Import Upload icon
  Loader2 // Import Loader2
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { toast } from 'sonner@2.0.3'; // Import toast

// API base URL
const API_BASE_URL = '/api'

// Interface for the student data (must match Supabase table)
interface Student {
  id: string;
  full_name: string;
  email: string;
  nim: string;
  role: string;
  created_at?: string;
}

export function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newStudent, setNewStudent] = useState({
    email: '',
    password: '',
    full_name: '',
    nim: ''
  });

  // --- New State for Import ---
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user } = useAuth();

  const getAuthHeader = () => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    if (!token) {
      logger.warn('Auth token not found for API call.');
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  // --- API Interaction Functions ---

  const fetchStudents = async () => {
    logger.info('Fetching students...');
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/students`, {
        headers: getAuthHeader()
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setStudents(data.students || []);
      logger.info(`Fetched ${data.students?.length || 0} students.`);

    } catch (err: any) {
      logger.error('Error fetching students:', err);
      setError(err.message || 'Failed to fetch students.');
      setStudents([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    logger.info('Attempting to add student:', { ...newStudent, password: '***' });
    setError(null);

    if (!newStudent.full_name || !newStudent.email || !newStudent.password || !newStudent.nim) {
      setError('Please fill in all fields (Full Name, NIM, Email, Password).');
      return;
    }
    if (!newStudent.email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/students`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify(newStudent)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      logger.info('Student added successfully:', data.student);
      setIsAddDialogOpen(false);
      setNewStudent({ email: '', password: '', full_name: '', nim: '' });
      
      setStudents(prevStudents => [...prevStudents, data.student]);

    } catch (err: any) {
      logger.error('Error adding student:', err);
      setError(err.message || 'Failed to add student.');
    }
  };

const handleDeleteStudent = async (studentId: string, studentName: string) => {
    if (!window.confirm(`Are you sure you want to delete this student: ${studentName} (${studentId})? This action cannot be undone.`)) {
      return;
    }

    logger.info(`Attempting to delete student ${studentId}`);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/students/${studentId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });

      const data = await response.json();

      if (response.status === 404) {
        // User is already gone from database. This is fine.
        logger.warn(`Student ${studentId} was already deleted.`);
        toast.info("Student was already deleted or could not be found. List updated.");
        // Update the UI to match the database
        setStudents(prevStudents => prevStudents.filter(student => student.id !== studentId));
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      // Success case (200 OK)
      logger.info(`Student ${studentId} deleted successfully.`);
      toast.success("Student deleted successfully."); // Added toast for better feedback
      
      setStudents(prevStudents => prevStudents.filter(student => student.id !== studentId));

    } catch (err: any) {
      logger.error(`Error deleting student ${studentId}:`, err);
      setError(err.message || 'Failed to delete student.');
    }
  };

  const handleExport = () => {
    logger.info('Exporting student data...');
    if (students.length === 0) {
      toast.error('No student data to export.');
      return;
    }

    // 1. Format data for the sheet
    const dataToExport = students.map(student => ({
      NIM: student.nim,
      FullName: student.full_name,
      Email: student.email,
      Role: student.role,
      UserID: student.id,
    }));

    // 2. Create a new workbook and add the data
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');

    // 3. Set column widths (optional, but looks nicer)
    worksheet['!cols'] = [
      { wch: 15 }, // NIM
      { wch: 30 }, // FullName
      { wch: 35 }, // Email
      { wch: 10 }, // Role
      { wch: 40 }, // UserID
    ];

    // 4. Trigger the download
    try {
      XLSX.writeFile(workbook, 'Student_Export.xlsx');
      toast.success('Student data exported successfully!');
    } catch (err: any) {
      logger.error('Error exporting students:', err);
      toast.error('Failed to export data.');
    }
  };


  // Handle File Upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset file input
    if (e.target) e.target.value = '';
  };

  const processFile = (file: File) => {
    setError(null);
    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);

        if (json.length === 0) {
          throw new Error('File is empty or format is incorrect.');
        }

        // Map data to expected keys (e.g., 'Full Name' -> 'full_name')
        // This makes your Excel columns flexible
        const studentsToUpload = json.map((row: any) => ({
          full_name: row['Full Name'] || row['full_name'] || row['Nama'],
          email: row['Email'] || row['email'],
          nim: row['NIM'] || row['nim'],
          password: row['Password'] || row['password'] // Optional, backend will use default
        }));
        
        // Send to new backend endpoint
        const response = await fetch(`${API_BASE_URL}/students/bulk-upload`, {
          method: 'POST',
          headers: getAuthHeader(),
          body: JSON.stringify(studentsToUpload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Bulk upload failed');
        }
        
        toast.success(result.message);
        if (result.errors?.length > 0) {
          logger.warn('Bulk upload errors:', result.errors);
          setError(`Import finished with ${result.errors.length} errors. Check console for details.`);
        }
        
        // Add new students to state
        setStudents(prev => [...prev, ...result.created_students]);

      } catch (err: any) {
        logger.error('Error processing file:', err);
        setError(err.message || 'Failed to process file.');
        toast.error(err.message || 'Failed to process file.');
      } finally {
        setIsImporting(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  // --- End API Functions ---

  useEffect(() => {
    fetchStudents();
  }, []);

  const filteredStudents = students.filter(student =>
    student.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    student.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    student.nim?.includes(searchQuery)
  );

  const stats = {
    total: students.length,
    active: students.filter(s => s.role === 'student').length 
  };

  const getInitials = (name: string | null | undefined): string => {
    if (!name) return 'S';
    const parts = name.split(' ');
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (first + last).toUpperCase() || 'S';
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2">Student Management</h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            Manage student enrollment, track progress, and monitor academic performance
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {/* --- NEW: Import Button --- */}
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Import
          </Button>
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
          />

          <Button variant="outline" className="w-full sm:w-auto" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto" onClick={() => { setIsAddDialogOpen(true); setError(null); }}>
                <Plus className="w-4 h-4 mr-2" />
                Add Student
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleAddStudent}>
                <DialogHeader>
                  <DialogTitle>Add New Student</DialogTitle>
                  <DialogDescription>
                    Create a new student account. They can log in immediately.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name</Label>
                    <Input
                      id="full_name"
                      value={newStudent.full_name}
                      onChange={(e) => setNewStudent({ ...newStudent, full_name: e.target.value })}
                      placeholder="Enter full name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nim">NIM (Student ID)</Label>
                    <Input
                      id="nim"
                      value={newStudent.nim}
                      onChange={(e) => setNewStudent({ ...newStudent, nim: e.target.value })}
                      placeholder="Enter NIM"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newStudent.email}
                      onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                      placeholder="student@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={newStudent.password}
                      onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
                      placeholder="Enter a strong password"
                      required
                      minLength={6}
                    />
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                        <AlertCircle className="w-4 h-4" />
                        <p>{error}</p>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Student
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

       {/* General Error Display */}
       {!isAddDialogOpen && error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>
               <X className="h-4 w-4" />
            </span>
          </div>
        )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Total Students</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{loading ? '...' : stats.total}</div>
            <p className="text-xs text-muted-foreground">
              Registered in system
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Active Students</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{loading ? '...' : stats.active}</div>
            <p className="text-xs text-muted-foreground">
              'student' role
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search students by name, email, or NIM..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              disabled={loading}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Students Table */}
      <Card>
        <CardHeader>
          <CardTitle>Students ({loading ? '...' : filteredStudents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading students...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>NIM</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No students found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStudents.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs">
                                {getInitials(student.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">{student.full_name || 'N/A'}</div>
                              <Badge variant="outline" className="text-xs mt-1 capitalize">{student.role}</Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{student.nim || 'N/A'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="w-3 h-3" />
                            {student.email}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteStudent(student.id, student.full_name)}
                              aria-label={`Delete student ${student.full_name}`}
                              className="text-destructive hover:bg-destructive/10"
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
