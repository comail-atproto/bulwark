type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const COLORS: Record<LogLevel, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[34m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

function getLevel(): number {
  const env = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  return env && env in LEVELS ? LEVELS[env] : LEVELS.info;
}

function isJson(): boolean {
  return process.env.LOG_FORMAT?.toLowerCase() === 'json';
}

function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] > getLevel()) return;

  if (isJson()) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
    };
    const out = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      console.error(out);
    } else {
      console.log(out);
    }
    return;
  }

  const color = COLORS[level];
  const tag = `${color}[${level.toUpperCase().padEnd(5)}]${RESET}`;
  const ts = new Date().toISOString();
  const suffix = extra && Object.keys(extra).length > 0
    ? ` ${COLORS.debug}${JSON.stringify(extra)}${RESET}`
    : '';

  if (level === 'error' || level === 'warn') {
    console.error(`${tag} ${ts} ${message}${suffix}`);
  } else {
    console.log(`${tag} ${ts} ${message}${suffix}`);
  }
}

export const logger = {
  error: (message: string, extra?: Record<string, unknown>) => log('error', message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => log('warn', message, extra),
  info: (message: string, extra?: Record<string, unknown>) => log('info', message, extra),
  debug: (message: string, extra?: Record<string, unknown>) => log('debug', message, extra),
  request: (method: string, path: string, status: number, durationMs: number) =>
    log('info', `${method} ${path} ${status}`, { method, path, status, durationMs }),
};
