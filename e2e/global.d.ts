/** Отладочные данные, которые клиент кладёт в window для e2e-тестов. */
interface Window {
  __dubparty?: {
    lastTake?: {
      blob: Blob;
      mimeType: string;
      backend: 'media' | 'wav';
      offsetMs: number;
      buffer: AudioBuffer | null;
      driftCorrections: number;
    } | null;
    sync?: { driftMs: number; entryId: string | null; playing: boolean };
  };
}
