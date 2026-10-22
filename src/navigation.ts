let guard: ((target?: string) => boolean) | undefined;
export function registerNavigationGuard(next: (target?: string) => boolean) {
  guard = next;
  return () => {
    if (guard === next) guard = undefined;
  };
}
export function canNavigate(target?: string) {
  return guard?.(target) ?? true;
}
