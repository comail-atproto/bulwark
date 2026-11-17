/** Remove trailing slashes in linear time, optionally keeping one. */
export function trimTrailingSlashes(value: string, keepOne = false): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end + (keepOne && end < value.length ? 1 : 0));
}

/** Remove trailing DNS root dots without repeatedly scanning a malformed host. */
export function trimTrailingDots(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 46) end--;
  return value.slice(0, end);
}
