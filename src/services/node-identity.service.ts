/**
 * Holds the node_uuid Laravel assigns after register(). This is the single
 * source of truth for "who am I" — ApiClient reads it to tag every
 * outgoing request, and FileLogger reads it to tag every log line, instead
 * of either resending full node info or falling back to hostname.
 */
export class NodeIdentityService {
  private nodeUuid: string | null = null;

  setNodeUuid(nodeUuid: string): void {
    this.nodeUuid = nodeUuid;
  }

  getNodeUuid(): string | null {
    return this.nodeUuid;
  }

  isRegistered(): boolean {
    return this.nodeUuid !== null;
  }
}
