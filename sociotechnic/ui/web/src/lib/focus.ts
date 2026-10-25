export function currentOpener(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : document.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]');
}
export function returnFocus(opener: HTMLElement | null | undefined) {
  if (opener?.isConnected) opener.focus();
  else document.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')?.focus();
}
