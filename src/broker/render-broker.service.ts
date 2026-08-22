import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { JobHeartbeatContract } from '../contracts/job-heartbeat.contract.js';
import { createJobClaimContract } from '../contracts/job-claim.contract.js';
import type { JobClaimContract } from '../contracts/job-claim.contract.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import type { Logger } from '../types/log.types.js';
import { RetryOperation } from '../services/retry-policy.service.js';
import type { IRetryPolicyService } from '../services/retry-policy.service.js';
import { JobState } from './job-state.types.js';
import type { JobStateMachine } from './job-state-machine.js';
import type { ILeaseManager } from './lease-manager.js';
import type { IHeartbeatWatcher } from './heartbeat-watcher.js';
import type { IDeadJobRecoveryService } from './dead-job-recovery.service.js';
import type { INodeSelectionStrategy } from './strategies/node-selection-strategy.interface.js';
import type { CachedNode } from './node-registry.types.js';
import type { SchedulingRequirement } from './scheduling-requirement.types.js';
import { matchesCapability } from './capability-match.js';
import type { NodeScore } from './node-scoring.service.js';

export class UnknownNodeError extends Error {
  constructor(nodeUuid: string) {
    super(`Bilinmeyen nodeUuid: ${nodeUuid}`);
    this.name = 'UnknownNodeError';
  }
}

export class NoCapableNodeError extends Error {
  constructor(jobUuid: string, requirement: SchedulingRequirement) {
    super(
      `"${jobUuid}" için uygun node bulunamadı (engine=${requirement.engine}, renderProfile=${requirement.renderProfile}).`,
    );
    this.name = 'NoCapableNodeError';
  }
}

export interface RenderBrokerServiceDependencies {
  jobStateMachine: JobStateMachine;
  leaseManager: ILeaseManager;
  heartbeatWatcher: IHeartbeatWatcher;
  deadJobRecoveryService: IDeadJobRecoveryService;
  selectionStrategy: INodeSelectionStrategy;
  retryPolicy: IRetryPolicyService;
  contractRegistry: ContractRegistry;
  logger: Logger;
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 3;

export interface IRenderBrokerService {
  registerNode(report: CapabilityReportContract): void;
  updateNodeCapability(report: CapabilityReportContract): void;
  recordHeartbeat(nodeUuid: string, heartbeat: JobHeartbeatContract): void;
  scheduleJob(jobUuid: string, requirement: SchedulingRequirement): JobClaimContract;
  reportJobCompleted(jobUuid: string, templateUuid: string): void;
  reportJobFailed(jobUuid: string): Promise<JobClaimContract | null>;
  cancelJob(jobUuid: string): void;
  isCancelled(jobUuid: string): boolean;
  checkFailover(): void;
  getNode(nodeUuid: string): CachedNode | undefined;
  listNodes(): CachedNode[];
}

/**
 * The single decision-maker the spec calls for: no other class in this
 * module (or anywhere else) implements node-selection, capability
 * filtering, lease creation, retry, load balancing, failover, or job
 * affinity logic — they all either call into this service or into the
 * smaller collaborators it composes (LeaseManager, HeartbeatWatcher,
 * NodeSelectionStrategy, DeadJobRecoveryService). Not a singleton: built
 * once by whoever composes the broker (the check script in this phase,
 * a future Laravel-equivalent process later) and handed out via
 * constructor injection.
 */
export class RenderBrokerService implements IRenderBrokerService {
  private readonly nodes = new Map<string, CachedNode>();
  private readonly jobsByNode = new Map<string, Set<string>>();
  private readonly nodeUuidByJob = new Map<string, string>();
  private readonly requirementByJob = new Map<string, SchedulingRequirement>();
  private readonly cancelledJobs = new Set<string>();

  constructor(private readonly deps: RenderBrokerServiceDependencies) {}

  registerNode(report: CapabilityReportContract): void {
    this.nodes.set(report.nodeUuid, {
      capability: report,
      latestHeartbeat: null,
      lastHeartbeatAt: Date.now(),
      processedTemplateUuids: new Set(),
    });
    this.deps.heartbeatWatcher.recordHeartbeat(report.nodeUuid);
    this.deps.logger.info("Node Broker'a kaydedildi", { nodeUuid: report.nodeUuid });
  }

  /** Only for a REAL capability change (Adobe/font/plugin/profile/engine) — never called on every heartbeat (see spec's Capability Cache section). */
  updateNodeCapability(report: CapabilityReportContract): void {
    const existing = this.nodes.get(report.nodeUuid);
    this.nodes.set(report.nodeUuid, {
      capability: report,
      latestHeartbeat: existing?.latestHeartbeat ?? null,
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? Date.now(),
      processedTemplateUuids: existing?.processedTemplateUuids ?? new Set(),
    });
    this.deps.logger.info('Node capability güncellendi', { nodeUuid: report.nodeUuid });
  }

  recordHeartbeat(nodeUuid: string, heartbeat: JobHeartbeatContract): void {
    const node = this.nodes.get(nodeUuid);
    if (!node) {
      throw new UnknownNodeError(nodeUuid);
    }

    node.latestHeartbeat = heartbeat;
    node.lastHeartbeatAt = Date.now();
    this.deps.heartbeatWatcher.recordHeartbeat(nodeUuid);
  }

  scheduleJob(jobUuid: string, requirement: SchedulingRequirement): JobClaimContract {
    this.requirementByJob.set(jobUuid, requirement);
    this.deps.jobStateMachine.transition(jobUuid, JobState.SCHEDULED);
    return this.selectAndClaim(jobUuid, requirement, 0);
  }

  reportJobCompleted(jobUuid: string, templateUuid: string): void {
    const nodeUuid = this.nodeUuidByJob.get(jobUuid);
    if (nodeUuid) {
      this.nodes.get(nodeUuid)?.processedTemplateUuids.add(templateUuid);
    }

    this.releaseJobLease(jobUuid);
    this.untrackJob(jobUuid);
    this.requirementByJob.delete(jobUuid);
  }

  async reportJobFailed(jobUuid: string): Promise<JobClaimContract | null> {
    const requirement = this.requirementByJob.get(jobUuid);
    const previousLease = this.deps.leaseManager.getLeaseForJob(jobUuid);
    const previousRetryCount = previousLease?.retryCount ?? 0;

    this.releaseJobLease(jobUuid);
    this.untrackJob(jobUuid);

    if (!requirement || previousRetryCount >= (this.deps.maxRetries ?? DEFAULT_MAX_RETRIES)) {
      this.deps.jobStateMachine.transition(jobUuid, JobState.CANCELLED);
      this.deps.logger.error('Job için maksimum retry sayısına ulaşıldı', {
        jobUuid,
        retryCount: previousRetryCount,
      });
      return null;
    }

    this.deps.jobStateMachine.transition(jobUuid, JobState.RETRYING);
    this.deps.logger.warn('Job retry ediliyor', { jobUuid, retryCount: previousRetryCount + 1 });

    return this.deps.retryPolicy.execute(RetryOperation.JOB_SCHEDULING, async () => {
      this.deps.jobStateMachine.transition(jobUuid, JobState.SCHEDULED);
      return this.selectAndClaim(jobUuid, requirement, previousRetryCount + 1);
    });
  }

  cancelJob(jobUuid: string): void {
    this.cancelledJobs.add(jobUuid);
    this.deps.jobStateMachine.transition(jobUuid, JobState.CANCELLED);
    this.releaseJobLease(jobUuid);
    this.untrackJob(jobUuid);
    this.deps.logger.info('Job iptal edildi', { jobUuid });
  }

  isCancelled(jobUuid: string): boolean {
    return this.cancelledJobs.has(jobUuid);
  }

  /** Meant to be polled periodically (a real scheduled sweep in production, the check script's own loop in this simulation). */
  checkFailover(): void {
    const offlineNodes = this.deps.heartbeatWatcher.findNewlyOfflineNodes();

    for (const nodeUuid of offlineNodes) {
      const jobUuids = Array.from(this.jobsByNode.get(nodeUuid) ?? []);
      const recovered = this.deps.deadJobRecoveryService.recoverNode(nodeUuid, jobUuids);

      for (const jobUuid of recovered) {
        this.untrackJob(jobUuid);
        const requirement = this.requirementByJob.get(jobUuid);
        if (!requirement) {
          continue;
        }

        try {
          this.scheduleJob(jobUuid, requirement);
        } catch (error) {
          this.deps.logger.error('Kurtarılan job yeniden zamanlanamadı', {
            jobUuid,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  getNode(nodeUuid: string): CachedNode | undefined {
    return this.nodes.get(nodeUuid);
  }

  listNodes(): CachedNode[] {
    return Array.from(this.nodes.values());
  }

  private selectAndClaim(
    jobUuid: string,
    requirement: SchedulingRequirement,
    retryCount: number,
  ): JobClaimContract {
    const candidates = this.listNodes().filter(
      (node) =>
        matchesCapability(node.capability, requirement) &&
        this.hasFreeCapacity(node) &&
        this.deps.heartbeatWatcher.isOnline(node.capability.nodeUuid),
    );

    const { node, scores } = this.deps.selectionStrategy.select(candidates, requirement);
    this.logScores(jobUuid, scores);

    if (!node) {
      this.deps.jobStateMachine.transition(jobUuid, JobState.FAILED);
      throw new NoCapableNodeError(jobUuid, requirement);
    }

    const lease = this.deps.leaseManager.createLease(jobUuid, retryCount);
    this.deps.jobStateMachine.transition(jobUuid, JobState.LEASED);
    this.trackJobOnNode(jobUuid, node.capability.nodeUuid);

    const version = this.deps.contractRegistry.getCurrentVersion(ContractName.JOB_CLAIM);
    const claim = createJobClaimContract(
      { jobUuid, nodeUuid: node.capability.nodeUuid, claimedAt: new Date().toISOString(), lease },
      version,
    );
    this.deps.contractRegistry.validate(ContractName.JOB_CLAIM, claim);

    this.deps.jobStateMachine.transition(jobUuid, JobState.CLAIMED);

    this.deps.logger.info('Job claim edildi', {
      jobUuid,
      nodeUuid: node.capability.nodeUuid,
      leaseId: lease.leaseId,
      strategy: this.deps.selectionStrategy.name,
    });

    return claim;
  }

  private hasFreeCapacity(node: CachedNode): boolean {
    const performance = node.latestHeartbeat ?? node.capability.performance;
    const running =
      'runningJobs' in performance ? performance.runningJobs : performance.currentRunningJobs;
    return running < performance.maxConcurrentJobs;
  }

  private trackJobOnNode(jobUuid: string, nodeUuid: string): void {
    this.nodeUuidByJob.set(jobUuid, nodeUuid);
    if (!this.jobsByNode.has(nodeUuid)) {
      this.jobsByNode.set(nodeUuid, new Set());
    }
    this.jobsByNode.get(nodeUuid)?.add(jobUuid);
  }

  private untrackJob(jobUuid: string): void {
    const nodeUuid = this.nodeUuidByJob.get(jobUuid);
    if (nodeUuid) {
      this.jobsByNode.get(nodeUuid)?.delete(jobUuid);
      this.nodeUuidByJob.delete(jobUuid);
    }
  }

  private releaseJobLease(jobUuid: string): void {
    const lease = this.deps.leaseManager.getLeaseForJob(jobUuid);
    if (lease) {
      this.deps.leaseManager.releaseLease(lease.leaseId);
    }
  }

  private logScores(jobUuid: string, scores: NodeScore[]): void {
    this.deps.logger.debug('Node seçim skorları', {
      jobUuid,
      strategy: this.deps.selectionStrategy.name,
      scores,
    });
  }
}
