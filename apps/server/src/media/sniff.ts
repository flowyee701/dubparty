import { open } from 'node:fs/promises';

export type SniffedKind = 'webm' | 'mp4' | 'wav' | 'ogg' | 'zip' | 'mp3' | 'unknown';

/**
 * Определяет тип файла по сигнатуре (первым байтам), а не по расширению или
 * заголовку Content-Type, которые задаёт клиент.
 */
export function sniffBuffer(head: Buffer): SniffedKind {
  const ascii = (start: number, end: number) => head.subarray(start, end).toString('latin1');
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'webm'; // EBML: WebM / Matroska
  if (head.length >= 12 && ascii(4, 8) === 'ftyp') return 'mp4'; // ISO BMFF: mp4, m4a, mov
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (head.length >= 4 && ascii(0, 4) === 'OggS') return 'ogg';
  if (head.length >= 4 && head.readUInt32BE(0) === 0x504b0304) return 'zip';
  if (
    head.length >= 3 &&
    (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0))
  ) {
    return 'mp3';
  }
  return 'unknown';
}

export async function sniffFile(file: string): Promise<SniffedKind> {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    return sniffBuffer(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
