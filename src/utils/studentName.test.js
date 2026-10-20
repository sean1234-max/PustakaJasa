import { describe, it, expect } from 'vitest';
import { hasStudentName } from './studentName';

describe('hasStudentName', () => {
  it('finds Malay / Indian name words', () => {
    ['MUHAMMAD ALI', 'NUR AINA', 'ALI BIN ABU', 'SITI AMINAH BT ISMAIL', 'RAJ A/L KUMAR', 'MOHD. FAIZ'].forEach((n) => expect(hasStudentName(n)).toBe(true));
  });
  it('ignores award and class wording', () => {
    ['ANUGERAH PENGHARGAAN PENGAWAS SEKOLAH', 'TAHUN 6 AMANAH', 'TOKOH NILAM', 'MAJLIS APRESIASI 2026', 'NORMAL'].forEach((t) => expect(hasStudentName(t)).toBe(false));
  });
});
