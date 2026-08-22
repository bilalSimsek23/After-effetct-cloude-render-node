/**
 * Shape of config.json. All Render Node settings are read from this file —
 * no .env is used in this phase.
 */
export interface RenderNodeConfig {
  server: string;
  /**
   * This node's identity + shared secret, provisioned once by an admin
   * running `php artisan cloud-render:register-render-node` on Laravel and
   * pasted in here — there is no self-service registration endpoint.
   * `apiSecret` is the HMAC key used to sign every outbound request (see
   * AuthService) and to verify Laravel's push notifications.
   */
  nodeUuid: string;
  apiSecret: string;
  nodeName: string;
  /** Seconds between heartbeat pings. */
  heartbeatInterval: number;
  maxConcurrentJobs: number;
  /** Agent/protocol version, set explicitly per node — independent of package.json's version. */
  agentVersion: string;
  /** The render engine this node runs (e.g. "after-effects"). */
  engine: string;
  /** Engines this node is able to claim jobs for. */
  supportedEngines: string[];
  /**
   * Render profile overrides, keyed by profile code (e.g. "preview",
   * "master", or any future custom code) — Faz 8B. Optional: when a code
   * is absent here, RenderProfileRegistry falls back to its own built-in
   * default for that code (existing config.json files keep working
   * unchanged). New deployments should define real profiles here instead
   * of relying on the fallback.
   */
  renderProfiles?: Record<string, RenderProfileConfigEntry>;
  /**
   * Laravel assigns jobs by pushing an HTTP POST to this node's own
   * callback_url (see RenderNodePushClient.php) - PushServer listens
   * locally on `port`, and CloudflareTunnelService exposes that local port
   * at a stable public hostname via a *named* Cloudflare Tunnel (works from
   * behind NAT/home routers, no port-forwarding, no static IP - the exact
   * requirement for "installable on any Mac/Windows machine with internet
   * access"). `tunnelToken` comes from `cloudflared tunnel token <name>`,
   * run once per node during setup; the resulting hostname is what an admin
   * passes as --callback-url when registering this node with Laravel.
   */
  pushServer: {
    port: number;
    tunnelToken: string;
  };
}

/**
 * One render profile's config-driven definition. `rendererSettings` is a
 * deliberately generic, open bag — today only Adobe's Output Module
 * template name is read from it (see
 * `ADOBE_OUTPUT_MODULE_TEMPLATE_KEY` in render-profile.types.ts); future
 * renderer settings (codec, bitrate, resolution, frame rate, audio, or an
 * entirely different renderer's own options) can be added as new keys
 * without a schema redesign here.
 */
export interface RenderProfileConfigEntry {
  name: string;
  watermarkEnabled: boolean;
  isActive: boolean;
  rendererSettings: Record<string, unknown>;
}
