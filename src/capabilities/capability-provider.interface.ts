/**
 * One slice of a node's Capability Report. Each component of the
 * platform (Adobe, hardware, fonts, plugins, ...) owns its own provider —
 * adding support for a new engine (DaVinci, Blender, ...) later means
 * adding a new provider, never touching the existing ones (Open/Closed).
 */
export interface ICapabilityProvider<T> {
  readonly name: string;
  collect(): Promise<T>;
}
