import { randomUUID } from 'node:crypto';
import { createJobLeaseContract } from '../contracts/job-lease.contract.js';
import type { JobLeaseContract } from '../contracts/job-lease.contract.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import type { Logger } from '../types/log.types.js';

export class LeaseNotFoundError extends Error {
  constructor(leaseId: string) {
    super(`Bilinmeyen leaseId: ${leaseId}`);
    this.name = 'LeaseNotFoundError';
  }
}

const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_RENEW_INTERVAL_SECONDS = 20;

interface LeaseEntry {
  jobUuid: string;
  lease: JobLeaseContract;
}

export interface ILeaseManager {
  createLease(jobUuid: string, retryCount?: number): JobLeaseContract;
  renewLease(leaseId: string): JobLeaseContract;
  releaseLease(leaseId: string): void;
  expireLease(leaseId: string): void;
  forceRelease(leaseId: string): void;
  getLeaseForJob(jobUuid: string): JobLeaseContract | null;
  isExpired(leaseId: string, nowMs?: number): boolean;
}

/**
 * The only place a JobLeaseContract is created, renewed, or released.
 * Real Contract usage per the spec — every lease this class hands out is
 * built via the Contract Registry (current version) and validated before
 * being returned, never assembled ad hoc by a caller.
 */
export class LeaseManager implements ILeaseManager {
  private readonly leasesById = new Map<string, LeaseEntry>();
  private readonly leaseIdByJob = new Map<string, string>();

  constructor(
    private readonly contractRegistry: ContractRegistry,
    private readonly logger: Logger,
    private readonly leaseDurationMs: number = DEFAULT_LEASE_DURATION_MS,
  ) {}

  createLease(jobUuid: string, retryCount = 0): JobLeaseContract {
    const leaseId = randomUUID();
    const lease = this.buildLease(leaseId, retryCount, DEFAULT_RENEW_INTERVAL_SECONDS);

    this.leasesById.set(leaseId, { jobUuid, lease });
    this.leaseIdByJob.set(jobUuid, leaseId);

    this.logger.info('Lease oluşturuldu', {
      jobUuid,
      leaseId,
      leaseExpireAt: lease.leaseExpireAt,
      retryCount,
    });

    return lease;
  }

  renewLease(leaseId: string): JobLeaseContract {
    const entry = this.require(leaseId);
    const renewed = this.buildLease(
      leaseId,
      entry.lease.retryCount,
      entry.lease.renewIntervalSeconds,
    );

    entry.lease = renewed;
    this.logger.debug('Lease yenilendi', { leaseId, leaseExpireAt: renewed.leaseExpireAt });

    return renewed;
  }

  releaseLease(leaseId: string): void {
    const entry = this.require(leaseId);
    this.leasesById.delete(leaseId);
    this.leaseIdByJob.delete(entry.jobUuid);
    this.logger.debug('Lease serbest bırakıldı', { leaseId, jobUuid: entry.jobUuid });
  }

  expireLease(leaseId: string): void {
    const entry = this.require(leaseId);
    this.logger.info('Lease süresi doldu', { leaseId, jobUuid: entry.jobUuid });
    this.releaseLease(leaseId);
  }

  /** Tolerant of an already-released lease — a failover sweep may race with a normal release. */
  forceRelease(leaseId: string): void {
    const entry = this.leasesById.get(leaseId);
    if (!entry) {
      return;
    }
    this.logger.warn('Lease zorla serbest bırakıldı', { leaseId, jobUuid: entry.jobUuid });
    this.releaseLease(leaseId);
  }

  getLeaseForJob(jobUuid: string): JobLeaseContract | null {
    const leaseId = this.leaseIdByJob.get(jobUuid);
    if (!leaseId) {
      return null;
    }
    return this.leasesById.get(leaseId)?.lease ?? null;
  }

  isExpired(leaseId: string, nowMs: number = Date.now()): boolean {
    const entry = this.require(leaseId);
    return new Date(entry.lease.leaseExpireAt).getTime() <= nowMs;
  }

  private buildLease(
    leaseId: string,
    retryCount: number,
    renewIntervalSeconds: number,
  ): JobLeaseContract {
    const version = this.contractRegistry.getCurrentVersion(ContractName.JOB_LEASE);
    const lease = createJobLeaseContract(
      {
        leaseId,
        leaseExpireAt: new Date(Date.now() + this.leaseDurationMs).toISOString(),
        renewIntervalSeconds,
        retryCount,
      },
      version,
    );

    this.contractRegistry.validate(ContractName.JOB_LEASE, lease);

    return lease;
  }

  private require(leaseId: string): LeaseEntry {
    const entry = this.leasesById.get(leaseId);
    if (!entry) {
      throw new LeaseNotFoundError(leaseId);
    }
    return entry;
  }
}
