import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";

const app = new Hono();

// Initialize Supabase with service role key for admin operations
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-a2395876/health", (c) => {
  return c.json({ status: "ok" });
});

// ==================== AUTH ENDPOINTS ====================

// Initialize demo users endpoint
app.post("/make-server-a2395876/auth/init-demo", async (c) => {
  try {
    // Create demo admin user
    const adminResult = await supabase.auth.admin.createUser({
      email: 'admin@itb.ac.id',
      password: 'admin123',
      user_metadata: {
        name: 'Administrator',
        role: 'admin'
      },
      email_confirm: true
    });

    if (adminResult.data?.user) {
      // Create profile for admin
      await supabase.from('users').insert({
        id: adminResult.data.user.id,
        email: 'admin@itb.ac.id',
        full_name: 'Administrator',
        role: 'admin'
      });
    }

    // Create demo student user
    const studentResult = await supabase.auth.admin.createUser({
      email: 'student@itb.ac.id',
      password: 'student123',
      user_metadata: {
        name: 'John Doe',
        role: 'student',
        nim: '1301210001'
      },
      email_confirm: true
    });

    if (studentResult.data?.user) {
      // Create profile for student
      await supabase.from('users').insert({
        id: studentResult.data.user.id,
        email: 'student@itb.ac.id',
        full_name: 'John Doe',
        role: 'student',
        nim: '1301210001'
      });
    }

    return c.json({ 
      message: "Demo users initialized",
      admin: adminResult.data?.user ? 'created' : 'exists',
      student: studentResult.data?.user ? 'created' : 'exists'
    });
  } catch (error) {
    console.log('Init demo users error:', error);
    return c.json({ error: "Failed to initialize demo users" }, 500);
  }
});

// User signup endpoint
app.post("/make-server-a2395876/auth/signup", async (c) => {
  try {
    const body = await c.req.json();
    console.log('Signup request body:', body);
    
    const { email, password, userData } = body;
    
    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    // Extract user data
    const full_name = userData?.full_name || userData?.name || ''; // Check full_name first
    const role = userData?.role || 'student';
    const nim = userData?.nim || null;

    // Create user with admin createUser method to auto-confirm email
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: userData,
      email_confirm: true
    });

    if (error) {
      console.log('Signup auth error:', error);
      return c.json({ error: error.message }, 400);
    }

    // Create profile in users table
    if (data.user) {
      const { error: profileError } = await supabase.from('users').insert({
        id: data.user.id,
        email,
        full_name,
        role,
        nim
      });

      if (profileError) {
        console.log('Profile creation error:', profileError);
        // If unique constraint violation, user might already exist
        if (profileError.code === '23505') {
          return c.json({ error: "User already exists" }, 400);
        }
        return c.json({ error: `Profile creation failed: ${profileError.message}` }, 500);
      }
    }

    return c.json({ 
      message: "User created successfully",
      user: data.user 
    });
  } catch (error) {
    console.log('Signup server error:', error);
    return c.json({ error: `Internal server error: ${error.message || 'Unknown error'}` }, 500);
  }
});

// ==================== STUDENTS ENDPOINTS ====================

// Get all students (admin only)
app.get("/make-server-a2395876/students", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    // Check if user is admin
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { data: students, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'student')
      .order('created_at', { ascending: false });

    if (error) {
      console.log('Get students error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ students });
  } catch (error) {
    console.log('Get students server error:', error);
    return c.json({ error: "Failed to get students" }, 500);
  }
});

// Add new student (admin only)
app.post("/make-server-a2395876/students", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { email, password, full_name, nim } = await c.req.json();

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name: full_name, role: 'student', nim },
      email_confirm: true
    });

    if (authError) {
      console.log('Create student auth error:', authError);
      return c.json({ error: authError.message }, 400);
    }

    // Create profile
    const { data: student, error: profileError } = await supabase
      .from('users')
      .insert({
        id: authData.user!.id,
        email,
        full_name,
        role: 'student',
        nim
      })
      .select()
      .single();

    if (profileError) {
      console.log('Create student profile error:', profileError);
      return c.json({ error: profileError.message }, 500);
    }

    return c.json({ 
      message: "Student created successfully",
      student 
    });
  } catch (error) {
    console.log('Create student server error:', error);
    return c.json({ error: "Failed to create student" }, 500);
  }
});

// Update student
app.put("/make-server-a2395876/students/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const studentId = c.req.param('id');
    const updates = await c.req.json();

    const { data: student, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', studentId)
      .select()
      .single();

    if (error) {
      console.log('Update student error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Student updated successfully",
      student 
    });
  } catch (error) {
    console.log('Update student server error:', error);
    return c.json({ error: "Failed to update student" }, 500);
  }
});

// Delete student
app.delete("/make-server-a2395876/students/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const studentId = c.req.param('id');

    // Delete from users table (cascade will handle enrollments, submissions, etc.)
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', studentId);

    if (deleteError) {
      console.log('Delete student error:', deleteError);
      return c.json({ error: deleteError.message }, 500);
    }

    // Delete from auth
    const { error: authError } = await supabase.auth.admin.deleteUser(studentId);
    if (authError) {
      console.log('Delete student auth error:', authError);
    }

    return c.json({ message: "Student deleted successfully" });
  } catch (error) {
    console.log('Delete student server error:', error);
    return c.json({ error: "Failed to delete student" }, 500);
  }
});

// ==================== PERIODS ENDPOINTS ====================

// Get all periods
app.get("/make-server-a2395876/periods", async (c) => {
  try {
    const { data: periods, error } = await supabase
      .from('periods')
      .select('*')
      .order('year', { ascending: false })
      .order('semester', { ascending: false });

    if (error) {
      console.log('Get periods error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ periods });
  } catch (error) {
    console.log('Get periods server error:', error);
    return c.json({ error: "Failed to get periods" }, 500);
  }
});

// Create new period
app.post("/make-server-a2395876/periods", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const periodData = await c.req.json();

    const { data: period, error } = await supabase
      .from('periods')
      .insert(periodData)
      .select()
      .single();

    if (error) {
      console.log('Create period error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Period created successfully",
      period 
    });
  } catch (error) {
    console.log('Create period server error:', error);
    return c.json({ error: "Failed to create period" }, 500);
  }
});

// Update period (including activation toggle)
app.put("/make-server-a2395876/periods/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const periodId = c.req.param('id');
    const updates = await c.req.json();

    // If activating this period, deactivate all others
    if (updates.is_active === true) {
      await supabase
        .from('periods')
        .update({ is_active: false })
        .neq('id', periodId);
    }

    const { data: period, error } = await supabase
      .from('periods')
      .update(updates)
      .eq('id', periodId)
      .select()
      .single();

    if (error) {
      console.log('Update period error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Period updated successfully",
      period 
    });
  } catch (error) {
    console.log('Update period server error:', error);
    return c.json({ error: "Failed to update period" }, 500);
  }
});

// Delete period
app.delete("/make-server-a2395876/periods/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const periodId = c.req.param('id');

    const { error } = await supabase
      .from('periods')
      .delete()
      .eq('id', periodId);

    if (error) {
      console.log('Delete period error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: "Period deleted successfully" });
  } catch (error) {
    console.log('Delete period server error:', error);
    return c.json({ error: "Failed to delete period" }, 500);
  }
});

// ==================== COURSES ENDPOINTS ====================

// Get all courses
app.get("/make-server-a2395876/courses", async (c) => {
  try {
    const periodId = c.req.query('period_id');
    
    let query = supabase
      .from('courses')
      .select('*')
      .order('course_code');

    if (periodId) {
      // Get courses via course_offerings
      const { data: offerings, error: offeringsError } = await supabase
        .from('course_offerings')
        .select('course_id')
        .eq('period_id', periodId);

      if (offeringsError) {
        console.log('Get course offerings error:', offeringsError);
        return c.json({ error: offeringsError.message }, 500);
      }

      const courseIds = offerings.map(o => o.course_id);
      query = query.in('id', courseIds);
    }

    const { data: courses, error } = await query;

    if (error) {
      console.log('Get courses error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ courses });
  } catch (error) {
    console.log('Get courses server error:', error);
    return c.json({ error: "Failed to get courses" }, 500);
  }
});

// Get course with full details (modules, assignments, students)
app.get("/make-server-a2395876/courses/:id", async (c) => {
  try {
    const courseId = c.req.param('id');

    // Get course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .single();

    if (courseError) {
      console.log('Get course error:', courseError);
      return c.json({ error: courseError.message }, 500);
    }

    // Get modules with content
    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select(`
        *,
        module_content (
          *,
          assignments (*)
        )
      `)
      .eq('course_id', courseId)
      .order('id');

    if (modulesError) {
      console.log('Get modules error:', modulesError);
    }

    // Get enrolled students
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('course_offerings')
      .select(`
        id,
        enrollments (
          student_id,
          users (*)
        )
      `)
      .eq('course_id', courseId);

    if (enrollmentsError) {
      console.log('Get enrollments error:', enrollmentsError);
    }

    const students = enrollments?.flatMap(offering => 
      offering.enrollments.map((e: any) => e.users)
    ) || [];

    return c.json({ 
      course: {
        ...course,
        modules: modules || [],
        students: students
      }
    });
  } catch (error) {
    console.log('Get course details server error:', error);
    return c.json({ error: "Failed to get course details" }, 500);
  }
});

// Create new course
app.post("/make-server-a2395876/courses", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { course_code, course_name, description, period_id } = await c.req.json();

    // Create course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .insert({ course_code, course_name, description })
      .select()
      .single();

    if (courseError) {
      console.log('Create course error:', courseError);
      return c.json({ error: courseError.message }, 500);
    }

    // Create course offering for the period
    if (period_id) {
      const { error: offeringError } = await supabase
        .from('course_offerings')
        .insert({ course_id: course.id, period_id });

      if (offeringError) {
        console.log('Create course offering error:', offeringError);
      }
    }

    return c.json({ 
      message: "Course created successfully",
      course 
    });
  } catch (error) {
    console.log('Create course server error:', error);
    return c.json({ error: "Failed to create course" }, 500);
  }
});

// Update course
app.put("/make-server-a2395876/courses/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const courseId = c.req.param('id');
    const updates = await c.req.json();

    const { data: course, error } = await supabase
      .from('courses')
      .update(updates)
      .eq('id', courseId)
      .select()
      .single();

    if (error) {
      console.log('Update course error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Course updated successfully",
      course 
    });
  } catch (error) {
    console.log('Update course server error:', error);
    return c.json({ error: "Failed to update course" }, 500);
  }
});

// Delete course
app.delete("/make-server-a2395876/courses/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const courseId = c.req.param('id');

    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', courseId);

    if (error) {
      console.log('Delete course error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: "Course deleted successfully" });
  } catch (error) {
    console.log('Delete course server error:', error);
    return c.json({ error: "Failed to delete course" }, 500);
  }
});

// ==================== MODULES ENDPOINTS ====================

// Create module
app.post("/make-server-a2395876/modules", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const moduleData = await c.req.json();

    const { data: module, error } = await supabase
      .from('modules')
      .insert(moduleData)
      .select()
      .single();

    if (error) {
      console.log('Create module error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Module created successfully",
      module 
    });
  } catch (error) {
    console.log('Create module server error:', error);
    return c.json({ error: "Failed to create module" }, 500);
  }
});

// Update module
app.put("/make-server-a2395876/modules/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const moduleId = c.req.param('id');
    const updates = await c.req.json();

    const { data: module, error } = await supabase
      .from('modules')
      .update(updates)
      .eq('id', moduleId)
      .select()
      .single();

    if (error) {
      console.log('Update module error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Module updated successfully",
      module 
    });
  } catch (error) {
    console.log('Update module server error:', error);
    return c.json({ error: "Failed to update module" }, 500);
  }
});

// Delete module
app.delete("/make-server-a2395876/modules/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const moduleId = c.req.param('id');

    const { error } = await supabase
      .from('modules')
      .delete()
      .eq('id', moduleId);

    if (error) {
      console.log('Delete module error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: "Module deleted successfully" });
  } catch (error) {
    console.log('Delete module server error:', error);
    return c.json({ error: "Failed to delete module" }, 500);
  }
});

// Add content to module (text, file, assignment)
app.post("/make-server-a2395876/modules/:moduleId/content", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const moduleId = c.req.param('moduleId');
    const { content_type, title, content, file_url, order_index } = await c.req.json();

    const { data: moduleContent, error } = await supabase
      .from('module_content')
      .insert({
        module_id: moduleId,
        content_type,
        title,
        content,
        file_url,
        order_index
      })
      .select()
      .single();

    if (error) {
      console.log('Add module content error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Content added successfully",
      content: moduleContent 
    });
  } catch (error) {
    console.log('Add module content server error:', error);
    return c.json({ error: "Failed to add content" }, 500);
  }
});

// Delete module content
app.delete("/make-server-a2395876/module-content/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const contentId = c.req.param('id');

    const { error } = await supabase
      .from('module_content')
      .delete()
      .eq('id', contentId);

    if (error) {
      console.log('Delete module content error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: "Content deleted successfully" });
  } catch (error) {
    console.log('Delete module content server error:', error);
    return c.json({ error: "Failed to delete content" }, 500);
  }
});

// ==================== ASSIGNMENTS ENDPOINTS ====================

// Create assignment
app.post("/make-server-a2395876/assignments", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const assignmentData = await c.req.json();

    const { data: assignment, error } = await supabase
      .from('assignments')
      .insert(assignmentData)
      .select()
      .single();

    if (error) {
      console.log('Create assignment error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Assignment created successfully",
      assignment 
    });
  } catch (error) {
    console.log('Create assignment server error:', error);
    return c.json({ error: "Failed to create assignment" }, 500);
  }
});

// Get assignments for a student
app.get("/make-server-a2395876/assignments/student", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get student's enrolled courses
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('enrollments')
      .select('offering_id')
      .eq('student_id', user.id);

    if (enrollmentsError) {
      console.log('Get enrollments error:', enrollmentsError);
      return c.json({ error: enrollmentsError.message }, 500);
    }

    const offeringIds = enrollments.map(e => e.offering_id);

    // Get courses from offerings
    const { data: offerings, error: offeringsError } = await supabase
      .from('course_offerings')
      .select('course_id')
      .in('id', offeringIds);

    if (offeringsError) {
      console.log('Get offerings error:', offeringsError);
      return c.json({ error: offeringsError.message }, 500);
    }

    const courseIds = offerings.map(o => o.course_id);

    // Get assignments for these courses with submission status
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select(`
        *,
        submissions!left (
          id,
          grade,
          submitted_at
        )
      `)
      .in('course_id', courseIds)
      .eq('submissions.student_id', user.id);

    if (assignmentsError) {
      console.log('Get assignments error:', assignmentsError);
      return c.json({ error: assignmentsError.message }, 500);
    }

    return c.json({ assignments });
  } catch (error) {
    console.log('Get student assignments server error:', error);
    return c.json({ error: "Failed to get assignments" }, 500);
  }
});

// Submit assignment
app.post("/make-server-a2395876/submissions", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { assignment_id, content, file_url } = await c.req.json();

    const { data: submission, error } = await supabase
      .from('submissions')
      .upsert({
        assignment_id,
        student_id: user.id,
        content,
        file_url,
        submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.log('Submit assignment error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Assignment submitted successfully",
      submission 
    });
  } catch (error) {
    console.log('Submit assignment server error:', error);
    return c.json({ error: "Failed to submit assignment" }, 500);
  }
});

// Grade assignment submission
app.put("/make-server-a2395876/submissions/:id/grade", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const submissionId = c.req.param('id');
    const { grade, feedback } = await c.req.json();

    const { data: submission, error } = await supabase
      .from('submissions')
      .update({ grade, feedback })
      .eq('id', submissionId)
      .select()
      .single();

    if (error) {
      console.log('Grade submission error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Submission graded successfully",
      submission 
    });
  } catch (error) {
    console.log('Grade submission server error:', error);
    return c.json({ error: "Failed to grade submission" }, 500);
  }
});

// ==================== ENROLLMENTS ENDPOINTS ====================

// Enroll student to course
app.post("/make-server-a2395876/enrollments", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { student_id, course_id, period_id } = await c.req.json();

    // Get or create course offering
    let { data: offering, error: offeringError } = await supabase
      .from('course_offerings')
      .select('id')
      .eq('course_id', course_id)
      .eq('period_id', period_id)
      .single();

    if (offeringError || !offering) {
      // Create offering if it doesn't exist
      const { data: newOffering, error: createError } = await supabase
        .from('course_offerings')
        .insert({ course_id, period_id })
        .select()
        .single();

      if (createError) {
        console.log('Create offering error:', createError);
        return c.json({ error: createError.message }, 500);
      }

      offering = newOffering;
    }

    // Create enrollment
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .insert({
        offering_id: offering.id,
        student_id
      })
      .select()
      .single();

    if (enrollmentError) {
      console.log('Create enrollment error:', enrollmentError);
      return c.json({ error: enrollmentError.message }, 500);
    }

    return c.json({ 
      message: "Student enrolled successfully",
      enrollment 
    });
  } catch (error) {
    console.log('Enroll student server error:', error);
    return c.json({ error: "Failed to enroll student" }, 500);
  }
});

// Remove enrollment
app.delete("/make-server-a2395876/enrollments/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const enrollmentId = c.req.param('id');

    const { error } = await supabase
      .from('enrollments')
      .delete()
      .eq('id', enrollmentId);

    if (error) {
      console.log('Delete enrollment error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: "Enrollment removed successfully" });
  } catch (error) {
    console.log('Delete enrollment server error:', error);
    return c.json({ error: "Failed to remove enrollment" }, 500);
  }
});

// ==================== PRACTICUM SESSIONS ENDPOINTS ====================

// Create practicum session
app.post("/make-server-a2395876/practicum-sessions", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionData = await c.req.json();

    const { data: session, error } = await supabase
      .from('practicum_schedules')
      .insert(sessionData)
      .select()
      .single();

    if (error) {
      console.log('Create session error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Practicum session created successfully",
      session 
    });
  } catch (error) {
    console.log('Create session server error:', error);
    return c.json({ error: "Failed to create session" }, 500);
  }
});

// Check if student can access virtual lab
app.get("/make-server-a2395876/practicum-sessions/check-access/:sessionId", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionId = c.req.param('sessionId');
    const currentTime = new Date();

    // Get session details
    const { data: session, error: sessionError } = await supabase
      .from('practicum_schedules')
      .select('*, schedule_attendees!inner(*)')
      .eq('id', sessionId)
      .eq('schedule_attendees.student_id', user.id)
      .single();

    if (sessionError || !session) {
      return c.json({ 
        hasAccess: false,
        message: "You are not enrolled in this session"
      });
    }

    // Check if current time is within session time
    const startTime = new Date(session.start_time);
    const endTime = new Date(session.end_time);

    if (currentTime < startTime) {
      return c.json({ 
        hasAccess: false,
        message: `Session starts at ${startTime.toLocaleString()}`
      });
    }

    if (currentTime > endTime) {
      return c.json({ 
        hasAccess: false,
        message: "Session has ended"
      });
    }

    return c.json({ 
      hasAccess: true,
      jupyter_link: session.jupyter_link,
      session
    });
  } catch (error) {
    console.log('Check access server error:', error);
    return c.json({ error: "Failed to check access" }, 500);
  }
});

// ==================== CURRICULUM FLOWCHART ENDPOINTS ====================

// Get flowchart positions
app.get("/make-server-a2395876/curriculum-flowchart", async (c) => {
  try {
    const { data: positions, error } = await supabase
      .from('curriculum_flowchart')
      .select('*')
      .order('semester');

    if (error) {
      console.log('Get flowchart error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ positions });
  } catch (error) {
    console.log('Get flowchart server error:', error);
    return c.json({ error: "Failed to get flowchart" }, 500);
  }
});

// Update flowchart position
app.put("/make-server-a2395876/curriculum-flowchart/:courseCode", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user?.id)
      .single();

    if (!userProfile || userProfile.role !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const courseCode = c.req.param('courseCode');
    const { position_x, position_y } = await c.req.json();

    const { data: position, error } = await supabase
      .from('curriculum_flowchart')
      .upsert({
        course_code: courseCode,
        position_x,
        position_y,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.log('Update flowchart position error:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ 
      message: "Position updated successfully",
      position 
    });
  } catch (error) {
    console.log('Update flowchart server error:', error);
    return c.json({ error: "Failed to update position" }, 500);
  }
});

Deno.serve(app.fetch);
