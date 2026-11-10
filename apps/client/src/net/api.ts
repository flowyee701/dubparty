import type { ErrorCode, PackDetail, PackSummary, PublicConfig } from '@dubparty/shared';
import { ApiErr } from './socket';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiErr('NETWORK');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: ErrorCode; message?: string };
    } | null;
    throw new ApiErr(body?.error?.code ?? 'INTERNAL', body?.error?.message);
  }
  return (await res.json()) as T;
}

export function json(body: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: JSON.stringify(body),
  };
}

export const fetchConfig = () => api<PublicConfig>('/api/config');
export const fetchPacks = () => api<{ packs: PackSummary[] }>('/api/packs').then((r) => r.packs);
export const fetchPack = (id: string) =>
  api<{ pack: PackDetail }>(`/api/packs/${encodeURIComponent(id)}`).then((r) => r.pack);

/** Скачивает файл с авторизацией и сохраняет его под именем из Content-Disposition. */
export async function downloadFile(
  path: string,
  token: string,
  fallbackName: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiErr('NETWORK');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: ErrorCode } } | null;
    throw new ApiErr(body?.error?.code ?? 'INTERNAL');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : fallbackName;
  saveBlob(await res.blob(), name);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
