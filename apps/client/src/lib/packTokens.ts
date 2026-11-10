/** Токены владельца паков: аккаунтов нет, поэтому пак редактирует тот, у кого токен. */
const KEY = 'dubparty:packTokens';

function readAll(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function packToken(packId: string): string | null {
  return readAll()[packId] ?? null;
}

export function savePackToken(packId: string, token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [packId]: token }));
  } catch {
    // Без localStorage редактирование доступно только до закрытия вкладки.
  }
}

export function forgetPackToken(packId: string): void {
  const all = readAll();
  delete all[packId];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // см. выше
  }
}
