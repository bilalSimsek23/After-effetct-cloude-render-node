export const LogLevel = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type LogMeta = Record<string, unknown>;

export interface Logger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
}
