// Simple logging utility to help debug issues and reduce console warnings

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  data?: any;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 100; // Keep only the last 100 logs

  private shouldLog(level: LogLevel): boolean {
    // In production, only log warnings and errors
    if (process.env.NODE_ENV === 'production') {
      return level === 'warn' || level === 'error';
    }
    return true;
  }

  private addLog(level: LogLevel, message: string, data?: any) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      data
    };

    this.logs.push(entry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    if (this.shouldLog(level)) {
      const logMethod = console[level] || console.log;
      if (data) {
        logMethod(`[${level.toUpperCase()}]`, message, data);
      } else {
        logMethod(`[${level.toUpperCase()}]`, message);
      }
    }
  }

  info(message: string, data?: any) {
    this.addLog('info', message, data);
  }

  warn(message: string, data?: any) {
    this.addLog('warn', message, data);
  }

  error(message: string, data?: any) {
    this.addLog('error', message, data);
  }

  debug(message: string, data?: any) {
    this.addLog('debug', message, data);
  }

  // Get recent logs for debugging
  getRecentLogs(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs];
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
  }
}

export const logger = new Logger();

// Helper for API call logging
export const logApiCall = (endpoint: string, method: string, success: boolean, error?: any) => {
  const message = `API ${method} ${endpoint} ${success ? 'succeeded' : 'failed'}`;
  if (success) {
    logger.info(message);
  } else {
    logger.error(message, error);
  }
};

// Helper for component mount/unmount logging
export const logComponentLifecycle = (componentName: string, action: 'mount' | 'unmount') => {
  logger.debug(`Component ${componentName} ${action}ed`);
};