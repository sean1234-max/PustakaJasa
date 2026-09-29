import { describe, it, expect, afterEach } from 'vitest';
import { findPossibleTypo, setCustomTypoWords } from './typoCheck';

describe('findPossibleTypo', () => {
  it('flags a one-edit near-miss of a known word', () => {
    expect(findPossibleTypo('ANIGERAH KECEMERLANGAN')).toEqual({ word: 'ANIGERAH', suggestion: 'ANUGERAH' });
    expect(findPossibleTypo('BAHESA MELAYU')).toEqual({ word: 'BAHESA', suggestion: 'BAHASA' });
  });

  it('flags two swapped neighbouring letters as a near-miss', () => {
    expect(findPossibleTypo('THAUN 1')).toEqual({ word: 'THAUN', suggestion: 'TAHUN' });
    expect(findPossibleTypo('ANUEGRAH KEHADIRAN PENUH')).toEqual({ word: 'ANUEGRAH', suggestion: 'ANUGERAH' });
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

  describe('setCustomTypoWords — Admin-added dictionary words', () => {
    afterEach(() => setCustomTypoWords([]));

    it('flags a near-miss of an admin-added word once set', () => {
      expect(findPossibleTypo('SELAYENG')).toBeNull();
      setCustomTypoWords(['selayang']);
      expect(findPossibleTypo('SELAYENG')).toEqual({ word: 'SELAYENG', suggestion: 'SELAYANG' });
    });

    it('clearing the custom list stops flagging it again', () => {
      setCustomTypoWords(['SELAYANG']);
      expect(findPossibleTypo('SELAYENG')).not.toBeNull();
      setCustomTypoWords([]);
      expect(findPossibleTypo('SELAYENG')).toBeNull();
    });
  });
});
