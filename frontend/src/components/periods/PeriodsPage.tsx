import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch'; // Assuming you have this shadcn component
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import {
  Plus,
  Search,
  Calendar,
  BookOpen,
  Edit, // Keep Edit if you plan an edit feature later
  Trash2
} from 'lucide-react';
// Remove direct Supabase info import if not needed elsewhere in this component
// import { projectId, publicAnonKey } from '../../utils/supabase/info';
import { useAuth } from '../auth/AuthProvider'; // Import useAuth to get the token
import { logger } from '../utils/logger'; // Import logger

// Define the API base URL for your backend service
const API_BASE_URL = '/api'

interface Period {
  id: number;
  year: number;
  semester: string; // Should match backend ('Ganjil', 'Genap')
  is_active: boolean;
}

interface PeriodsPageProps {
  isStudent?: boolean;
}

export function PeriodsPage({ isStudent = false }: PeriodsPageProps) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // State for error messages
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newPeriod, setNewPeriod] = useState({
    year: new Date().getFullYear(),
    semester: 'Ganjil' // Default value
  });

  const { user } = useAuth(); // Get user session info for token

  // Helper function to get the auth token
  const getAuthHeader = () => {
    // Supabase stores the token in localStorage with a specific key pattern
    // Find the correct key (it might vary slightly based on library version)
    const sessionKey = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    const sessionData = sessionKey ? JSON.parse(localStorage.getItem(sessionKey) || '{}') : {};
    const token = sessionData?.access_token;
    // console.log("Retrieved Token:", token); // For debugging
    if (!token) {
      logger.warn('Auth token not found in localStorage.');
      // Handle missing token case, maybe redirect to login?
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  // --- API Interaction Functions ---

  const fetchPeriods = async () => {
    logger.info('Fetching periods...');
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/periods`, {
        headers: getAuthHeader() // Include auth header
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setPeriods(data.periods || []);
      logger.info(`Fetched ${data.periods?.length || 0} periods.`);

    } catch (err: any) {
      logger.error('Error fetching periods:', err);
      setError(err.message || 'Failed to fetch periods. Please try again.');
      setPeriods([]); // Clear periods on error
    } finally {
      setLoading(false);
    }
  };

  const handleAddPeriod = async () => {
    logger.info('Attempting to add period:', newPeriod);
    setError(null);

    // Basic Validation
    if (!newPeriod.year || !newPeriod.semester || newPeriod.year < 1900 || newPeriod.year > 2100) {
      setError('Please enter a valid year and select a semester.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/periods`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify(newPeriod)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      logger.info('Period added successfully:', data.period);
      setIsAddDialogOpen(false);
      setNewPeriod({ year: new Date().getFullYear(), semester: 'Ganjil' }); // Reset form
      await fetchPeriods(); // Refresh the list
      // Optionally show a success message to the user here

    } catch (err: any) {
      logger.error('Error adding period:', err);
      setError(err.message || 'Failed to add period. Please try again.');
    }
  };

  const handleToggleActivation = async (periodId: number, currentStatus: boolean) => {
    logger.info(`Toggling activation for period ${periodId} to ${!currentStatus}`);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/periods/${periodId}`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify({ is_active: !currentStatus }) // Send the *new* desired state
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      logger.info(`Period ${periodId} activation toggled successfully:`, data.period);
      await fetchPeriods(); // Refresh the list to show updated statuses

    } catch (err: any) {
      logger.error(`Error toggling activation for period ${periodId}:`, err);
      setError(err.message || 'Failed to update period status. Please try again.');
      // Optionally revert UI state if needed, or rely on next fetch
    }
  };

  const handleDeletePeriod = async (periodId: number) => {
    // Confirmation dialog
    if (!window.confirm('Are you sure you want to delete this period? This action cannot be undone.')) {
      return;
    }

    logger.info(`Attempting to delete period ${periodId}`);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/periods/${periodId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });

      const data = await response.json(); // Attempt to parse JSON even on error

      if (!response.ok) {
        // Check for specific conflict error (409)
        if (response.status === 409) {
             throw new Error(data.error || 'Cannot delete period. It might be linked to other records (e.g., course offerings).');
        }
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      logger.info(`Period ${periodId} deleted successfully.`);
      // Optionally show a success message
      await fetchPeriods(); // Refresh the list

    } catch (err: any) {
      logger.error(`Error deleting period ${periodId}:`, err);
      setError(err.message || 'Failed to delete period. Please try again.');
    }
  };

  // --- End API Interaction Functions ---

  // Fetch periods on component mount
  useEffect(() => {
    fetchPeriods();
  }, []); // Empty dependency array means this runs once on mount

  // Filter periods based on search query
  const filteredPeriods = periods.filter(period => {
    const periodName = `${period.year} - ${period.semester}`;
    return periodName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Helper to get badge variant
  const getStatusBadgeVariant = (isActive: boolean): "default" | "secondary" => {
    return isActive ? 'default' : 'secondary';
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2">
            {isStudent ? 'Academic Periods' : 'Period Management'}
          </h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            {isStudent
              ? 'View academic periods'
              : 'Manage academic periods and activate semesters'}
          </p>
        </div>
        {!isStudent && (
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                New Period
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Academic Period</DialogTitle>
                <DialogDescription>
                  Create a new semester period (e.g., 2025 - Ganjil). New periods start as inactive.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="year">Year</Label>
                  <Input
                    id="year"
                    type="number"
                    min="1900"
                    max="2100"
                    value={newPeriod.year}
                    onChange={(e) => setNewPeriod({ ...newPeriod, year: parseInt(e.target.value) || new Date().getFullYear() })}
                    placeholder="e.g., 2025"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="semester">Semester</Label>
                  {/* Using standard select for simplicity */}
                  <select
                    id="semester"
                    value={newPeriod.semester}
                    onChange={(e) => setNewPeriod({ ...newPeriod, semester: e.target.value })}
                    className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50" // Basic styling mimicking shadcn Select
                  >
                    <option value="Ganjil">Ganjil (Odd)</option>
                    <option value="Genap">Genap (Even)</option>
                  </select>
                </div>
                 {/* Display Error in Dialog */}
                 {error && (
                    <p className="text-sm text-destructive">{error}</p>
                 )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); setError(null); }}>
                  Cancel
                </Button>
                <Button onClick={handleAddPeriod}>
                  <Plus className="w-4 h-4 mr-2" /> Add Period
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

       {/* Display General Error Messages */}
       {!isAddDialogOpen && error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setError(null)}>
              <svg className="fill-current h-6 w-6 text-destructive" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.149 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
            </span>
          </div>
        )}


      {/* Search */}
      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search periods (e.g., 2025 - Ganjil)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              disabled={loading} // Disable search while loading
            />
          </div>
        </CardHeader>
      </Card>

      {/* Periods List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Academic Periods</h2>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading periods...</div>
        ) : filteredPeriods.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              No periods found matching your search. {!isStudent && 'Click "New Period" to create one.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredPeriods.map((period) => (
              <Card key={period.id} className={`border transition-all hover:shadow-md ${
                period.is_active ? 'border-primary/50 bg-primary/5' : ''
              }`}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    {/* Period Info */}
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base truncate">
                          {period.year} - {period.semester}
                        </CardTitle>
                        <Badge variant={getStatusBadgeVariant(period.is_active)} className="flex-shrink-0">
                          {period.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="w-4 h-4" />
                        <span>{period.semester === 'Ganjil' ? 'Odd Semester' : 'Even Semester'}</span>
                      </div>
                    </div>

                    {/* Admin Controls */}
                    {!isStudent && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Switch
                          id={`switch-${period.id}`}
                          checked={period.is_active}
                          onCheckedChange={() => handleToggleActivation(period.id, period.is_active)}
                          aria-label={`Activate period ${period.year} - ${period.semester}`}
                        />
                         <Label htmlFor={`switch-${period.id}`} className="text-xs cursor-pointer">
                           {period.is_active ? 'Active' : 'Inactive'}
                         </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePeriod(period.id)}
                          aria-label={`Delete period ${period.year} - ${period.semester}`}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>

                {/* Optional Content - can add course count etc. later */}
                {/* <CardContent>
                  <p className="text-sm text-muted-foreground">Details placeholder...</p>
                </CardContent> */}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Info Card for Admins */}
      {!isStudent && (
        <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <h3 className="font-medium text-blue-900 dark:text-blue-200">Period Activation</h3>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Only one period can be active at a time. Activating a period sets the context for current courses and enrollments visible throughout the platform. Students primarily see content related to the active period.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}