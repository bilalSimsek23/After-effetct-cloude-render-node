import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderNodeConfig } from '../types/config.types.js';

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'config.json');
const PLACEHOLDER_VALUE = 'CHANGE_ME';

/**
 * Reads and validates config.json. This phase uses a config file instead
 * of .env, per the Render Node spec — everything the app needs at runtime
 * comes from here.
 *
 * Config loading happens before the logger exists, so failures here are
 * reported to stderr and are fatal: without a valid config, nothing else
 * in the application can meaningfully start.
 */
export class ConfigLoader {
  constructor(private readonly configPath: string = DEFAULT_CONFIG_PATH) {}

  load(): RenderNodeConfig {
    const raw = this.readFile();
    const parsed = this.parseJson(raw);
    this.assertValid(parsed);

    for (const field of ['nodeUuid', 'apiSecret'] as const) {
      if (parsed[field] === PLACEHOLDER_VALUE) {
        console.warn(
          `[config] "${field}" hâlâ "${PLACEHOLDER_VALUE}" — "php artisan cloud-render:register-render-node" çıktısındaki gerçek değerle değiştirin.`,
        );
      }
    }

    return parsed;
  }

  private readFile(): string {
    try {
      return readFileSync(this.configPath, 'utf-8');
    } catch (error) {
      throw new ConfigLoadError(
        `Config dosyası okunamadı: ${this.configPath} (${(error as Error).message})`,
      );
    }
  }

  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new ConfigLoadError(
        `Config dosyası geçerli bir JSON değil: ${this.configPath} (${(error as Error).message})`,
      );
    }
  }

  private assertValid(value: unknown): asserts value is RenderNodeConfig {
    if (typeof value !== 'object' || value === null) {
      throw new ConfigLoadError('Config dosyasının kökü bir JSON nesnesi olmalı.');
    }

    const config = value as Record<string, unknown>;
    const errors: string[] = [];

    const stringFields: (keyof RenderNodeConfig)[] = [
      'server',
      'nodeUuid',
      'apiSecret',
      'nodeName',
      'agentVersion',
      'engine',
    ];
    const numberFields: (keyof RenderNodeConfig)[] = ['heartbeatInterval', 'maxConcurrentJobs'];

    for (const field of stringFields) {
      if (typeof config[field] !== 'string' || config[field] === '') {
        errors.push(`"${field}" alanı boş olmayan bir string olmalı.`);
      }
    }

    for (const field of numberFields) {
      if (
        typeof config[field] !== 'number' ||
        Number.isNaN(config[field]) ||
        (config[field] as number) <= 0
      ) {
        errors.push(`"${field}" alanı pozitif bir sayı olmalı.`);
      }
    }

    const supportedEngines = config.supportedEngines;
    if (
      !Array.isArray(supportedEngines) ||
      supportedEngines.length === 0 ||
      !supportedEngines.every((engine) => typeof engine === 'string' && engine !== '')
    ) {
      errors.push('"supportedEngines" alanı en az bir string içeren bir dizi olmalı.');
    }

    const pushServer = config.pushServer as Record<string, unknown> | undefined;
    if (typeof pushServer !== 'object' || pushServer === null) {
      errors.push('"pushServer" alanı bir nesne olmalı ({ port, tunnelToken }).');
    } else {
      if (
        typeof pushServer.port !== 'number' ||
        Number.isNaN(pushServer.port) ||
        pushServer.port <= 0
      ) {
        errors.push('"pushServer.port" alanı pozitif bir sayı olmalı.');
      }
      if (typeof pushServer.tunnelToken !== 'string' || pushServer.tunnelToken === '') {
        errors.push('"pushServer.tunnelToken" alanı boş olmayan bir string olmalı.');
      }
    }

    if (errors.length > 0) {
      throw new ConfigLoadError(`Config dosyası geçersiz:\n- ${errors.join('\n- ')}`);
    }
  }
}
