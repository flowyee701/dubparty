import { describe, expect, it } from 'vitest';
import { clientEventSchemas } from './events';
import {
  nicknameSchema,
  packManifestSchema,
  packPathSchema,
  roomCodeSchema,
  settingsSchema,
  takeUploadQuerySchema,
  twitchConnectSchema,
} from './schemas';

describe('nicknameSchema', () => {
  it('чистит пробелы и управляющие символы', () => {
    expect(nicknameSchema.parse('  Вася​   Пупкин \n')).toBe('Вася Пупкин');
  });
  it('отклоняет пустое и слишком длинное', () => {
    expect(nicknameSchema.safeParse('   ').success).toBe(false);
    expect(nicknameSchema.safeParse('x'.repeat(17)).success).toBe(false);
  });
});

describe('roomCodeSchema', () => {
  it('приводит к верхнему регистру', () => {
    expect(roomCodeSchema.parse(' abcd ')).toBe('ABCD');
  });
  it('отклоняет неверную длину и запрещённые буквы', () => {
    expect(roomCodeSchema.safeParse('ABC').success).toBe(false);
    expect(roomCodeSchema.safeParse('ABIO').success).toBe(false);
    expect(roomCodeSchema.safeParse('AB1D').success).toBe(false);
  });
});

describe('settingsSchema', () => {
  const base = {
    mode: 'parallel',
    rounds: 3,
    recordSeconds: 60,
    packId: 'demo',
    effectsEnabled: true,
    hideCode: false,
  };
  it('принимает корректные настройки', () => {
    expect(settingsSchema.safeParse(base).success).toBe(true);
  });
  it.each([
    { rounds: 0 },
    { rounds: 11 },
    { recordSeconds: 29 },
    { recordSeconds: 181 },
    { mode: 'chaos' },
    { packId: '../etc' },
  ])('отклоняет %o', (patch) => {
    expect(settingsSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe('packPathSchema', () => {
  it.each(['clips/a/video.mp4', 'video.mp4', 'a-b_c/d.e.mp4'])('принимает %s', (p) => {
    expect(packPathSchema.safeParse(p).success).toBe(true);
  });
  it.each(['../x.mp4', '/abs.mp4', 'a/../b.mp4', 'a\\b.mp4', 'a//b.mp4', './a.mp4', ''])(
    'отклоняет %s',
    (p) => {
      expect(packPathSchema.safeParse(p).success).toBe(false);
    },
  );
});

describe('packManifestSchema', () => {
  const clip = {
    id: 'c1',
    title: 'Клип',
    video: 'clips/c1/video.mp4',
    durationMs: 10_000,
    characters: [{ id: 'a', name: 'А', color: '#ff0000' }],
    lines: [{ id: 'l1', characterId: 'a', startMs: 0, endMs: 1000, text: 'Привет' }],
  };
  const pack = { formatVersion: 1, id: 'p', title: 'Пак', clips: [clip] };

  it('принимает минимальный пак и подставляет значения по умолчанию', () => {
    const parsed = packManifestSchema.parse(pack);
    expect(parsed.language).toBe('ru');
    expect(parsed.description).toBe('');
  });

  it('отклоняет реплику с неизвестным персонажем', () => {
    const bad = { ...pack, clips: [{ ...clip, lines: [{ ...clip.lines[0], characterId: 'zz' }] }] };
    expect(packManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('отклоняет реплику, где конец раньше начала, и реплику за пределами клипа', () => {
    const swap = { ...clip, lines: [{ ...clip.lines[0], startMs: 2000, endMs: 1000 }] };
    const late = { ...clip, lines: [{ ...clip.lines[0], startMs: 9000, endMs: 20_000 }] };
    expect(packManifestSchema.safeParse({ ...pack, clips: [swap] }).success).toBe(false);
    expect(packManifestSchema.safeParse({ ...pack, clips: [late] }).success).toBe(false);
  });

  it('отклоняет дубли идентификаторов и слишком длинный клип', () => {
    expect(packManifestSchema.safeParse({ ...pack, clips: [clip, clip] }).success).toBe(false);
    expect(
      packManifestSchema.safeParse({ ...pack, clips: [{ ...clip, durationMs: 61_000 }] }).success,
    ).toBe(false);
  });

  it('отклоняет неизвестную версию формата', () => {
    expect(packManifestSchema.safeParse({ ...pack, formatVersion: 2 }).success).toBe(false);
  });
});

describe('события', () => {
  it('vote:cast требует известную категорию', () => {
    const s = clientEventSchemas['vote:cast'];
    expect(s.safeParse({ category: 'funniest', targetId: 'abc' }).success).toBe(true);
    expect(s.safeParse({ category: 'best', targetId: 'abc' }).success).toBe(false);
  });

  it('playback:control различает действия', () => {
    const s = clientEventSchemas['playback:control'];
    expect(s.safeParse({ action: 'seek', positionMs: 1500 }).success).toBe(true);
    expect(s.safeParse({ action: 'seek' }).success).toBe(false);
    expect(s.safeParse({ action: 'explode' }).success).toBe(false);
  });

  it('twitch:connect нормализует имя канала', () => {
    expect(twitchConnectSchema.parse({ channel: 'https://twitch.tv/Some_Channel/' }).channel).toBe(
      'some_channel',
    );
    expect(twitchConnectSchema.parse({ channel: '#MyChan' }).channel).toBe('mychan');
    expect(twitchConnectSchema.safeParse({ channel: 'a b' }).success).toBe(false);
  });

  it('параметры загрузки дубля приводятся из строк', () => {
    expect(takeUploadQuerySchema.parse({ round: '2', offsetMs: '-37.5' })).toEqual({
      round: 2,
      offsetMs: -37.5,
      effect: 'none',
    });
    expect(takeUploadQuerySchema.safeParse({ round: '0', offsetMs: '99999' }).success).toBe(false);
  });
});
