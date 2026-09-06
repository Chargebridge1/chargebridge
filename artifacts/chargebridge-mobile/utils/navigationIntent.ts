type Intent = { lat: number; lng: number; label: string } | null;

let _intent: Intent = null;

export function setNavigationIntent(dest: Intent): void {
  _intent = dest;
}

export function consumeNavigationIntent(): Intent {
  const val = _intent;
  _intent = null;
  return val;
}
