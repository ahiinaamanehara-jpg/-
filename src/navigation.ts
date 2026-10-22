let guard: (() => boolean) | undefined;
export function registerNavigationGuard(next: () => boolean) {
  guard = next;
  return () => {
    if (guard === next) guard = undefined;
  };
}
export function canNavigate() {
  return guard?.() ?? true;
}
