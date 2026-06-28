import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';
import { 
  TrendingUp, 
  Brain, 
  Activity, 
  Clock,
  AlertTriangle,
  CheckCircle,
  Zap,
  Target
} from 'lucide-react';

interface PredictionData {
  time: string;
  predicted_load: number;
  confidence: number;
  actual_load?: number;
  course_activity: string;
}

interface ResourcePrediction {
  timestamp: string;
  cpu_prediction: number;
  memory_prediction: number;
  pods_needed: number;
  confidence_score: number;
}

export function PredictiveAnalytics() {
  const [activeTab, setActiveTab] = useState('overview');
  const [realTimeData, setRealTimeData] = useState<ResourcePrediction[]>([]);

  // Mock prediction data
  const predictionData: PredictionData[] = [
    { time: '08:00', predicted_load: 15, confidence: 0.85, actual_load: 12, course_activity: 'ET2108 Lab Start' },
    { time: '09:00', predicted_load: 45, confidence: 0.92, actual_load: 48, course_activity: 'Peak Activity' },
    { time: '10:00', predicted_load: 65, confidence: 0.88, actual_load: 62, course_activity: 'Multiple Courses' },
    { time: '11:00', predicted_load: 80, confidence: 0.90, actual_load: 75, course_activity: 'System Peak' },
    { time: '12:00', predicted_load: 40, confidence: 0.75, actual_load: 45, course_activity: 'Lunch Break' },
    { time: '13:00', predicted_load: 70, confidence: 0.89, actual_load: null, course_activity: 'ET2209 Lab Start' },
    { time: '14:00', predicted_load: 85, confidence: 0.91, actual_load: null, course_activity: 'Predicted Peak' },
    { time: '15:00', predicted_load: 60, confidence: 0.87, actual_load: null, course_activity: 'Decline Phase' },
    { time: '16:00', predicted_load: 30, confidence: 0.80, actual_load: null, course_activity: 'End Activities' },
  ];

  const resourcePredictions: ResourcePrediction[] = [
    { timestamp: '13:00', cpu_prediction: 75, memory_prediction: 68, pods_needed: 8, confidence_score: 0.89 },
    { timestamp: '14:00', cpu_prediction: 85, memory_prediction: 78, pods_needed: 12, confidence_score: 0.91 },
    { timestamp: '15:00', cpu_prediction: 65, memory_prediction: 70, pods_needed: 9, confidence_score: 0.87 },
    { timestamp: '16:00', cpu_prediction: 35, memory_prediction: 45, pods_needed: 5, confidence_score: 0.82 },
  ];

  // Simulate real-time data updates
  useEffect(() => {
    const interval = setInterval(() => {
      const newData: ResourcePrediction = {
        timestamp: new Date().toLocaleTimeString(),
        cpu_prediction: Math.random() * 100,
        memory_prediction: Math.random() * 100,
        pods_needed: Math.ceil(Math.random() * 15),
        confidence_score: 0.7 + Math.random() * 0.3
      };
      
      setRealTimeData(prev => [...prev.slice(-10), newData]);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const upcomingEvents = [
    {
      time: '13:30',
      course: 'ET2108 - Signal Processing Lab',
      predicted_users: 32,
      resource_impact: 'High',
      status: 'scaling_ready'
    },
    {
      time: '14:00',
      course: 'ET2209 - Communication Systems',
      predicted_users: 28,
      resource_impact: 'Medium',
      status: 'monitoring'
    },
    {
      time: '15:30',
      course: 'ET3108 - Advanced Systems',
      predicted_users: 24,
      resource_impact: 'Medium',
      status: 'pending'
    }
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scaling_ready':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'monitoring':
        return <Activity className="w-4 h-4 text-blue-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-orange-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2 flex items-center gap-2">
            <Brain className="h-7 w-7 text-primary" />
            Predictive Analytics
          </h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            AI-powered resource forecasting and intelligent autoscaling
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="gap-1">
            <Zap className="w-3 h-3" />
            Live Predictions
          </Badge>
          <Badge variant="secondary">
            Model: FB Prophet v1.2
          </Badge>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Next Hour Load</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">85%</div>
            <p className="text-xs text-muted-foreground">
              91% confidence
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Pods Needed</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">12</div>
            <p className="text-xs text-muted-foreground">
              +5 from current
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Active Predictions</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">24</div>
            <p className="text-xs text-muted-foreground">
              Next 6 hours
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Accuracy Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">89.2%</div>
            <p className="text-xs text-muted-foreground">
              Last 7 days
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Analytics */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="forecasting">Forecasting</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Load Prediction vs Reality</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Real-time comparison of predicted vs actual resource usage
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={predictionData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="time" />
                      <YAxis />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px'
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="predicted_load" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        name="Predicted"
                        strokeDasharray="5 5"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="actual_load" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        name="Actual"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Confidence Levels</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Model confidence in predictions
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={predictionData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="time" />
                      <YAxis />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px'
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="confidence" 
                        stroke="#f59e0b" 
                        fill="#f59e0b" 
                        fillOpacity={0.3}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Forecasting Tab */}
        <TabsContent value="forecasting" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Resource Forecasting - Next 4 Hours</CardTitle>
              <p className="text-sm text-muted-foreground">
                Predicted resource requirements based on historical patterns
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={resourcePredictions}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="timestamp" />
                    <YAxis />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Bar dataKey="cpu_prediction" fill="#3b82f6" name="CPU %" />
                    <Bar dataKey="memory_prediction" fill="#10b981" name="Memory %" />
                    <Bar dataKey="pods_needed" fill="#f59e0b" name="Pods Needed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Patterns Tab */}
        <TabsContent value="patterns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Performance Patterns</CardTitle>
              <p className="text-sm text-muted-foreground">
                Advanced pattern analysis and performance insights
              </p>
            </CardHeader>
            <CardContent>
              <div className="text-center p-8">
                <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Advanced analytics and pattern recognition coming soon
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Upcoming Events Tab */}
        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Course Activities</CardTitle>
              <p className="text-sm text-muted-foreground">
                Predicted events and automated scaling decisions
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {upcomingEvents.map((event, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(event.status)}
                      <div>
                        <h4 className="font-medium">{event.course}</h4>
                        <p className="text-sm text-muted-foreground">
                          {event.time} • {event.predicted_users} students expected
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={event.resource_impact === 'High' ? 'destructive' : 
                                   event.resource_impact === 'Medium' ? 'default' : 'secondary'}>
                        {event.resource_impact} Impact
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {event.status === 'scaling_ready' ? 'Auto-scaling ready' :
                         event.status === 'monitoring' ? 'Monitoring active' : 'Pending analysis'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}