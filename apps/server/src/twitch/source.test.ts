import { describe, expect, it } from 'vitest';
import { parseVoteCommand } from './source';

describe('parseVoteCommand', () => {
  it.each([
    ['!1', 1],
    ['!2 ', 2],
    ['  !3 лучший!', 3],
    ['!12', 12],
  ])('«%s» → %i', (message, expected) => {
    expect(parseVoteCommand(message)).toBe(expected);
  });

  it.each(['1', '!', '!0', '!abc', '!1a', 'привет !1', '!123', '! 1', '!-1'])(
    'не считает командой «%s»',
    (message) => {
      expect(parseVoteCommand(message)).toBeNull();
    },
  );
});
