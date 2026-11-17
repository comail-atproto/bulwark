/**
 * Motion that scripts start themselves (smooth scrolling, animated
 * transitions set from JS) has to follow Reduce motion, which CSS alone can't
 * reach.
 *
 * Settings > Accessibility > Reduce motion writes data-motion on <html>
 * ("reduce" for On, "full" for Off, nothing for System; see
 * applyAccessibilityTo()), so the effective value is the attribute when it is
 * there and the operating system's preference otherwise.
 */
export function prefersReducedMotion(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): boolean {
  const choice = root?.getAttribute('data-motion');
  if (choice === 'reduce') return true;
  if (choice === 'full') return false;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `behavior` for scrollIntoView/scrollTo: smooth unless motion is reduced. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
