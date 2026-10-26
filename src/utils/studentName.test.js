import { describe, it, expect } from 'vitest';
import { hasStudentName, takesNameSurcharge } from './studentName';

describe('hasStudentName', () => {
  it('finds Malay / Indian name words', () => {
    ['MUHAMMAD ALI', 'NUR AINA', 'ALI BIN ABU', 'SITI AMINAH BT ISMAIL', 'RAJ A/L KUMAR', 'MOHD. FAIZ', 'ADRIEL CRUZ ROSHAN'].forEach((n) => expect(hasStudentName(n)).toBe(true));
  });
  it('ignores award and class wording', () => {
    ['ANUGERAH PENGHARGAAN PENGAWAS SEKOLAH', 'TAHUN 6 AMANAH', 'TOKOH NILAM', 'MAJLIS APRESIASI 2026', 'NORMAL'].forEach((t) => expect(hasStudentName(t)).toBe(false));
  });
  it('ignores the school line, even when the school is named after someone', () => {
    ['SK TUN ABDUL AZIZ MAJID 2026', 'SJK(C) NOR HUA', 'SMK AHMAD BOESTAMAM', 'SEKOLAH KEBANGSAAN ABDUL RAHMAN'].forEach((t) => expect(hasStudentName(t)).toBe(false));
    expect(hasStudentName('MAJLIS APRESIASI GEMILANG\nSK TUN ABDUL AZIZ MAJID 2026\nANUGERAH KHAS\n-')).toBe(false);
    expect(hasStudentName('MAJLIS APRESIASI GEMILANG\nSK TUN ABDUL AZIZ MAJID 2026\nANUGERAH KHAS\nJUNALDI BIN SHAFIE')).toBe(true);
  });
});

describe('takesNameSurcharge', () => {
  it('never for a crystal or a VB plaque', () => {
    ['CRYSTAL / 00S / DESIGN C', 'VB / C / BLUE', 'vb / A / RED'].forEach((c) => expect(takesNameSurcharge(c)).toBe(false));
    ['PKC 263', 'MP393 / GOLD / BASE C', 'SR-116 A / BLUE'].forEach((c) => expect(takesNameSurcharge(c)).toBe(true));
  });
});
