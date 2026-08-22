export interface ParsedContractVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseContractVersion(version: string): ParsedContractVersion {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  };
}

/**
 * Two Contract payloads are compatible if their major version matches —
 * per semver convention, only a major bump represents a breaking change.
 * This is what lets Render Node keep working with a Manifest v1 while a
 * v2 rolls out elsewhere, without re-scanning every existing template.
 */
export function isContractVersionCompatible(
  actualVersion: string,
  expectedVersion: string,
): boolean {
  return parseContractVersion(actualVersion).major === parseContractVersion(expectedVersion).major;
}
