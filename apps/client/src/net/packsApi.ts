import type {
  ClipMarkup,
  ClipTrim,
  EditorClip,
  ErrorCode,
  PackDetail,
  PackMeta,
} from '@dubparty/shared';
import { api, json } from './api';
import { ApiErr } from './socket';

const auth = (token: string) => ({ 'X-Pack-Token': token });
const base = (packId: string) => `/api/packs/${encodeURIComponent(packId)}`;

export const createPack = (meta: Partial<PackMeta>) =>
  api<{ pack: PackDetail; ownerToken: string }>('/api/packs', json(meta, { method: 'POST' }));

export const updatePack = (packId: string, token: string, meta: Partial<PackMeta>) =>
  api<{ pack: PackDetail }>(
    base(packId),
    json(meta, { method: 'PATCH', headers: auth(token) }),
  ).then((r) => r.pack);

export const deletePack = (packId: string, token: string) =>
  api<{ ok: true }>(base(packId), { method: 'DELETE', headers: auth(token) });

export const saveMarkup = (packId: string, clipId: string, token: string, markup: ClipMarkup) =>
  api<{ clip: EditorClip }>(
    `${base(packId)}/clips/${clipId}/markup`,
    json(markup, { method: 'PUT', headers: auth(token) }),
  ).then((r) => r.clip);

export const trimClip = (packId: string, clipId: string, token: string, trim: ClipTrim) =>
  api<{ clip: EditorClip }>(
    `${base(packId)}/clips/${clipId}/trim`,
    json(trim, { method: 'PUT', headers: auth(token) }),
  ).then((r) => r.clip);

export const moveClip = (packId: string, clipId: string, token: string, direction: 'up' | 'down') =>
  api<{ pack: PackDetail }>(
    `${base(packId)}/clips/${clipId}/move`,
    json({ direction }, { method: 'POST', headers: auth(token) }),
  ).then((r) => r.pack);

export const deleteClip = (packId: string, clipId: string, token: string) =>
  api<{ ok: true }>(`${base(packId)}/clips/${clipId}`, { method: 'DELETE', headers: auth(token) });

/** Загрузка файла «как есть» с отслеживанием прогресса (fetch его не сообщает). */
function upload<T>(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiErr('NETWORK'));
    xhr.onload = () => {
      const body = xhr.response as { error?: { code?: ErrorCode; message?: string } } | null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiErr(body?.error?.code ?? 'INTERNAL', body?.error?.message));
    };
    xhr.send(file);
  });
}

export const addClip = (
  packId: string,
  token: string,
  file: File,
  options: { title: string; keepAudio: boolean },
  onProgress?: (fraction: number) => void,
) =>
  upload<{ clip: EditorClip }>(
    `${base(packId)}/clips?${new URLSearchParams({
      title: options.title,
      keepAudio: options.keepAudio ? '1' : '0',
    }).toString()}`,
    file,
    { ...auth(token), 'Content-Type': file.type || 'video/mp4' },
    onProgress,
  ).then((r) => r.clip);

export const importPack = (file: File, onProgress?: (fraction: number) => void) =>
  upload<{ pack: PackDetail; ownerToken: string }>(
    '/api/packs/import',
    file,
    { 'Content-Type': 'application/zip' },
    onProgress,
  );

export const exportUrl = (packId: string) => `${base(packId)}/export`;

/** Длительность видеофайла по метаданным — чтобы отсеять неподходящие ещё до загрузки. */
export function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? video.duration * 1000 : null);
    video.onerror = () => done(null);
    window.setTimeout(() => done(null), 8000);
    video.src = url;
  });
}
