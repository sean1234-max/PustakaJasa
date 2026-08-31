import { describe, it, expect } from 'vitest';
import { findPossibleTypo } from './typoCheck';

describe('findPossibleTypo', () => {
  it('flags a one-edit near-miss of a known word', () => {
    expect(findPossibleTypo('ANIGERAH KECEMERLANGAN')).toEqual({ word: 'ANIGERAH', suggestion: 'ANUGERAH' });
    expect(findPossibleTypo('BAHESA MELAYU')).toEqual({ word: 'BAHESA', suggestion: 'BAHASA' });
  });

  it('returns null for an exact match', () => {
    expect(findPossibleTypo('ANUGERAH KECEMERLANGAN MURID')).toBeNull();
  });

  it('returns null for an unrelated word that is not close to anything known', () => {
    expect(findPossibleTypo('SEKOLAH KEBANGSAAN TAMAN DESA')).toBeNull();
    expect(findPossibleTypo('Zulkifli')).toBeNull();
  });

  it('ignores words shorter than 3 letters', () => {
    expect(findPossibleTypo('DI KL')).toBeNull();
  });

  it('does not flag a word that is 2+ edits away (avoids false positives)', () => {
    // "SUBANG" is edit distance 2 from "SUKAN" — must NOT be flagged.
    expect(findPossibleTypo('SUBANG JAYA')).toBeNull();
  });
});
