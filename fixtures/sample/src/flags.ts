export const DEFAULT_FLAGS: Record<string, boolean> = {
  newCheckout: false,
};

export function setFlag(name: string, value: boolean): void {
  DEFAULT_FLAGS[name] = value;
}

export function getFlag(name: string): boolean {
  return DEFAULT_FLAGS[name] ?? false;
}
