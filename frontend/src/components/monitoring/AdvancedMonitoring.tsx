import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Alert, AlertDescription } from '../ui/alert';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { 
  Activity, 
  Server, 
  Database,
  Network,
  AlertTriangle,
  CheckCircle,
  Zap,
  RefreshCw,
  TrendingUp,
  Users,
  HardDrive,
  Wifi
} from 'lucide-react';
import { logger } from '../utils/logger';
import { useAuth } from '../auth/AuthProvider';

// --- (Interfaces remain the same) ---
interface MetricDataPoint {
  time: string;
  value: number;
}
interface MetricStats {
  cpu: number;
  memory: number;
  active_pods: number;
  active_sessions: number;
}
interface ChartData {
  timestamp: string;
  cpu: number;
  memory: number;
  active_pods: number;
  active_sessions: number;
}
interface InfrastructureStatus {
  component: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  last_check: string;
}

const API_BASE_URL = '/api';

export function AdvancedMonitoring() {
  const [activeTab, setActiveTab] = useState('realtime');
  const [realTimeMetrics, setRealTimeMetrics] = useState<ChartData[]>([]);
  const [currentStats, setCurrentStats] = useState<MetricStats>({
    cpu: 0, memory: 0, active_pods: 0, active_sessions: 0
  });
  const [isLive, setIsLive] = useState(true);
  const [infrastructureStatus, setInfrastructureStatus] = useState<InfrastructureStatus[]>([]);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);

  const { getAuthHeader } = useAuth(); 

  const mockInfrastructureStatus: InfrastructureStatus[] = [
    { component: 'Kubernetes Cluster', status: 'healthy', message: 'All nodes operational', last_check: '2 minutes ago' },
    { component: 'Database Cluster', status: 'warning', message: 'High connection count', last_check: '30 seconds ago' },
  ];

  const fetchPrometheusQuery = async (query: string) => {
    if (!getAuthHeader) {
      const err = new Error("getAuthHeader is not a function");
      logger.error(`Prometheus query auth failed: ${query}`, err.message);
      setMonitoringError(err.message);
      return 0;
    }
    try {
      const response = await fetch(
        `${API_BASE_URL}/monitoring/query?query=${encodeURIComponent(query)}`,
        {
          headers: getAuthHeader()
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(err.error || `Failed to fetch from proxy. Status: ${response.status}`);
      }
      const data = await response.json();
      if (data.status !== 'success' || data.data.result.length === 0) {
        return 0;
      }
      const value = parseFloat(data.data.result[0].value[1]);
      return isNaN(value) ? 0 : value;
    } catch (err: any) {
      logger.error(`Prometheus query failed: ${query}`, err.message);
      setMonitoringError(err.message);
      return 0;
    }
  };
  
  const fetchAllMetrics = async () => {
    setMonitoringError(null);

    // --- **FIX: Use the 'container_label_creator' label for reliable filtering** ---
    const queries = {
      cpu: 'sum(rate(container_cpu_usage_seconds_total{container_label_creator="orchestrator"}[1m])) * 100',
      memory: 'sum(container_memory_usage_bytes{container_label_creator="orchestrator"})',
      active_pods: 'count(container_last_seen{container_label_creator="orchestrator"})',
      active_sessions: 'sum(rate(management_requests_total[1m]))'
    };
    // --- **END FIX** ---

    const [cpu, memoryBytes, active_pods, req_rate] = await Promise.all([
      fetchPrometheusQuery(queries.cpu),
      fetchPrometheusQuery(queries.memory),
      fetchPrometheusQuery(queries.active_pods),
      fetchPrometheusQuery(queries.active_sessions)
    ]);
    
    const memory = memoryBytes / (1024 * 1024 * 1024); // Convert to GB
    const active_sessions = Math.floor(req_rate * 5); 

    const newStats: MetricStats = { cpu, memory, active_pods, active_sessions };
    setCurrentStats(newStats);

    const newChartData: ChartData = {
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      ...newStats
    };

    setRealTimeMetrics(prev => [...prev.slice(-20), newChartData]);
  };

  useEffect(() => {
    setInfrastructureStatus(mockInfrastructureStatus);

    if (isLive && getAuthHeader) {
      fetchAllMetrics(); 
      const interval = setInterval(fetchAllMetrics, 15000); // Check every 15 seconds
      return () => clearInterval(interval);
    } else if (!isLive) {
      setRealTimeMetrics([]);
    }
  }, [isLive, getAuthHeader]);

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl mb-2 flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Advanced Monitoring
          </h1>
          <p className="text-muted-foreground text-sm lg:text-base">
            Real-time infrastructure monitoring
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={isLive ? "default" : "outline"}
            onClick={() => setIsLive(!isLive)}
            className="gap-2"
          >
            {isLive ? (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Live
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Paused
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Real-time Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Total CPU Usage</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{currentStats.cpu.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              All lab containers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Total Memory</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{currentStats.memory.toFixed(2)} GB</div>
            <p className="text-xs text-muted-foreground">
              Used by lab containers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Active Pods</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{currentStats.active_pods}</div>
            <p className="text-xs text-muted-foreground">
              Running 'praktikum_' containers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">API Request Rate</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl">{currentStats.active_sessions.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Requests/sec (all endpoints)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Critical Alerts */}
      <div className="space-y-2">
        {monitoringError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Monitoring Error:</strong> {monitoringError}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Monitoring Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* --- FIX: Changed to grid-cols-3 --- */}
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="realtime">Real-time</TabsTrigger>
          <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
        </TabsList>

        {/* Real-time Metrics Tab */}
        <TabsContent value="realtime" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>System Resources</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Live CPU and Memory utilization
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={realTimeMetrics}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis 
                        dataKey="timestamp" 
                        tick={{ fontSize: 12 }}
                        interval="preserveStartEnd"
                      />
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
                        dataKey="cpu" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        name="CPU %"
                        dot={false}
                        connectNulls
                      />
                      <Line 
                        type="monotone" 
                        dataKey="memory" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        name="Memory (GB)"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pod & Session Activity</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Container instances and API request rate
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={realTimeMetrics}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis 
                        dataKey="timestamp" 
                        tick={{ fontSize: 12 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px'
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="active_pods" 
                        yAxisId="left"
                        stackId="1"
                        stroke="#f59e0b" 
                        fill="#f59e0b" 
                        fillOpacity={0.3}
                        strokeWidth={2}
                        name="Active Pods"
                        connectNulls
                      />
                      <Area 
                        type="monotone" 
                        dataKey="active_sessions" 
                        yAxisId="right"
                        stackId="2"
                        stroke="#8b5cf6" 
                        fill="#8b5cf6" 
                        fillOpacity={0.3}
                        strokeWidth={2}
                        name="API Req/sec"
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        {/* Infrastructure Tab */}
        <TabsContent value="infrastructure" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Infrastructure Status (Mock)</CardTitle>
            </CardHeader>
            <CardContent>
              {mockInfrastructureStatus.map((item) => (
                <div key={item.component}>{item.component}: {item.message}</div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Network Tab */}
        <TabsContent value="network" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Network (Mock)</CardTitle>
            </CardHeader>
            <CardContent>
              <p>Network monitoring placeholder.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}