export function readStringArray(key: string): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeStringArray(key: string, value: Iterable<string>): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(key, JSON.stringify(Array.from(value)));
}

export function readSet(key: string): Set<string> {
  return new Set(readStringArray(key));
}

export function writeSet(key: string, value: Set<string>): void {
  writeStringArray(key, value);
}
