export interface HealthCheckResult {
  healthy: boolean;
  checks: Record<string, boolean>;
}
