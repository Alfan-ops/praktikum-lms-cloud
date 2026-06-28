import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { useAuth } from '../auth/AuthProvider';
import { logger } from '../utils/logger';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';

// API base URL
const API_BASE_URL = '/api';

// Type for the processed chart data
interface ChartDataPoint {
  time: string;
  cpu: number | null;
  memory: number | null;
  pods: number | null;
}

// Type for the raw Prometheus response
interface PromRangeResult {
  metric: {};
  values: [number, string][];
}

export function MonitoringCharts() {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { user, getAuthHeader } = useAuth(); 

  useEffect(() => {
    if (user && getAuthHeader) {
      fetchChartData();
    }
  }, [user, getAuthHeader]); 

  const fetchChartData = async () => {
    setLoading(true);
    setError(null);

    if (!getAuthHeader) {
      setError("Authentication function not ready.");
      setLoading(false);
      return;
    }

    try {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const step = '3600s'; // 1 hour

      // --- **FIX: Use the 'container_label_creator' label for reliable filtering** ---
      const queries = {
        cpu: 'sum(rate(container_cpu_usage_seconds_total{container_label_creator="orchestrator"}[5m])) * 100',
        memory: 'sum(container_memory_usage_bytes{container_label_creator="orchestrator"}) / (1024 * 1024 * 1024)', // in GB
        pods: 'count(container_last_seen{container_label_creator="orchestrator"})',
      };
      // --- **END FIX** ---

      const fetchPromises = Object.entries(queries).map(([key, query]) =>
        fetch(
          `${API_BASE_URL}/monitoring/query_range?query=${encodeURIComponent(query)}&start=${start.toISOString()}&end=${end.toISOString()}&step=${step}`,
          { headers: getAuthHeader() } 
        ).then(res => {
          if (!res.ok) {
            throw new Error(`Failed to fetch ${key}: ${res.status} ${res.statusText}`);
          }
          return res.json();
        })
      );

      const [cpuRes, memRes, podRes] = await Promise.all(fetchPromises);

      const mergedData: { [key: number]: ChartDataPoint } = {};
      
      const processResult = (result: PromRangeResult[], key: 'cpu' | 'memory' | 'pods') => {
        if (result && result.length > 0 && result[0].values) {
          result[0].values.forEach(([timestamp, value]) => {
            if (!mergedData[timestamp]) {
              mergedData[timestamp] = {
                time: new Date(timestamp * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
                cpu: null,
                memory: null,
                pods: null,
              };
            }
            const numericValue = parseFloat(value);
            if (!isNaN(numericValue)) {
              mergedData[timestamp][key] = numericValue;
            }
          });
        }
      };
      
      processResult(cpuRes?.data?.result, 'cpu');
      processResult(memRes?.data?.result, 'memory');
      processResult(podRes?.data?.result, 'pods');

      const chartData = Object.values(mergedData).sort((a, b) => a.time.localeCompare(b.time));
      
      if (chartData.length === 0) {
        logger.warn("No monitoring data returned from Prometheus.", {cpuRes, memRes, podRes});
        // We won't throw an error, just show empty charts
        setData([]);
      } else {
        setData(chartData);
      }

    } catch (err: any) {
      logger.error('Failed to fetch monitoring charts:', err);
      setError(err.message || 'Failed to load monitoring data.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Loading charts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  
  if (data.length === 0) {
    return (
       <Alert variant="default">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No monitoring data found. Try starting a virtual lab session to generate metrics.
        </AlertDescription>
      </Alert>
    )
  }

  const latestData = data.length > 0 ? data[data.length - 1] : {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* CPU Usage */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">CPU Usage (%) - 24h</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} className="text-xs" />
              <YAxis axisLine={false} tickLine={false} className="text-xs" domain={[0, 'auto']} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px'
                }}
                formatter={(value: number) => [value ? value.toFixed(1) : '0', 'CPU %']}
              />
              <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Current</span>
          <span className="font-medium">{(latestData as ChartDataPoint).cpu?.toFixed(1) || '0.0'}%</span>
        </div>
      </div>

      {/* Memory Usage */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Memory Usage (GB) - 24h</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} className="text-xs" />
              <YAxis axisLine={false} tickLine={false} className="text-xs" domain={[0, 'auto']} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px'
                }}
                formatter={(value: number) => [value ? value.toFixed(2) : '0.00', 'GB']}
              />
              <Area type="monotone" dataKey="memory" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Current</span>
          <span className="font-medium">{(latestData as ChartDataPoint).memory?.toFixed(2) || '0.00'} GB</span>
        </div>
      </div>

      {/* Active Pods */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Active Pods - 24h</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} className="text-xs" />
              <YAxis axisLine={false} tickLine={false} className="text-xs" allowDecimals={false} domain={[0, 'auto']} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px'
                }}
                formatter={(value: number) => [value || '0', 'Pods']}
              />
              <Line type="step" dataKey="pods" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Current</span>
          <span className="font-medium">{(latestData as ChartDataPoint).pods || 0} Pods</span>
        </div>
      </div>
    </div>
  );
}