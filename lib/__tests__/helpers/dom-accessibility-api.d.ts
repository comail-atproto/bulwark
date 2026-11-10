// dom-accessibility-api ships types, but its package.json "exports" hides
// them from this project's module resolution. The one function the tests use:
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(root: Element, options?: Record<string, unknown>): string;
}
