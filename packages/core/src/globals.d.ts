// Available in every runtime the core targets (modern browsers, Node 18+), but not
// part of the ES lib typings when DOM types are left out on purpose.
declare function structuredClone<T>(value: T, options?: { transfer?: unknown[] }): T
