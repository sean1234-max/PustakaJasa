import { describe, it, expect } from 'vitest';
import { matchSchool, schoolScore, closestSchools } from './schoolMatch.ts';

const S = (id: string, sekolah: string) => ({ id, sekolah });
const schools = [
  S('a', 'SK PUTRAJAYA PRESINT 14(1)'), S('b', 'SK PUTRAJAYA PRESINT 14(2)'), S('c', 'SK PUTRAJAYA PRESINT 9(1)'),
  S('d', 'SMK PUTRAJAYA PRESINT 14(1)'), S('e', 'SJK(C) CHUNG HWA'), S('f', 'SK TAMAN MELATI'), S('g', 'SK TAMAN MELATI 2'),
];

describe('matchSchool', () => {
  it('the same name, case / spaces / brackets ignored', () => {
    expect(matchSchool('sk putrajaya presint 14 (1)', schools)).toEqual({ pick: schools[0] });
    expect(matchSchool('sjkc chung hwa', schools)).toEqual({ pick: schools[4] });
  });
  it('a name contained in only one school', () => {
    expect(matchSchool('chung hwa', schools)).toEqual({ pick: schools[4] });
  });
  it('several containing it: the choices, shortest first', () => {
    expect(matchSchool('taman melati', schools)).toEqual({ choices: [schools[5], schools[6]] });
  });
  it('a short form: the closest schools, the right one first', () => {
    const r = matchSchool('skpp 14 (1)', schools) as { choices: typeof schools };
    expect(r.choices[0]).toBe(schools[0]);
    expect(r.choices).not.toContain(schools[2]); // 9(1): its numbers don't fit
    expect(r.choices).not.toContain(schools[4]);
  });
  it('nothing like it: no choices', () => {
    expect(matchSchool('sk bukit jalil', schools)).toEqual({ choices: [] });
  });
});

describe('schoolScore', () => {
  it('initials of words in a row count', () => {
    expect(schoolScore('SKPP 14 1', 'SK PUTRAJAYA PRESINT 14(1)')).toBeGreaterThan(0.9);
    expect(schoolScore('SKPP 14 1', 'SK PUTRAJAYA PRESINT 9(1)')).toBe(0);
  });
  it('a word start counts', () => {
    expect(closestSchools('sk ptrjy', schools)).toEqual([]);
    expect(closestSchools('sk putra 9', schools)[0]).toBe(schools[2]);
  });
});
