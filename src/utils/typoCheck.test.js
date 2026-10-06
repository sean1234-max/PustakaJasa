import { describe, it, expect, afterEach } from 'vitest';
import { findPossibleTypo, setCustomTypoWords, replaceWord } from './typoCheck';

describe('findPossibleTypo', () => {
  it('flags a one-edit near-miss of a known word', () => {
    expect(findPossibleTypo('ANIGERAH KECEMERLANGAN')).toMatchObject({ word: 'ANIGERAH', suggestion: 'ANUGERAH' });
    expect(findPossibleTypo('BAHESA MELAYU')).toMatchObject({ word: 'BAHESA', suggestion: 'BAHASA' });
  });

  it('flags two swapped neighbouring letters as a near-miss', () => {
    expect(findPossibleTypo('THAUN 1')).toMatchObject({ word: 'THAUN', suggestion: 'TAHUN' });
    expect(findPossibleTypo('ANUEGRAH KEHADIRAN PENUH')).toMatchObject({ word: 'ANUEGRAH', suggestion: 'ANUGERAH' });
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
      expect(findPossibleTypo('SELAYENG')).toMatchObject({ word: 'SELAYENG', suggestion: 'SELAYANG' });
    });

    it('clearing the custom list stops flagging it again', () => {
      setCustomTypoWords(['SELAYANG']);
      expect(findPossibleTypo('SELAYENG')).not.toBeNull();
      setCustomTypoWords([]);
      expect(findPossibleTypo('SELAYENG')).toBeNull();
    });
  });
});

describe('keeping or fixing a flagged word', () => {
  it('a word the teacher kept (okWords) is no longer flagged', () => {
    expect(findPossibleTypo('ADAB GEMILANG')).toMatchObject({ clean: 'ADAB', suggestion: 'ARAB' });
    expect(findPossibleTypo('ADAB GEMILANG', undefined, ['ADAB'])).toBeNull();
  });
  it('replaceWord swaps only whole-word copies', () => {
    expect(replaceWord('ADAB GEMILANG, adab', 'ADAB', 'ARAB')).toBe('ARAB GEMILANG, ARAB');
    expect(replaceWord('ADABI GEMILANG', 'ADAB', 'ARAB')).toBe('ADABI GEMILANG');
  });
});
