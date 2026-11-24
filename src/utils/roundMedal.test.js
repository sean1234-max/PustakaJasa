import { describe, it, expect } from 'vitest';
import { isRoundMedalCode } from './roundMedal';

describe('isRoundMedalCode — every medal is made from E CUT 0 (Sean, 2026-11-25)', () => {
  it('takes every hanging medal (SEAN.jsx HM… / HANGING MEDAL rule)', () => {
    ['HM-M-0031 / GOLD', 'HM-M-6025', 'hm 7026', 'HM-5026 / BRONZE', 'PINGAT HANGING MEDAL'].forEach((c) => expect(isRoundMedalCode(c)).toBe(true));
  });

  it('takes the plastic medals and MEDAL BOLA (product_mapping.csv rows)', () => {
    ['15062', '15063 / SILVER', 'MEDAL BOLA'].forEach((c) => expect(isRoundMedalCode(c)).toBe(true));
  });

  it('leaves plaques, stand medals and blanks alone', () => {
    ['PKF 265', 'SM-13187 / GOLD / BASE A', 'HMX 12', '150621', '', null].forEach((c) => expect(isRoundMedalCode(c)).toBe(false));
  });
});
