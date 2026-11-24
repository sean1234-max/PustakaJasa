import { describe, it, expect } from 'vitest';
import { designLabel, isPickable, mergeDesignRows, moveDesign, sortDesigns, storedPreview } from './medalDesigns';

const row = (name, extra = {}) => ({ name, label: '', hidden: false, sort_order: 1, in_file: true, preview: { old: true }, ...extra });
const previewOf = (d) => ({ from: d.design });

describe('mergeDesignRows', () => {
  it('keeps a known design\'s label, hidden and order, and gives it the new preview', () => {
    const existing = [row('DESIGN 1', { label: 'Arc', hidden: false, sort_order: 2 })];

    const { rows, added, gone } = mergeDesignRows(existing, [{ design: 'DESIGN 1' }], previewOf);

    expect(rows).toEqual([{ name: 'DESIGN 1', label: 'Arc', hidden: false, sort_order: 2, in_file: true, preview: { from: 'DESIGN 1' } }]);
    expect(added).toEqual([]);
    expect(gone).toEqual([]);
  });

  it('adds a new design hidden, after the others, in DESIGN number order', () => {
    const existing = [row('DESIGN 1', { sort_order: 5 })];

    const { rows, added } = mergeDesignRows(existing, [{ design: 'DESIGN 10' }, { design: 'DESIGN 1' }, { design: 'DESIGN 3' }], previewOf);

    expect(rows.map((r) => [r.name, r.hidden, r.sort_order])).toEqual([['DESIGN 1', false, 5], ['DESIGN 3', true, 6], ['DESIGN 10', true, 7]]);
    expect(added).toEqual(['DESIGN 3', 'DESIGN 10']);
  });

  it('keeps a design that left E CUT 0, marked not in the file, once', () => {
    const existing = [row('DESIGN 1'), row('DESIGN 2', { label: 'Old', sort_order: 2 }), row('DESIGN 4', { in_file: false })];

    const { rows, gone } = mergeDesignRows(existing, [{ design: 'DESIGN 1' }], previewOf);

    expect(gone).toEqual(['DESIGN 2']);
    expect(rows.find((r) => r.name === 'DESIGN 2')).toEqual({ name: 'DESIGN 2', label: 'Old', hidden: false, sort_order: 2, in_file: false, preview: { old: true } });
    expect(rows.find((r) => r.name === 'DESIGN 4')).toBeUndefined();
  });

  it('brings a design back into the file when it returns', () => {
    const { rows, gone } = mergeDesignRows([row('DESIGN 2', { in_file: false, hidden: true })], [{ design: 'DESIGN 2' }], previewOf);

    expect(rows[0]).toMatchObject({ name: 'DESIGN 2', in_file: true, hidden: true });
    expect(gone).toEqual([]);
  });
});

describe('storedPreview', () => {
  it('swaps every picture name for its stored one', () => {
    const design = {
      design: 'DESIGN 1', main: 'T_H_Y_PC_L1_L2', thumb: 'DESIGN-1-thumb.png',
      picture: { png: 'DESIGN-1-bg.png', box: [1, 2, 3, 4] },
      templates: { A: { fields: {}, art: { png: 'DESIGN-1-A.png', box: [0] } }, B: { fields: {} } },
    };
    const stored = { 'DESIGN-1-thumb.png': 't.png', 'DESIGN-1-bg.png': 'b.png', 'DESIGN-1-A.png': 'a.png' };

    expect(storedPreview(design, stored)).toEqual({
      main: 'T_H_Y_PC_L1_L2', thumb: 't.png', picture: { png: 'b.png', box: [1, 2, 3, 4] },
      templates: { A: { fields: {}, art: { png: 'a.png', box: [0] } }, B: { fields: {} } },
    });
    expect(design.thumb).toBe('DESIGN-1-thumb.png');
  });

  it('keeps a design without a background', () => {
    expect(storedPreview({ design: 'DESIGN 1', main: 'A', thumb: 'x.png', picture: null, templates: {} }, {}).picture).toBeNull();
  });
});

describe('moveDesign', () => {
  const rows = [row('DESIGN 1', { sort_order: 1 }), row('DESIGN 2', { sort_order: 2 }), row('DESIGN 3', { sort_order: 3 })];

  it('swaps a design with its neighbour and returns only the changed orders', () => {
    expect(moveDesign(rows, 'DESIGN 3', -1)).toEqual([{ name: 'DESIGN 3', sort_order: 2 }, { name: 'DESIGN 2', sort_order: 3 }]);
  });

  it('does nothing past either end', () => {
    expect(moveDesign(rows, 'DESIGN 1', -1)).toEqual([]);
    expect(moveDesign(rows, 'DESIGN 3', 1)).toEqual([]);
  });

  it('renumbers tied orders 1… as they are shown', () => {
    const tied = [row('DESIGN 2', { sort_order: 0 }), row('DESIGN 1', { sort_order: 0 })];
    expect(moveDesign(tied, 'DESIGN 2', -1)).toEqual([{ name: 'DESIGN 2', sort_order: 1 }, { name: 'DESIGN 1', sort_order: 2 }]);
  });
});

describe('sortDesigns / isPickable / designLabel', () => {
  it('sorts by order, then DESIGN number', () => {
    const rows = [row('DESIGN 10', { sort_order: 1 }), row('DESIGN 2', { sort_order: 1 }), row('DESIGN 1', { sort_order: 2 })];
    expect(sortDesigns(rows).map((r) => r.name)).toEqual(['DESIGN 2', 'DESIGN 10', 'DESIGN 1']);
  });

  it('lets salesmen pick only published designs still in E CUT 0', () => {
    expect(isPickable(row('DESIGN 1'))).toBe(true);
    expect(isPickable(row('DESIGN 1', { hidden: true }))).toBe(false);
    expect(isPickable(row('DESIGN 1', { in_file: false }))).toBe(false);
  });

  it('shows the label, else the name', () => {
    expect(designLabel(row('DESIGN 1', { label: ' Arc ' }))).toBe('Arc');
    expect(designLabel(row('DESIGN 1'))).toBe('DESIGN 1');
  });
});
