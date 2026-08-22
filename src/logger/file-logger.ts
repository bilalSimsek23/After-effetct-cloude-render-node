import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LogLevel } from '../types/log.types.js';
import type { Logger, LogMeta } from '../types/log.types.js';
import type { NodeIdentityService } from '../services/node-identity.service.js';

const UNREGISTERED_NODE_LABEL = 'unregistered';

/**
 * Writes log lines to logs/YYYY-MM-DD.log (one file per day) and mirrors
 * them to the console. Implements the Logger interface so every other
 * service depends on the abstraction, not this concrete class.
 *
 * Every line is tagged with the current node_uuid (read live from
 * NodeIdentityService), so log aggregation across a future Render Farm can
 * filter by node without each service having to push its identity in.
 */
export class FileLogger implements Logger {
  private readonly logsDir: string;

  constructor(
    private readonly nodeIdentity: NodeIdentityService,
    logsDir: string = resolve(process.cwd(), 'logs'),
  ) {
    this.logsDir = logsDir;
    mkdirSync(this.logsDir, { recursive: true });
  }

  info(message: string, meta?: LogMeta): void {
    this.write(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.write(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.write(LogLevel.ERROR, message, meta);
  }

  debug(message: string, meta?: LogMeta): void {
    this.write(LogLevel.DEBUG, message, meta);
  }

  private write(level: LogLevel, message: string, meta?: LogMeta): void {
    const timestamp = new Date();
    const line = this.formatLine(timestamp, level, message, meta);

    appendFileSync(this.getLogFilePath(timestamp), line + '\n', 'utf-8');
    this.echoToConsole(level, line);
  }

  private formatLine(timestamp: Date, level: LogLevel, message: string, meta?: LogMeta): string {
    const nodeUuid = this.nodeIdentity.getNodeUuid() ?? UNREGISTERED_NODE_LABEL;
    const metaSuffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp.toISOString()}] [${level}] [node:${nodeUuid}] ${message}${metaSuffix}`;
  }

  private getLogFilePath(timestamp: Date): string {
    const datePart = timestamp.toISOString().slice(0, 10); // YYYY-MM-DD
    return resolve(this.logsDir, `${datePart}.log`);
  }

  private echoToConsole(level: LogLevel, line: string): void {
    switch (level) {
      case LogLevel.ERROR:
        console.error(line);
        break;
      case LogLevel.WARN:
        console.warn(line);
        break;
      default:
        console.log(line);
    }
  }
}
