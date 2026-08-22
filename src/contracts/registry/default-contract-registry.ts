import { ContractSchemaName } from '../contract-envelope.js';
import { ContractRegistry } from './contract-registry.js';
import { ContractName } from './contract-name.js';
import { ContractStatus } from './contract-registry.types.js';

import {
  MANIFEST_CONTRACT_VERSION,
  ManifestSerializer,
  ManifestValidator,
} from '../manifest.contract.js';
import {
  TEMPLATE_VARIABLE_CONTRACT_VERSION,
  TemplateVariableSerializer,
  TemplateVariableValidator,
} from '../template-variable.contract.js';
import {
  SCANNER_RESULT_CONTRACT_VERSION,
  ScannerResultSerializer,
  ScannerResultValidator,
} from '../scanner-result.contract.js';
import {
  DEPENDENCY_CONTRACT_VERSION,
  DEPENDENCY_CONTRACT_SUPPORTED_VERSIONS,
  DependencySerializer,
  DependencyValidator,
} from '../dependency.contract.js';
import { ASSET_CONTRACT_VERSION, AssetSerializer, AssetValidator } from '../asset.contract.js';
import {
  RENDER_PROFILE_CONTRACT_VERSION,
  RenderProfileSerializer,
  RenderProfileValidator,
} from '../render-profile.contract.js';
import {
  RENDER_JOB_CONTRACT_VERSION,
  RenderJobSerializer,
  RenderJobValidator,
} from '../render-job.contract.js';
import {
  RENDER_RESULT_CONTRACT_VERSION,
  RenderResultSerializer,
  RenderResultValidator,
} from '../render-result.contract.js';
import {
  RENDER_PROGRESS_CONTRACT_VERSION,
  RenderProgressSerializer,
  RenderProgressValidator,
} from '../render-progress.contract.js';
import {
  RENDER_NODE_CONTRACT_VERSION,
  RenderNodeSerializer,
  RenderNodeValidator,
} from '../render-node.contract.js';
import {
  SYSTEM_STATUS_CONTRACT_VERSION,
  SystemStatusSerializer,
  SystemStatusValidator,
} from '../system-status.contract.js';
import {
  ADOBE_ENVIRONMENT_CONTRACT_VERSION,
  AdobeEnvironmentSerializer,
  AdobeEnvironmentValidator,
} from '../adobe-environment.contract.js';
import {
  WORKSPACE_CONTRACT_VERSION,
  WORKSPACE_CONTRACT_SUPPORTED_VERSIONS,
  WorkspaceSerializer,
  WorkspaceValidator,
} from '../workspace.contract.js';
import {
  JOB_CLAIM_CONTRACT_VERSION,
  JobClaimSerializer,
  JobClaimValidator,
} from '../job-claim.contract.js';
import {
  JOB_LEASE_CONTRACT_VERSION,
  JobLeaseSerializer,
  JobLeaseValidator,
} from '../job-lease.contract.js';
import {
  JOB_HEARTBEAT_CONTRACT_VERSION,
  JobHeartbeatSerializer,
  JobHeartbeatValidator,
} from '../job-heartbeat.contract.js';
import {
  CAPABILITY_REPORT_CONTRACT_VERSION,
  CapabilityReportSerializer,
  CapabilityReportValidator,
} from '../capability-report.contract.js';

/**
 * The one place every Contract is wired into the Registry. Adding a new
 * Contract in the future means adding exactly one register() call here —
 * nothing else in the platform needs to change (Open/Closed).
 */
export function createDefaultContractRegistry(): ContractRegistry {
  const registry = new ContractRegistry();

  registry.register({
    name: ContractName.MANIFEST,
    schemaName: ContractSchemaName.MANIFEST,
    currentVersion: MANIFEST_CONTRACT_VERSION,
    supportedVersions: [MANIFEST_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new ManifestSerializer(),
    validator: new ManifestValidator(),
  });

  registry.register({
    name: ContractName.TEMPLATE_VARIABLE,
    schemaName: ContractSchemaName.TEMPLATE_VARIABLE,
    currentVersion: TEMPLATE_VARIABLE_CONTRACT_VERSION,
    supportedVersions: [TEMPLATE_VARIABLE_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new TemplateVariableSerializer(),
    validator: new TemplateVariableValidator(),
  });

  registry.register({
    name: ContractName.SCANNER_RESULT,
    schemaName: ContractSchemaName.SCANNER_RESULT,
    currentVersion: SCANNER_RESULT_CONTRACT_VERSION,
    supportedVersions: [SCANNER_RESULT_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new ScannerResultSerializer(),
    validator: new ScannerResultValidator(),
  });

  registry.register({
    name: ContractName.DEPENDENCY,
    schemaName: ContractSchemaName.DEPENDENCY,
    currentVersion: DEPENDENCY_CONTRACT_VERSION,
    supportedVersions: DEPENDENCY_CONTRACT_SUPPORTED_VERSIONS,
    status: ContractStatus.ACTIVE,
    serializer: new DependencySerializer(),
    validator: new DependencyValidator(),
  });

  registry.register({
    name: ContractName.ASSET,
    schemaName: ContractSchemaName.ASSET,
    currentVersion: ASSET_CONTRACT_VERSION,
    supportedVersions: [ASSET_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new AssetSerializer(),
    validator: new AssetValidator(),
  });

  registry.register({
    name: ContractName.RENDER_PROFILE,
    schemaName: ContractSchemaName.RENDER_PROFILE,
    currentVersion: RENDER_PROFILE_CONTRACT_VERSION,
    supportedVersions: [RENDER_PROFILE_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new RenderProfileSerializer(),
    validator: new RenderProfileValidator(),
  });

  registry.register({
    name: ContractName.RENDER_JOB,
    schemaName: ContractSchemaName.RENDER_JOB,
    currentVersion: RENDER_JOB_CONTRACT_VERSION,
    supportedVersions: [RENDER_JOB_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new RenderJobSerializer(),
    validator: new RenderJobValidator(),
  });

  registry.register({
    name: ContractName.RENDER_RESULT,
    schemaName: ContractSchemaName.RENDER_RESULT,
    currentVersion: RENDER_RESULT_CONTRACT_VERSION,
    supportedVersions: [RENDER_RESULT_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new RenderResultSerializer(),
    validator: new RenderResultValidator(),
  });

  registry.register({
    name: ContractName.RENDER_PROGRESS,
    schemaName: ContractSchemaName.RENDER_PROGRESS,
    currentVersion: RENDER_PROGRESS_CONTRACT_VERSION,
    supportedVersions: [RENDER_PROGRESS_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new RenderProgressSerializer(),
    validator: new RenderProgressValidator(),
  });

  registry.register({
    name: ContractName.RENDER_NODE,
    schemaName: ContractSchemaName.RENDER_NODE,
    currentVersion: RENDER_NODE_CONTRACT_VERSION,
    supportedVersions: [RENDER_NODE_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new RenderNodeSerializer(),
    validator: new RenderNodeValidator(),
  });

  registry.register({
    name: ContractName.SYSTEM_STATUS,
    schemaName: ContractSchemaName.SYSTEM_STATUS,
    currentVersion: SYSTEM_STATUS_CONTRACT_VERSION,
    supportedVersions: [SYSTEM_STATUS_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new SystemStatusSerializer(),
    validator: new SystemStatusValidator(),
  });

  registry.register({
    name: ContractName.ADOBE_ENVIRONMENT,
    schemaName: ContractSchemaName.ADOBE_ENVIRONMENT,
    currentVersion: ADOBE_ENVIRONMENT_CONTRACT_VERSION,
    supportedVersions: [ADOBE_ENVIRONMENT_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new AdobeEnvironmentSerializer(),
    validator: new AdobeEnvironmentValidator(),
  });

  registry.register({
    name: ContractName.WORKSPACE,
    schemaName: ContractSchemaName.WORKSPACE,
    currentVersion: WORKSPACE_CONTRACT_VERSION,
    supportedVersions: WORKSPACE_CONTRACT_SUPPORTED_VERSIONS,
    status: ContractStatus.ACTIVE,
    serializer: new WorkspaceSerializer(),
    validator: new WorkspaceValidator(),
  });

  registry.register({
    name: ContractName.JOB_CLAIM,
    schemaName: ContractSchemaName.JOB_CLAIM,
    currentVersion: JOB_CLAIM_CONTRACT_VERSION,
    supportedVersions: [JOB_CLAIM_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new JobClaimSerializer(),
    validator: new JobClaimValidator(),
  });

  registry.register({
    name: ContractName.JOB_LEASE,
    schemaName: ContractSchemaName.JOB_LEASE,
    currentVersion: JOB_LEASE_CONTRACT_VERSION,
    supportedVersions: [JOB_LEASE_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new JobLeaseSerializer(),
    validator: new JobLeaseValidator(),
  });

  registry.register({
    name: ContractName.JOB_HEARTBEAT,
    schemaName: ContractSchemaName.JOB_HEARTBEAT,
    currentVersion: JOB_HEARTBEAT_CONTRACT_VERSION,
    supportedVersions: [JOB_HEARTBEAT_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new JobHeartbeatSerializer(),
    validator: new JobHeartbeatValidator(),
  });

  registry.register({
    name: ContractName.CAPABILITY_REPORT,
    schemaName: ContractSchemaName.CAPABILITY_REPORT,
    currentVersion: CAPABILITY_REPORT_CONTRACT_VERSION,
    supportedVersions: [CAPABILITY_REPORT_CONTRACT_VERSION],
    status: ContractStatus.ACTIVE,
    serializer: new CapabilityReportSerializer(),
    validator: new CapabilityReportValidator(),
  });

  return registry;
}
