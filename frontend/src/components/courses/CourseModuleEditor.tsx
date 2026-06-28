import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '../ui/dialog';
import { 
  Plus, 
  Edit, 
  Trash2, 
  FileText, 
  Video, 
  Book,
  Save,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Link as LinkIcon,
  BookCopy,
  FileUp,
  GraduationCap
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { AssignmentEditorDialog } from './AssignmentEditorDialog';
import { toast } from 'sonner@2.0.3';
import { AssignmentGradingPage } from '../assignments/AssignmentGradingPage'; // Import the new grading page

const API_BASE_URL = '/api'

// --- Interfaces ---
interface Module {
  id: number;
  course_id: number;
  module_title: string;
  description: string;
}

interface ModuleContent {
  id: number;
  module_id: number;
  order_index: number;
  content_type: 'text' | 'file' | 'assignment' | 'virtual_lab';
  content_data: any; // JSON data
}

interface Assignment {
  id: number;
  course_id: number;
  title: string;
  description: string;
}

interface CourseModuleEditorProps {
  courseId: number; // Master Course ID
  courseOfferingId: number; // Offering ID for this period
  courseName: string;
  onBack: () => void; // Prop to go back to course list
}

export function CourseModuleEditor({ courseId, courseOfferingId, courseName, onBack }: CourseModuleEditorProps) {
  // --- STATE FOR MODULE LIST ---
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [editingModule, setEditingModule] = useState<Module | null>(null);

  // --- STATE TO MANAGE VIEWS ---
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [gradingAssignment, setGradingAssignment] = useState<Assignment | null>(null); // For grading view

  const { user } = useAuth();

  const getAuthHeader = () => {
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  // --- API Functions for MODULES ---

  const fetchModules = async () => {
    logger.info(`Fetching modules for course ID: ${courseId}`);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/courses/${courseId}/modules`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to fetch modules');
      }
      const data = await response.json();
      setModules(data.modules || []);
    } catch (err: any) {
      logger.error('Error fetching modules:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (courseId) {
      fetchModules();
    }
  }, [courseId]);

  const handleAddModule = async () => {
    if (!newModuleTitle) {
      setError('Module title is required.');
      return;
    }
    logger.info(`Adding new module: ${newModuleTitle}`);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/modules`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({
          course_id: courseId,
          module_title: newModuleTitle,
          description: ''
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create module');
      }
      setModules([...modules, data.module]);
      setNewModuleTitle('');
      setIsAddModuleOpen(false);
    } catch (err: any) {
      logger.error('Error adding module:', err);
      setError(err.message);
    }
  };

  const handleUpdateModule = async () => {
    if (!editingModule) return;
    logger.info(`Updating module ID: ${editingModule.id}`);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/modules/${editingModule.id}`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify({
          module_title: editingModule.module_title,
          description: editingModule.description
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update module');
      }
      setModules(modules.map(m => (m.id === data.module.id ? data.module : m)));
      setEditingModule(null);
    } catch (err: any) {
      logger.error('Error updating module:', err);
      setError(err.message);
    }
  };

  const handleDeleteModule = async (moduleId: number) => {
    if (!window.confirm('Are you sure you want to delete this module and all its content?')) {
      return;
    }
    logger.info(`Deleting module ID: ${moduleId}`);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/modules/${moduleId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete module');
      }
      setModules(modules.filter(m => m.id !== moduleId));
    } catch (err: any) {
      logger.error('Error deleting module:', err);
      setError(err.message);
    }
  };

  // --- RENDER FUNCTION for Module List ---
  const renderModuleList = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-2 text-muted-foreground">Loading Modules...</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Course Modules</h3>
          <Dialog open={isAddModuleOpen} onOpenChange={setIsAddModuleOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" onClick={() => { 
                setIsAddModuleOpen(true); 
                setNewModuleTitle(''); 
                setError(null); 
              }}>
                <Plus className="w-4 h-4 mr-2" />
                Add Module
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Module</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    <AlertCircle className="w-4 h-4" />
                    <p>{error}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="module-title">Module Title</Label>
                  <Input
                    id="module-title"
                    value={newModuleTitle}
                    onChange={(e) => setNewModuleTitle(e.target.value)}
                    placeholder="e.g., Modul 1: Pengenalan"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddModuleOpen(false)}>Cancel</Button>
                <Button onClick={handleAddModule}>
                  <Plus className="w-4 h-4 mr-2" /> Add Module
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {error && !isAddModuleOpen && !editingModule && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3 cursor-pointer" onClick={() => setError(null)}>
               <X className="h-4 w-4" />
            </span>
          </div>
        )}

        {/* Modules List */}
        <div className="space-y-4">
          {modules.map((module, index) => (
            <Card key={module.id} className="border-l-4 border-l-primary">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div 
                    className="flex-1 space-y-1 cursor-pointer"
                    onClick={() => setSelectedModule(module)}
                  >
                     <h4 className="text-lg font-semibold hover:underline">{module.module_title}</h4>
                     <p className="text-sm text-muted-foreground">{module.description || 'No description'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Module {index + 1}</Badge>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => { setEditingModule(module); setError(null); }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDeleteModule(module.id)}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
          
          {modules.length === 0 && !loading && (
             <Card>
              <CardContent className="text-center p-8">
                <Book className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">No modules created yet for this course.</p>
                <Button onClick={() => { setIsAddModuleOpen(true); setError(null); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Module
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Edit Module Dialog */}
        <Dialog open={!!editingModule} onOpenChange={(open) => !open && setEditingModule(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Module</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
               {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                     <AlertCircle className="w-4 h-4" />
                     <p>{error}</p>
                  </div>
               )}
              <div className="space-y-2">
                <Label htmlFor="edit-module-title">Module Title</Label>
                <Input
                  id="edit-module-title"
                  value={editingModule?.module_title || ''}
                  onChange={(e) => setEditingModule(prev => prev ? { ...prev, module_title: e.target.value } : null)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-module-desc">Description</Label>
                <Textarea
                  id="edit-module-desc"
                  value={editingModule?.description || ''}
                  onChange={(e) => setEditingModule(prev => prev ? { ...prev, description: e.target.value } : null)}
                  placeholder="Module description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingModule(null)}>Cancel</Button>
              <Button onClick={handleUpdateModule}>
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  // --- RENDER FUNCTION for Module Content Editor ---
  const renderModuleContentEditor = () => {
    if (!selectedModule) return null;
    
    // --- NEW: Check if we are grading ---
    if (gradingAssignment) {
      return (
        <AssignmentGradingPage
          assignment={gradingAssignment}
          courseOfferingId={courseOfferingId} // Pass the ID
          onBack={() => setGradingAssignment(null)} // Function to return
          getAuthHeader={getAuthHeader}
        />
      );
    }
    
    // Otherwise, show the content editor
    return (
      <ModuleContentEditor
        courseId={courseId}
        courseOfferingId={courseOfferingId}
        module={selectedModule}
        onBack={() => {
          setSelectedModule(null);
          setError(null);
        }}
        getAuthHeader={getAuthHeader}
        onStartGrading={setGradingAssignment} // Pass the function to start grading
      />
    );
  };

  // --- MAIN RENDER LOGIC ---
  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Button variant="outline" onClick={onBack} className="w-fit">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Courses
        </Button>
        <h1 className="text-xl lg:text-2xl font-semibold truncate">
          {courseName}
        </h1>
        <div className="w-fit"></div> 
      </div>
      
      {selectedModule || gradingAssignment ? renderModuleContentEditor() : renderModuleList()}
      
    </div>
  );
}


// ######################################################################
// #  INTERNAL COMPONENT FOR MODULE *CONTENT*
// #  This lives inside CourseModuleEditor.tsx
// ######################################################################

interface ModuleContentEditorProps {
  courseId: number;
  courseOfferingId: number; // Added to pass to grading page
  module: Module;
  onBack: () => void;
  getAuthHeader: () => { [key: string]: string };
  onStartGrading: (assignment: Assignment) => void; // Callback to open grader
}

function ModuleContentEditor({ 
  courseId, 
  courseOfferingId, 
  module, 
  onBack, 
  getAuthHeader, 
  onStartGrading 
}: ModuleContentEditorProps) {
  const [content, setContent] = useState<ModuleContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State for content dialogs
  const [isTextOpen, setIsTextOpen] = useState(false);
  const [isLabOpen, setIsLabOpen] = useState(false);
  const [isAssignmentLinkOpen, setIsAssignmentLinkOpen] = useState(false);
  const [isAssignmentCreateOpen, setIsAssignmentCreateOpen] = useState(false);
  
  const [isFileOpen, setIsFileOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [currentText, setCurrentText] = useState('');
  const [currentLabName, setCurrentLabName] = useState('');
  
  const [editingContent, setEditingContent] = useState<ModuleContent | null>(null);

  // State for assignment picker
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');

  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);

  // --- API Functions for CONTENT ---
  const fetchModuleContent = async () => {
    logger.info(`Fetching content for module ID: ${module.id}`);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/modules/${module.id}/content`, {
        headers: getAuthHeader()
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to fetch module content');
      }
      const data = await response.json();
      setContent((data.content || []).sort((a: ModuleContent, b: ModuleContent) => a.order_index - b.order_index));
    } catch (err: any) {
      logger.error('Error fetching module content:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const fetchAssignments = async () => {
     try {
      const response = await fetch(`${API_BASE_URL}/courses/${courseId}/assignments`, {
        headers: getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to fetch assignments');
      const data = await response.json();
      setAllAssignments(data.assignments || []);
    } catch (err: any) {
      logger.error('Error fetching assignments:', err);
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchModuleContent();
    fetchAssignments();
  }, [module.id]);

  const saveContent = async (
    type: 'text' | 'file' | 'assignment' | 'virtual_lab', 
    data: any,
    onClose: () => void
  ) => {
    const isEditing = !!editingContent;
    const url = isEditing
      ? `${API_BASE_URL}/module-content/${editingContent.id}`
      : `${API_BASE_URL}/module-content`;
    const method = isEditing ? 'PUT' : 'POST';

    const body = {
      module_id: module.id,
      content_type: type,
      content_data: data,
      order_index: isEditing ? editingContent.order_index : content.length,
    };
    logger.info(`${isEditing ? 'Updating' : 'Creating'} content...`, body);

    try {
      const response = await fetch(url, {
        method: method,
        headers: getAuthHeader(),
        body: JSON.stringify(body)
      });
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to save content');
      }
      
      await fetchModuleContent(); // Refresh list
      onClose(); // Close the specific dialog
    } catch (err: any) {
      logger.error('Error saving content:', err);
      setError(err.message);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload.');
      return;
    }
    
    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const authHeader = getAuthHeader();
      delete authHeader['Content-Type']; 

      const uploadRes = await fetch(
        `${API_BASE_URL}/upload-module-file`,
        {
          method: 'POST',
          headers: authHeader,
          body: formData,
        }
      );

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadData.error || 'Failed to upload file');
      }

      const fileContentData = {
        file_url: uploadData.file_url,
        file_name: uploadData.file_name,
        file_size: uploadData.file_size,
      };

      await saveContent('file', fileContentData, closeFileDialog);
      toast.success('File uploaded and added to module!');

    } catch (err: any) {
      logger.error('Error uploading file:', err);
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteContent = async (contentId: number) => {
    if (!window.confirm('Are you sure you want to delete this content item?')) return;
    logger.info(`Deleting module content ID: ${contentId}`);
    try {
      const response = await fetch(`${API_BASE_URL}/module-content/${contentId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete content');
      }
      await fetchModuleContent(); // Refresh list
    } catch (err: any) {
       logger.error('Error deleting content:', err);
       setError(err.message);
    }
  };

  const closeTextDialog = () => { setIsTextOpen(false); setEditingContent(null); setCurrentText(''); setError(null); };
  const closeLabDialog = () => { setIsLabOpen(false); setEditingContent(null); setCurrentLabName(''); setError(null); };
  const closeAssignmentLinkDialog = () => { setIsAssignmentLinkOpen(false); setEditingContent(null); setSelectedAssignmentId(''); setError(null); };
  const closeFileDialog = () => {
    setIsFileOpen(false);
    setSelectedFile(null);
    setError(null);
    setIsUploading(false);
  };

  // --- Render Functions ---
  const renderContentItem = (item: ModuleContent) => {
    let icon = <FileText className="w-5 h-5 text-gray-500" />;
    let title = 'Content';
    let description = '';
    let borderColor = '#6b7280'; // gray-500
    let button = (
      <Button 
        variant="ghost" 
        size="sm"
        onClick={() => handleDeleteContent(item.id)}
        className="text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    );

    switch(item.content_type) {
      case 'text':
        icon = <BookCopy className="w-5 h-5 text-blue-600" />;
        title = "Text Block";
        description = item.content_data.text?.substring(0, 100) + '...';
        borderColor = '#2563eb'; // blue-600
        break;
      case 'file':
        icon = <FileUp className="w-5 h-5 text-green-600" />;
        title = `File: ${item.content_data.file_name || 'N/A'}`;
        description = `URL: ${item.content_data.file_url}`;
        borderColor = '#16a34a'; // green-600
        break;
      case 'assignment':
        icon = <GraduationCap className="w-5 h-5 text-purple-600" />;
        const linkedAssignment = allAssignments.find(a => a.id === item.content_data.assignment_id);
        title = `Assignment: ${linkedAssignment?.title || 'Unknown'}`;
        description = `Links to assignment ID ${item.content_data.assignment_id}`;
        borderColor = '#7c3aed'; // purple-600
        
        button = (
          <div className="flex gap-1">
            {linkedAssignment && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onStartGrading(linkedAssignment)}
                >
                  Grade
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingAssignment(linkedAssignment); // <-- Set assignment to edit
                    setIsAssignmentCreateOpen(true); // <-- Open the dialog
                  }}
                >
                  <Edit className="w-4 h-4" />
                </Button>
              </>
            )}
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => handleDeleteContent(item.id)}
              className="text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        );
        break;
      case 'virtual_lab':
        icon = <LinkIcon className="w-5 h-5 text-orange-600" />;
        title = "Virtual Lab Link";
        description = `Lab Name: ${item.content_data.lab_name}`;
        borderColor = '#ea580c'; // orange-600
        break;
    }

    return (
      <Card key={item.id} className="border-l-4" style={{ borderColor }}>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-start gap-4">
            <div className="mt-1">{icon}</div>
            <div className="flex-1">
              <h4 className="font-semibold">{title}</h4>
              <p className="text-sm text-muted-foreground truncate">{description}</p>
            </div>
          </div>
          {button}
        </CardContent>
      </Card>
    );
  };

  if (loading) {
     return (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-2 text-muted-foreground">Loading Module Content...</p>
        </div>
    );
  }

  return (
    <div className="space-y-4 pt-4 border-t">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{module.module_title}: Content</h3>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Module List
        </Button>
      </div>

      {/* Add Content Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Add Content to Module</CardTitle>
          <CardDescription>
            Add text, files, assignments, or virtual lab links.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsTextOpen(true)}>
            <BookCopy className="w-4 h-4 mr-2" /> Add Text
          </Button>
          <Button variant="outline" onClick={() => setIsFileOpen(true)}>
            <FileUp className="w-4 h-4 mr-2" /> Add File
          </Button>
          <Button variant="outline" onClick={() => setIsAssignmentLinkOpen(true)}>
            <GraduationCap className="w-4 h-4 mr-2" /> Add Assignment
          </Button>
          <Button variant="outline" onClick={() => setIsLabOpen(true)}>
            <LinkIcon className="w-4 h-4 mr-2" /> Add Virtual Lab
          </Button>
        </CardContent>
      </Card>

      {/* Content List */}
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            <AlertCircle className="w-4 h-4" />
            <p>{error}</p>
          </div>
        )}
        {content.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">
            No content has been added to this module yet.
          </p>
        ) : (
          content.map(item => renderContentItem(item))
        )}
      </div>

      {/* Dialog for Adding/Editing Text */}
      <Dialog open={isTextOpen} onOpenChange={setIsTextOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Text Block</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="text-content">Content</Label>
            <Textarea
              id="text-content"
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              rows={10}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeTextDialog}>Cancel</Button>
            <Button onClick={() => saveContent('text', { text: currentText }, closeTextDialog)}>
              <Save className="w-4 h-4 mr-2" /> Save Text
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Dialog for Adding/Editing Virtual Lab */}
      <Dialog open={isLabOpen} onOpenChange={setIsLabOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Virtual Lab</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="lab-name">Lab Name</Label>
            <Input
              id="lab-name"
              value={currentLabName}
              onChange={(e) => setCurrentLabName(e.target.value)}
              placeholder="e.g., Praktikum ML Iris"
            />
            <p className="text-xs text-muted-foreground">
              The lab URL is assigned automatically based on student schedules.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeLabDialog}>Cancel</Button>
            <Button onClick={() => saveContent('virtual_lab', { lab_name: currentLabName }, closeLabDialog)}>
              <Save className="w-4 h-4 mr-2" /> Save Lab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Linking Assignment */}
      <Dialog open={isAssignmentLinkOpen} onOpenChange={setIsAssignmentLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Assignment</DialogTitle>
            <DialogDescription>
              Select an existing assignment to link to this module.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label htmlFor="assignment-select">Assignment</Label>
            <select
              id="assignment-select"
              value={selectedAssignmentId}
              onChange={(e) => setSelectedAssignmentId(e.target.value)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            >
              <option value="" disabled>Select an assignment...</option>
              {allAssignments.map(a => (
                <option key={a.id} value={a.id.toString()}>{a.title}</option>
              ))}
            </select>
            <div className="pt-2 text-center">
                  <Button 
                    variant="link" 
                    onClick={() => {
                      setIsAssignmentLinkOpen(false); // Close this dialog
                      setIsAssignmentCreateOpen(true); // Open the create dialog
                    }}
                  >
                    ...or create a new assignment
                  </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignmentLinkDialog}>Cancel</Button>
            <Button 
              disabled={!selectedAssignmentId}
              onClick={() => saveContent('assignment', { assignment_id: parseInt(selectedAssignmentId) }, closeAssignmentLinkDialog)}
            >
              <Save className="w-4 h-4 mr-2" /> Link Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Creating Assignment */}
      <AssignmentEditorDialog
        open={isAssignmentCreateOpen}
        onOpenChange={setIsAssignmentCreateOpen}
        courseId={courseId}
        getAuthHeader={getAuthHeader}
        assignmentToEdit={editingAssignment} // <-- Pass the assignment to edit
        onClose={() => { // <-- Add onClose handler
          setIsAssignmentCreateOpen(false);
          setEditingAssignment(null);
        }}
        onSave={(savedAssignment) => {
          if (editingAssignment) {
            // It was an EDIT
            setAllAssignments(prev => 
              prev.map(a => a.id === savedAssignment.id ? savedAssignment : a)
            );
            setEditingAssignment(null);
          } else {
            // It was CREATE
            setAllAssignments(prev => [...prev, savedAssignment]);
            setSelectedAssignmentId(savedAssignment.id.toString());
            setIsAssignmentLinkOpen(true); // Go back to link dialog
          }
          setIsAssignmentCreateOpen(false);
        }}
      />
      
      {/* Dialog for Adding File */}
      <Dialog open={isFileOpen} onOpenChange={closeFileDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add File</DialogTitle>
            <DialogDescription>
              Upload a PDF, document, or other file for students to view.
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
              <Label htmlFor="file-upload">File</Label>
              <Input
                id="file-upload"
                type="file"
                onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
              />
            </div>
            {selectedFile && (
              <p className="text-sm text-muted-foreground">
                Selected: {selectedFile.name}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeFileDialog}>Cancel</Button>
            <Button onClick={handleFileUpload} disabled={!selectedFile || isUploading}>
              {isUploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Upload & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}