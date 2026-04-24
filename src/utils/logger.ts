import winston from 'winston';
import { config } from '../config';

// Winston level → Google Cloud Logging severity.
// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
const LEVEL_TO_SEVERITY: Record<string, string> = {
  error: 'ERROR',
  warn: 'WARNING',
  info: 'INFO',
  http: 'INFO',
  verbose: 'DEBUG',
  debug: 'DEBUG',
  silly: 'DEBUG',
};

// Cloud Run ingests stdout as structured logs when the payload is JSON and
// carries a top-level `severity` field. This format emits exactly that, plus
// `message` / `stack` / any extra meta — so Cloud Logging auto-categorises
// each line and the UI lets you filter by severity=ERROR without guesswork.
const cloudRunJsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { level, message, timestamp, stack, ...meta } = info;
    return JSON.stringify({
      severity: LEVEL_TO_SEVERITY[level] || 'DEFAULT',
      message: stack || message,
      time: timestamp,
      ...meta,
    });
  })
);

// Human-friendly format for local dev — coloured, compact, no JSON noise.
const devConsoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

const isCloudRun = !!process.env.K_SERVICE || config.isProduction || config.nodeEnv === 'staging';

export const logger = winston.createLogger({
  level: config.logLevel,
  // No File transports: Cloud Run filesystem is ephemeral and read-only except
  // /tmp, and GCP already persists stdout/stderr in Cloud Logging.
  transports: [
    new winston.transports.Console({
      format: isCloudRun ? cloudRunJsonFormat : devConsoleFormat,
    }),
  ],
});

// Stream for Morgan
export const morganStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};
