import { describe, expect, it } from 'vitest';
import { sniffBuffer } from '../media/sniff';
import { attachment, isPublicMediaKey, parseRange } from './util';

describe('parseRange', () => {
  it('нет заголовка', () => expect(parseRange(undefined, 100)).toBeNull());
  it('полный диапазон', () => expect(parseRange('bytes=0-49', 100)).toEqual({ start: 0, end: 49 }));
  it('открытый конец', () => expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 }));
  it('суффикс', () => expect(parseRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 }));
  it('конец за пределами файла обрезается', () =>
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 }));
  it.each(['bytes=100-', 'bytes=50-10', 'bytes=-', 'bytes=-0', 'items=0-1', 'bytes=0-1,5-6'])(
    'отклоняет %s',
    (h) => expect(parseRange(h, 100)).toBe('invalid'),
  );
});

describe('isPublicMediaKey', () => {
  it.each([
    'packs/demo/robots/video-aB3_.mp4',
    'packs/demo/robots/source-x.mp4',
    'packs/demo/robots/poster-x.jpg',
    'rooms/ABCD/r0/entries/Qw-12_x.mp4',
  ])('разрешает %s', (k) => expect(isPublicMediaKey(k)).toBe(true));

  it.each([
    'rooms/ABCD/r0/takes/p1-1.webm',
    'rooms/ABCD/r0/takes/p1-1.voice.wav',
    'rooms/ABCD/r0/entries/../takes/x.mp4',
    'packs/demo/pack.json',
    '../data/dubparty.sqlite',
    'rooms/abcd/r0/entries/x.mp4',
  ])('запрещает %s', (k) => expect(isPublicMediaKey(k)).toBe(false));
});

describe('attachment', () => {
  it('кодирует не-ASCII и убирает опасные символы', () => {
    const header = attachment('Вася/"кот".mp4');
    expect(header).toContain('filename="__________.mp4"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain('/');
  });
});

describe('sniffBuffer', () => {
  const pad = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
  it('распознаёт форматы по сигнатуре', () => {
    expect(sniffBuffer(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
    expect(sniffBuffer(Buffer.from('\0\0\0\x20ftypisom\0\0\0\0', 'latin1'))).toBe('mp4');
    expect(sniffBuffer(Buffer.from('RIFF\x24\0\0\0WAVEfmt ', 'latin1'))).toBe('wav');
    expect(sniffBuffer(Buffer.from('OggS\0\0\0\0\0\0\0\0', 'latin1'))).toBe('ogg');
    expect(sniffBuffer(pad([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(sniffBuffer(Buffer.from('ID3\x04\0\0\0\0\0\0', 'latin1'))).toBe('mp3');
  });
  it('не доверяет произвольным данным', () => {
    expect(sniffBuffer(Buffer.from('<html><script>alert(1)</script>'))).toBe('unknown');
    expect(sniffBuffer(Buffer.from('MZ\x90\0\x03\0\0\0', 'latin1'))).toBe('unknown');
    expect(sniffBuffer(Buffer.alloc(0))).toBe('unknown');
  });
});
