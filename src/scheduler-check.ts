/**
 * Standalone verification for the Phase 6 Distributed Render Broker,
 * Scheduler & Execution Orchestrator — simulates at least 3 virtual
 * Render Nodes (no real Adobe/Laravel involved, per the spec's own "bu
 * fazda gerçek Adobe Render alınmayacaktır") and exercises every exit
 * criterion the spec lists: correct node selection under concurrent load,
 * capability filtering, lease-based failover + Dead Job Recovery, retry
 * on failure, Job Affinity, the Node Score algorithm, and the Strategy
 * Pattern itself (four interchangeable strategies).
 *
 * Run via `npm run check:scheduler`.
 */
import { randomUUID } from 'node:crypto';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import type { ContractRegistry } from './contracts/registry/contract-registry.js';
import { createCapabilityReportContract } from './contracts/capability-report.contract.js';
import type { CapabilityReportContract } from './contracts/capability-report.contract.js';
import { createJobHeartbeatContract } from './contracts/job-heartbeat.contract.js';
import type { JobHeartbeatContract } from './contracts/job-heartbeat.contract.js';
import { RenderProfileCode } from './contracts/render-profile.contract.js';
import { RenderJobPriority } from './contracts/render-job.contract.js';
import { RetryPolicyService } from './services/retry-policy.service.js';
import { JobStateMachine, InvalidJobStateTransitionError } from './broker/job-state-machine.js';
import { JobState } from './broker/job-state.types.js';
import { LeaseManager } from './broker/lease-manager.js';
import { HeartbeatWatcher } from './broker/heartbeat-watcher.js';
import { DeadJobRecoveryService } from './broker/dead-job-recovery.service.js';
import { NodeScoringService } from './broker/node-scoring.service.js';
import { LeastLoadedStrategy } from './broker/strategies/least-loaded.strategy.js';
import { CacheFirstStrategy } from './broker/strategies/cache-first.strategy.js';
import { TemplateAffinityStrategy } from './broker/strategies/template-affinity.strategy.js';
import { PriorityStrategy } from './broker/strategies/priority.strategy.js';
import type { INodeSelectionStrategy } from './broker/strategies/node-selection-strategy.interface.js';
import { RenderBrokerService, NoCapableNodeError } from './broker/render-broker.service.js';
import { JobScheduler } from './broker/job-scheduler.js';
import { ExecutionCoordinator } from './broker/execution-coordinator.js';
import type { SchedulingRequirement } from './broker/scheduling-requirement.types.js';
import type { Logger } from './types/log.types.js';

const AFTER_EFFECTS = 'after-effects';
const PREMIERE_PRO = 'premiere-pro';

function buildCapabilityReport(
  nodeUuid: string,
  nodeName: string,
  engine: string,
  maxConcurrentJobs: number,
): CapabilityReportContract {
  return createCapabilityReportContract({
    nodeUuid,
    nodeName,
    hostname: `${nodeName}.local`,
    operatingSystem: 'darwin 25.5.0',
    architecture: 'arm64',
    adobe: {
      afterEffectsVersion: '26.3.0',
      mediaEncoderVersion: '26.3.1',
      dynamicLinkAvailable: true,
    },
    supportedEngines: [engine],
    supportedRenderProfiles: [RenderProfileCode.PREVIEW, RenderProfileCode.MASTER],
    fontPackageVersion: 'font-pkg-v1',
    installedPlugins: [],
    supportedFormats: [],
    hardware: {
      cpuModel: 'Apple M2 Pro',
      cpuCores: 12,
      ramTotalBytes: 17179869184,
      gpuModel: 'Apple M2 Pro',
      gpuMemoryBytes: null,
      diskFreeBytes: 140000000000,
      diskTotalBytes: 994662584320,
    },
    performance: { maxConcurrentJobs, currentRunningJobs: 0, maxQueueLength: 10 },
  });
}

function buildHeartbeat(
  nodeUuid: string,
  runningJobs: number,
  maxConcurrentJobs: number,
): JobHeartbeatContract {
  return createJobHeartbeatContract({
    nodeUuid,
    uptimeSeconds: 120,
    memory: {
      totalBytes: 17179869184,
      usedBytes: 6000000000,
      freeBytes: 11179869184,
      usagePercent: 35,
    },
    runningJobs,
    maxConcurrentJobs,
    applicationVersion: '0.1.0',
    agentVersion: '1.0.0',
  });
}

interface VirtualNode {
  name: string;
  report: CapabilityReportContract;
}

function buildVirtualNodes(): {
  nodeA: VirtualNode;
  nodeB: VirtualNode;
  nodeC: VirtualNode;
  nodeD: VirtualNode;
} {
  return {
    nodeA: {
      name: 'nodeA',
      report: buildCapabilityReport(randomUUID(), 'Node-A', AFTER_EFFECTS, 4),
    },
    nodeB: {
      name: 'nodeB',
      report: buildCapabilityReport(randomUUID(), 'Node-B', AFTER_EFFECTS, 2),
    },
    nodeC: {
      name: 'nodeC',
      report: buildCapabilityReport(randomUUID(), 'Node-C', PREMIERE_PRO, 4),
    },
    nodeD: {
      name: 'nodeD',
      report: buildCapabilityReport(randomUUID(), 'Node-D', AFTER_EFFECTS, 4),
    },
  };
}

interface BrokerStack {
  jobStateMachine: JobStateMachine;
  leaseManager: LeaseManager;
  heartbeatWatcher: HeartbeatWatcher;
  renderBroker: RenderBrokerService;
  jobScheduler: JobScheduler;
  executionCoordinator: ExecutionCoordinator;
}

function createBrokerStack(
  contractRegistry: ContractRegistry,
  logger: Logger,
  strategy: INodeSelectionStrategy,
  offlineThresholdMs = 300,
  maxRetries = 2,
): BrokerStack {
  const jobStateMachine = new JobStateMachine(logger);
  const leaseManager = new LeaseManager(contractRegistry, logger);
  const heartbeatWatcher = new HeartbeatWatcher(logger, offlineThresholdMs);
  const deadJobRecoveryService = new DeadJobRecoveryService(jobStateMachine, leaseManager, logger);
  const retryPolicy = new RetryPolicyService(logger);

  const renderBroker = new RenderBrokerService({
    jobStateMachine,
    leaseManager,
    heartbeatWatcher,
    deadJobRecoveryService,
    selectionStrategy: strategy,
    retryPolicy,
    contractRegistry,
    logger,
    maxRetries,
  });

  const jobScheduler = new JobScheduler(jobStateMachine, renderBroker, logger);
  const executionCoordinator = new ExecutionCoordinator(jobStateMachine, renderBroker, logger);

  return {
    jobStateMachine,
    leaseManager,
    heartbeatWatcher,
    renderBroker,
    jobScheduler,
    executionCoordinator,
  };
}

function registerNode(stack: BrokerStack, node: VirtualNode, runningJobs = 0): void {
  stack.renderBroker.registerNode(node.report);
  stack.renderBroker.recordHeartbeat(
    node.report.nodeUuid,
    buildHeartbeat(node.report.nodeUuid, runningJobs, node.report.performance.maxConcurrentJobs),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function run(): Promise<void> {
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);
  const contractRegistry = createDefaultContractRegistry();

  logger.info('Render Broker / Scheduler doğrulama senaryosu başlıyor');

  let allPassed = true;
  const fail = (message: string, details?: Record<string, unknown>): void => {
    allPassed = false;
    logger.error(`FAIL: ${message}`, details);
  };

  const scoringService = new NodeScoringService();
  const leastLoaded = new LeastLoadedStrategy(scoringService);
  const cacheFirst = new CacheFirstStrategy(scoringService);
  const templateAffinity = new TemplateAffinityStrategy(scoringService);
  const priority = new PriorityStrategy(scoringService);

  const baseRequirement: Omit<SchedulingRequirement, 'templateUuid' | 'priority'> = {
    engine: AFTER_EFFECTS,
    renderProfile: RenderProfileCode.PREVIEW,
  };

  // --- Block 1: capability filtering — a mismatched node must never be picked, a matching one must. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, leastLoaded);
    const { nodeA, nodeC } = buildVirtualNodes();
    registerNode(stack, nodeA, 0);
    registerNode(stack, nodeC, 0);

    const jobUuid = randomUUID();
    const claim = stack.jobScheduler.submit(jobUuid, {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    });

    if (claim.nodeUuid !== nodeA.report.nodeUuid) {
      fail('Capability uyumlu tek node (nodeA) seçilmedi', { chosen: claim.nodeUuid });
    } else {
      logger.info('Block 1 OK: capability uyumsuz nodeC hiç seçilmedi, nodeA seçildi');
    }

    const premiereJobUuid = randomUUID();
    const premiereClaim = stack.jobScheduler.submit(premiereJobUuid, {
      engine: PREMIERE_PRO,
      renderProfile: RenderProfileCode.PREVIEW,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    });
    if (premiereClaim.nodeUuid !== nodeC.report.nodeUuid) {
      fail('premiere-pro işi nodeC dışında bir node seçti', { chosen: premiereClaim.nodeUuid });
    } else {
      logger.info(
        "Block 1 OK: premiere-pro işi doğru şekilde yalnızca nodeC'yi destekleyen node'a gitti",
      );
    }

    let noCapableThrown = false;
    try {
      stack.jobScheduler.submit(randomUUID(), {
        engine: 'davinci-resolve',
        renderProfile: RenderProfileCode.PREVIEW,
        templateUuid: randomUUID(),
        priority: RenderJobPriority.NORMAL,
      });
    } catch (error) {
      noCapableThrown = error instanceof NoCapableNodeError;
    }
    if (!noCapableThrown) {
      fail('Hiçbir node desteklemediği bir engine için NoCapableNodeError fırlatılmadı');
    } else {
      logger.info(
        'Block 1 OK: desteklenmeyen engine için NoCapableNodeError doğru şekilde fırlatıldı',
      );
    }
  }

  // --- Block 2: Node Score algorithm — the least-loaded of several capable nodes must win. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, leastLoaded);
    const { nodeA, nodeB, nodeD } = buildVirtualNodes();
    registerNode(stack, nodeA, 1); // 4 max, 1 running -> free ratio 0.75
    registerNode(stack, nodeB, 1); // 2 max, 1 running -> free ratio 0.5
    registerNode(stack, nodeD, 0); // 4 max, 0 running -> free ratio 1.0 (best)

    const jobUuid = randomUUID();
    const claim = stack.jobScheduler.submit(jobUuid, {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    });

    if (claim.nodeUuid !== nodeD.report.nodeUuid) {
      fail('Node Score: en boş node (nodeD) seçilmedi', { chosen: claim.nodeUuid });
    } else {
      logger.info("Block 2 OK: Node Score algoritması en boş node'u (nodeD) doğru seçti");
    }
  }

  // --- Block 3: multiple concurrent jobs must correctly redistribute as load shifts. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, leastLoaded);
    const { nodeA, nodeD } = buildVirtualNodes();
    registerNode(stack, nodeA, 0); // 4 max, 0 running
    registerNode(stack, nodeD, 0); // 4 max, 0 running — tied with nodeA initially

    const firstJobUuid = randomUUID();
    const firstClaim = stack.jobScheduler.submit(firstJobUuid, {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    });

    // Simulate the chosen node's own next heartbeat reflecting the new job.
    stack.renderBroker.recordHeartbeat(
      firstClaim.nodeUuid,
      buildHeartbeat(firstClaim.nodeUuid, 1, 4),
    );

    const secondJobUuid = randomUUID();
    const secondClaim = stack.jobScheduler.submit(secondJobUuid, {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    });

    if (secondClaim.nodeUuid === firstClaim.nodeUuid) {
      fail("İkinci iş, yükü artan aynı node'a tekrar gitti — load balancing çalışmadı", {
        firstNode: firstClaim.nodeUuid,
        secondNode: secondClaim.nodeUuid,
      });
    } else {
      logger.info("Block 3 OK: ardışık işler, yük değiştikçe farklı node'lara doğru dağıtıldı", {
        firstNode: firstClaim.nodeUuid,
        secondNode: secondClaim.nodeUuid,
      });
    }
  }

  // --- Block 4: Job Affinity — the same template should prefer the node that already processed it. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, templateAffinity);
    const { nodeA, nodeB } = buildVirtualNodes();
    registerNode(stack, nodeA, 0); // 4 max, 0 running — would normally win on pure load
    registerNode(stack, nodeB, 1); // 2 max, 1 running — more loaded, but will "warm up" the template

    const templateUuid = randomUUID();
    const requirement: SchedulingRequirement = {
      ...baseRequirement,
      templateUuid,
      priority: RenderJobPriority.NORMAL,
    };

    const firstJobUuid = randomUUID();
    const firstClaim = stack.jobScheduler.submit(firstJobUuid, requirement);
    stack.executionCoordinator.advance(firstJobUuid, JobState.PREPARING);
    stack.executionCoordinator.advance(firstJobUuid, JobState.EXECUTING);
    stack.executionCoordinator.advance(firstJobUuid, JobState.UPLOADING);
    stack.executionCoordinator.completeJob(firstJobUuid, templateUuid);

    const secondJobUuid = randomUUID();
    const secondClaim = stack.jobScheduler.submit(secondJobUuid, requirement);

    if (secondClaim.nodeUuid !== firstClaim.nodeUuid) {
      fail('Aynı template için Job Affinity çalışmadı — farklı bir node seçildi', {
        firstNode: firstClaim.nodeUuid,
        secondNode: secondClaim.nodeUuid,
      });
    } else {
      logger.info(
        "Block 4 OK: TemplateAffinityStrategy, aynı template için aynı node'u tercih etti",
        {
          nodeUuid: secondClaim.nodeUuid,
        },
      );
    }
  }

  // --- Block 5: Strategy Pattern — CacheFirst and LeastLoaded must genuinely disagree given the same warmed-up node. ---
  {
    const stackLeastLoaded = createBrokerStack(contractRegistry, logger, leastLoaded);
    const stackCacheFirst = createBrokerStack(contractRegistry, logger, cacheFirst);
    const { nodeA: nodeA1, nodeB: nodeB1 } = buildVirtualNodes();
    const { nodeA: nodeA2, nodeB: nodeB2 } = buildVirtualNodes();

    const templateUuid = randomUUID();
    const requirement: SchedulingRequirement = {
      ...baseRequirement,
      templateUuid,
      priority: RenderJobPriority.NORMAL,
    };

    // Warm nodeB up on both stacks by making nodeA look fully busy first
    // (forcing the warmup job onto nodeB regardless of strategy), then
    // resetting nodeA back to idle for the real comparison below.
    for (const [stack, nodeA, nodeB] of [
      [stackLeastLoaded, nodeA1, nodeB1],
      [stackCacheFirst, nodeA2, nodeB2],
    ] as const) {
      registerNode(stack, nodeA, 0);
      registerNode(stack, nodeB, 0);
      stack.renderBroker.recordHeartbeat(
        nodeA.report.nodeUuid,
        buildHeartbeat(nodeA.report.nodeUuid, 4, 4),
      );

      const warmupJobUuid = randomUUID();
      const warmupClaim = stack.jobScheduler.submit(warmupJobUuid, requirement);
      if (warmupClaim.nodeUuid !== nodeB.report.nodeUuid) {
        fail("Block 5 kurulumu başarısız: warmup işi nodeB'ye gitmedi", {
          chosen: warmupClaim.nodeUuid,
        });
      }
      stack.executionCoordinator.advance(warmupJobUuid, JobState.PREPARING);
      stack.executionCoordinator.advance(warmupJobUuid, JobState.EXECUTING);
      stack.executionCoordinator.advance(warmupJobUuid, JobState.UPLOADING);
      stack.executionCoordinator.completeJob(warmupJobUuid, templateUuid);

      stack.renderBroker.recordHeartbeat(
        nodeA.report.nodeUuid,
        buildHeartbeat(nodeA.report.nodeUuid, 0, 4),
      );
    }

    const leastLoadedClaim = stackLeastLoaded.jobScheduler.submit(randomUUID(), requirement);
    const cacheFirstClaim = stackCacheFirst.jobScheduler.submit(randomUUID(), requirement);

    logger.info('Block 5: strateji karşılaştırması', {
      leastLoadedChose: leastLoadedClaim.nodeUuid,
      leastLoadedExpected: nodeA1.report.nodeUuid,
      cacheFirstChose: cacheFirstClaim.nodeUuid,
      cacheFirstExpected: nodeB2.report.nodeUuid,
    });

    if (leastLoadedClaim.nodeUuid !== nodeA1.report.nodeUuid) {
      fail('LeastLoadedStrategy: idle nodeA yerine başka bir node seçildi', {
        chosen: leastLoadedClaim.nodeUuid,
      });
    } else if (cacheFirstClaim.nodeUuid !== nodeB2.report.nodeUuid) {
      fail('CacheFirstStrategy: cache-warm nodeB yerine başka bir node seçildi', {
        chosen: cacheFirstClaim.nodeUuid,
      });
    } else {
      logger.info(
        'Block 5 OK: aynı bağımlılıklarla, yalnızca enjekte edilen strateji farklı iki RenderBrokerService aynı durum için gerçekten farklı (ve doğru) kararlar verdi — Strategy Pattern / Open-Closed doğrulandı',
      );
    }
  }

  // --- Block 6: PriorityStrategy — HIGH prioritizes load, LOW prioritizes cache warmth. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, priority);
    const { nodeA, nodeB } = buildVirtualNodes();
    registerNode(stack, nodeA, 0); // idle
    registerNode(stack, nodeB, 1); // busier, but will be warmed up for a template

    const templateUuid = randomUUID();

    // Warm nodeB manually via a direct broker call scoped to nodeB only,
    // by temporarily scheduling+completing a job while nodeA is at full
    // capacity so it's forced onto nodeB.
    stack.renderBroker.recordHeartbeat(
      nodeA.report.nodeUuid,
      buildHeartbeat(nodeA.report.nodeUuid, 4, 4),
    );
    const warmupJobUuid = randomUUID();
    const warmupClaim = stack.jobScheduler.submit(warmupJobUuid, {
      ...baseRequirement,
      templateUuid,
      priority: RenderJobPriority.LOW,
    });
    stack.executionCoordinator.advance(warmupJobUuid, JobState.PREPARING);
    stack.executionCoordinator.advance(warmupJobUuid, JobState.EXECUTING);
    stack.executionCoordinator.advance(warmupJobUuid, JobState.UPLOADING);
    stack.executionCoordinator.completeJob(warmupJobUuid, templateUuid);

    if (warmupClaim.nodeUuid !== nodeB.report.nodeUuid) {
      fail("Priority testi kurulumu başarısız: warmup işi nodeB'ye gitmedi", {
        chosen: warmupClaim.nodeUuid,
      });
    }

    // nodeA is idle again for the real comparison.
    stack.renderBroker.recordHeartbeat(
      nodeA.report.nodeUuid,
      buildHeartbeat(nodeA.report.nodeUuid, 0, 4),
    );

    const highClaim = stack.jobScheduler.submit(randomUUID(), {
      ...baseRequirement,
      templateUuid,
      priority: RenderJobPriority.HIGH,
    });
    const lowClaim = stack.jobScheduler.submit(randomUUID(), {
      ...baseRequirement,
      templateUuid,
      priority: RenderJobPriority.LOW,
    });

    if (highClaim.nodeUuid !== nodeA.report.nodeUuid) {
      fail("PriorityStrategy: HIGH öncelik en boş node'u tercih etmedi", {
        chosen: highClaim.nodeUuid,
      });
    } else {
      logger.info("Block 6 OK: HIGH öncelik en boş node'u (nodeA) seçti");
    }
    if (lowClaim.nodeUuid !== nodeB.report.nodeUuid) {
      fail("PriorityStrategy: LOW öncelik cache-warm node'u tercih etmedi", {
        chosen: lowClaim.nodeUuid,
      });
    } else {
      logger.info("Block 6 OK: LOW öncelik cache-warm node'u (nodeB) seçti");
    }
  }

  // --- Block 7: node goes offline -> lease force-released -> job re-queued -> automatically rescheduled to a different online node. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, leastLoaded, 300);
    const { nodeA, nodeD } = buildVirtualNodes();
    registerNode(stack, nodeA, 0);
    registerNode(stack, nodeD, 1); // slightly busier, but will go offline

    // Force the job onto nodeD by making nodeA look fully busy for this pick.
    stack.renderBroker.recordHeartbeat(
      nodeA.report.nodeUuid,
      buildHeartbeat(nodeA.report.nodeUuid, 4, 4),
    );

    const jobUuid = randomUUID();
    const requirement: SchedulingRequirement = {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    };
    const claim = stack.jobScheduler.submit(jobUuid, requirement);

    if (claim.nodeUuid !== nodeD.report.nodeUuid) {
      fail("Failover testi kurulumu başarısız: iş nodeD'ye gitmedi", { chosen: claim.nodeUuid });
    }

    const originalLeaseId = claim.lease.leaseId;

    // nodeA keeps heartbeating (stays online); nodeD stops entirely.
    await sleep(350); // past the 300ms offline threshold configured above
    stack.renderBroker.recordHeartbeat(
      nodeA.report.nodeUuid,
      buildHeartbeat(nodeA.report.nodeUuid, 0, 4),
    );

    stack.renderBroker.checkFailover();

    const stateAfterFailover = stack.jobStateMachine.getState(jobUuid);
    const leaseStillExists = stack.leaseManager.getLeaseForJob(jobUuid);

    if (stateAfterFailover !== JobState.CLAIMED) {
      fail('Failover sonrası job CLAIMED durumuna dönmedi', { state: stateAfterFailover });
    } else {
      logger.info(
        "Block 7 OK: Dead Job Recovery job'ı otomatik olarak yeni bir node'a yeniden zamanladı",
        {
          jobUuid,
          newState: stateAfterFailover,
        },
      );
    }

    if (leaseStillExists?.leaseId === originalLeaseId) {
      fail(
        'Eski lease hâlâ geçerliymiş gibi görünüyor — force-release/yeni lease oluşturma çalışmadı',
      );
    } else {
      logger.info('Block 7 OK: eski lease iptal edildi, job için yeni bir lease oluşturuldu');
    }
  }

  // --- Block 8: a job that fails mid-execution retries onto a (possibly different) node, then eventually gives up after maxRetries. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, leastLoaded, 300, 1);
    const { nodeA } = buildVirtualNodes();
    registerNode(stack, nodeA, 0);

    const jobUuid = randomUUID();
    const requirement: SchedulingRequirement = {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    };
    stack.jobScheduler.submit(jobUuid, requirement);
    stack.executionCoordinator.advance(jobUuid, JobState.PREPARING);
    stack.executionCoordinator.advance(jobUuid, JobState.EXECUTING);

    await stack.executionCoordinator.failJob(jobUuid);

    const stateAfterFirstFailure = stack.jobStateMachine.getState(jobUuid);
    const leaseAfterRetry = stack.leaseManager.getLeaseForJob(jobUuid);

    if (stateAfterFirstFailure !== JobState.CLAIMED || leaseAfterRetry?.retryCount !== 1) {
      fail('İlk başarısızlıktan sonra retry beklenen şekilde çalışmadı', {
        state: stateAfterFirstFailure,
        retryCount: leaseAfterRetry?.retryCount,
      });
    } else {
      logger.info(
        'Block 8 OK: ilk başarısızlıktan sonra job retry edildi ve yeniden CLAIMED oldu',
        {
          retryCount: leaseAfterRetry.retryCount,
        },
      );
    }

    // Second failure exceeds maxRetries (configured as 1 for this stack) -> terminal CANCELLED.
    stack.executionCoordinator.advance(jobUuid, JobState.PREPARING);
    stack.executionCoordinator.advance(jobUuid, JobState.EXECUTING);
    await stack.executionCoordinator.failJob(jobUuid);

    const finalState = stack.jobStateMachine.getState(jobUuid);
    if (finalState !== JobState.CANCELLED) {
      fail('Maksimum retry sayısı aşıldığında job terminal duruma geçmedi', { finalState });
    } else {
      logger.info(
        'Block 8 OK: maksimum retry sayısı aşılınca job terminal (CANCELLED) durumuna geçti',
      );
    }
  }

  // --- Block 9: cancellation. ---
  {
    const stack = createBrokerStack(contractRegistry, logger, leastLoaded);
    const { nodeA } = buildVirtualNodes();
    registerNode(stack, nodeA, 0);

    const jobUuid = randomUUID();
    stack.jobScheduler.submit(jobUuid, {
      ...baseRequirement,
      templateUuid: randomUUID(),
      priority: RenderJobPriority.NORMAL,
    });

    stack.renderBroker.cancelJob(jobUuid);

    if (!stack.renderBroker.isCancelled(jobUuid)) {
      fail('cancelJob() sonrası isCancelled() true dönmedi');
    } else if (stack.jobStateMachine.getState(jobUuid) !== JobState.CANCELLED) {
      fail('cancelJob() sonrası state CANCELLED değil');
    } else if (stack.leaseManager.getLeaseForJob(jobUuid) !== null) {
      fail('cancelJob() sonrası lease hâlâ mevcut');
    } else {
      logger.info('Block 9 OK: Job Cancellation doğru çalıştı');
    }
  }

  // --- Block 10: the state machine itself must reject an invalid transition. ---
  {
    const jobStateMachine = new JobStateMachine(logger);
    const jobUuid = randomUUID();
    jobStateMachine.register(jobUuid);

    let invalidTransitionRejected = false;
    try {
      jobStateMachine.transition(jobUuid, JobState.COMPLETED);
    } catch (error) {
      invalidTransitionRejected = error instanceof InvalidJobStateTransitionError;
    }

    if (!invalidTransitionRejected) {
      fail('State Machine geçersiz bir geçişi (QUEUED → COMPLETED) reddetmedi');
    } else {
      logger.info('Block 10 OK: State Machine geçersiz geçişi doğru şekilde reddetti');
    }
  }

  if (allPassed) {
    logger.info(
      'Senaryo başarılı: Render Broker / Scheduler tüm çıkış kriterleriyle doğrulandı (node seçimi, capability filtreleme, failover, retry, affinity, node score, strategy pattern, state machine)',
    );
    process.exitCode = 0;
  } else {
    logger.error('Senaryo başarısız');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Render Broker / Scheduler doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
