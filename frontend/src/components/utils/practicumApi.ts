// API utilities for practicum management

import { projectId, publicAnonKey } from '../../utils/supabase/info';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-a2395876`;

// Helper function to make API calls with authentication
async function apiCall(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('supabase_access_token') || publicAnonKey;
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Course Management APIs
export const courseApi = {
  // Get all practicum courses for a semester
  getCourses: (semester: string = '2025-1') =>
    apiCall(`/practicum/courses?semester=${semester}`),

  // Create new practicum course
  createCourse: (courseData: any) =>
    apiCall('/practicum/courses', {
      method: 'POST',
      body: JSON.stringify(courseData),
    }),

  // Update practicum course
  updateCourse: (courseId: string, updates: any) =>
    apiCall(`/practicum/courses/${courseId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  // Update module resources
  updateModuleResources: (courseId: string, moduleId: string, resources: any) =>
    apiCall(`/practicum/courses/${courseId}/modules/${moduleId}/resources`, {
      method: 'PUT',
      body: JSON.stringify(resources),
    }),
};

// Enrollment Management APIs
export const enrollmentApi = {
  // Enroll student in practicum course
  enrollStudent: (studentId: string, courseId: string, scheduleIndex: number) =>
    apiCall('/practicum/enroll', {
      method: 'POST',
      body: JSON.stringify({ studentId, courseId, scheduleIndex }),
    }),

  // Get all enrollments (optionally filter by course)
  getEnrollments: (courseId?: string) => {
    const query = courseId ? `?courseId=${courseId}` : '';
    return apiCall(`/practicum/enrollments${query}`);
  },

  // Bulk enroll students
  bulkEnrollStudents: (studentIds: string[], courseId: string, scheduleIndex: number) =>
    apiCall('/bulk/enroll', {
      method: 'POST',
      body: JSON.stringify({ 
        student_ids: studentIds, 
        course_id: courseId,
        schedule_index: scheduleIndex 
      }),
    }),
};

// Resource Analytics APIs
export const resourceApi = {
  // Get resource usage analytics for a semester
  getResourceUsage: (semester: string = '2025-1') =>
    apiCall(`/practicum/resource-usage?semester=${semester}`),

  // Get dashboard analytics
  getDashboardAnalytics: () =>
    apiCall('/analytics/dashboard'),
};

// Student Management APIs
export const studentApi = {
  // Search students by name or NIM
  searchStudents: (query: string) =>
    apiCall(`/students?search=${encodeURIComponent(query)}`),

  // Get student progress
  getStudentProgress: (studentId: string) =>
    apiCall(`/students/${studentId}/progress`),
};

// Helper functions for UI
export const practicumHelpers = {
  // Calculate total resource allocation for a course
  calculateCourseResources: (course: any) => {
    const totalResources = { cpu: 0, memory: 0, storage: 0 };
    
    course.modules?.forEach((module: any) => {
      const studentMultiplier = course.enrolledStudents || 1;
      totalResources.cpu += (module.resources?.cpu || 0) * studentMultiplier;
      totalResources.memory += (module.resources?.memory || 0) * studentMultiplier;
      totalResources.storage += (module.resources?.storage || 0) * studentMultiplier;
    });
    
    return totalResources;
  },

  // Format resource usage for display
  formatResourceUsage: (value: number, unit: string) => {
    if (value < 1000) {
      return `${value.toFixed(1)} ${unit}`;
    } else if (value < 1000000) {
      return `${(value / 1000).toFixed(1)}K ${unit}`;
    } else {
      return `${(value / 1000000).toFixed(1)}M ${unit}`;
    }
  },

  // Calculate estimated costs
  calculateEstimatedCost: (resources: any, duration: number = 1) => {
    const costs = {
      cpu: (resources.cpu || 0) * 0.05 * duration,
      memory: (resources.memory || 0) * 0.01 * duration,
      storage: (resources.storage || 0) * 0.001 * duration,
    };
    
    const total = costs.cpu + costs.memory + costs.storage;
    
    return {
      ...costs,
      total,
      formatted: `$${total.toFixed(2)}`
    };
  },

  // Generate schedule display text
  formatSchedule: (schedule: any[]) => {
    return schedule.map(s => 
      `${s.day} • ${s.startTime}-${s.endTime} • ${s.room}`
    ).join('\n');
  },

  // Validate resource allocation
  validateResourceAllocation: (resources: any) => {
    const errors: string[] = [];
    
    if (!resources.cpu || resources.cpu <= 0) {
      errors.push('CPU cores must be greater than 0');
    }
    if (!resources.memory || resources.memory <= 0) {
      errors.push('Memory must be greater than 0 GB');
    }
    if (!resources.storage || resources.storage <= 0) {
      errors.push('Storage must be greater than 0 GB');
    }
    if (!resources.duration || resources.duration <= 0) {
      errors.push('Duration must be greater than 0 hours');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
};