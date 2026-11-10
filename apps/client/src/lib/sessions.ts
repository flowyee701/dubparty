/** Токены сессий по коду комнаты: с ними игрок возвращается после обновления страницы. */
const KEY = 'dubparty:sessions';
const MAX_AGE_MS = 24 * 3_600_000;

interface Saved {
  token: string;
  at: number;
}

function readAll(): Record<string, Saved> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Saved>;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([, v]) => v && typeof v.token === 'string' && now - v.at < MAX_AGE_MS,
      ),
    );
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Saved>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Приватный режим или переполнение — живём без сохранения сессии.
  }
}

export function loadSession(code: string): string | null {
  return readAll()[code]?.token ?? null;
}

export function saveSession(code: string, token: string): void {
  writeAll({ ...readAll(), [code]: { token, at: Date.now() } });
}

export function clearSession(code: string): void {
  const all = readAll();
  delete all[code];
  writeAll(all);
}
