import { getOrderJenisPlakGroups, getPlakProductionMode } from './exportCsv';

// Deterministic post-import / pre-production checks. Nothing here calls a
// model — these are plain arithmetic and lookups over an order's items or
// over a freshly-parsed import.

// The Jenis Plak groups a teacher/office should be told to hand-make
// instead of exporting (see catalog.js MANUAL_MAX_QTY / exportCsv.js
// getPlakProductionMode). One entry per Jenis Plak, in the order
// getOrderJenisPlakGroups returns them.
export function getManualPlakGroups(order) {
  const modes = getPlakProductionMode(order);
  return getOrderJenisPlakGroups(order)
    .filter(({ jenisPlak }) => modes.get(jenisPlak)?.mode === 'manual')
    .map(({ jenisPlak, items }) => ({
      jenisPlak,
      items,
      totalQty: modes.get(jenisPlak).totalQty,
    }));
}

// A ready-to-append order Remark block naming every Jenis Plak Production
// must make by hand (no CSV file will exist for it). Returns '' when the
// order has none — the caller appends only a non-empty result. Text is
// Malay to match the rest of the order's Production-facing notes.
export function buildManualRemarkBlock(order) {
  const groups = getManualPlakGroups(order);
  if (groups.length === 0) return '';
  const lines = groups.map((g) => `• ${g.jenisPlak} — ${g.totalQty} keping`);
  const totalKeping = groups.reduce((sum, g) => sum + g.totalQty, 0);
  return [
    '── PERLU BUAT MANUAL (tiada fail CSV) ──',
    ...lines,
    `Jumlah manual: ${totalKeping} keping / ${groups.length} jenis plak`,
  ].join('\n');
}

// ── Import cross-checks (feed the Step-2 "需要你确认" panel) ──────────────

// The label a parsed KLAS_MATRIX class row is known by — matches the key
// excelImport.js's readSubjectMatrix uses for `statedTotals`.
function classLabel(cls) {
  return cls.namaKelas || cls.tahunFrom || cls.tahunTo || '';
}

// For a subject-by-class matrix import (excelImport.js readSubjectMatrix):
// compare each class column's filled-in cells against the teacher's own
// TOTAL row for that column. A mismatch is never "fixed" here — it's
// returned for the teacher to resolve on Step 2. When a subject has a qty
// in other columns but not this one, and those subjects' quantities
// exactly close the gap, they're returned as `missing` — the likely
// "forgot to fill this cell" case (KOSAS MP THP 2: SEJARAH blank in
// TAHUN 6, but its TOTAL still says 12).
//
// `sections` are freshly-parsed KLAS_MATRIX sections, each optionally
// carrying `statedTotals: { [classLabel]: number }`.
export function checkColumnTotals(sections) {
  const issues = [];
  (sections || []).forEach((section, sectionIdx) => {
    const stated = section.statedTotals;
    if (!stated) return;
    const classes = section.classes || [];
    classes.forEach((cls) => {
      const label = classLabel(cls);
      const statedTotal = stated[label];
      if (statedTotal == null) return;
      const computed = (cls.subjects || []).reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
      if (computed === statedTotal) return;

      const here = new Set((cls.subjects || []).filter((x) => Number(x.qty) > 0).map((x) => x.name));
      const siblingQty = new Map();
      classes.forEach((other) => {
        if (other === cls) return;
        (other.subjects || []).forEach((x) => {
          const q = Number(x.qty) || 0;
          if (q > 0 && !siblingQty.has(x.name)) siblingQty.set(x.name, q);
        });
      });
      const candidates = [...siblingQty.entries()]
        .filter(([name]) => !here.has(name))
        .map(([name, qty]) => ({ name, qty }));
      const gap = statedTotal - computed;
      const closesGap = candidates.length > 0
        && candidates.reduce((sum, m) => sum + m.qty, 0) === gap;

      issues.push({
        id: `coltotal:${sectionIdx}:${label}`,
        sectionIdx,
        classLabel: label,
        computed,
        stated: statedTotal,
        missing: closesGap ? candidates : [],
      });
    });
  });
  return issues;
}

const sumSection = (section) => (section.classes || []).reduce(
  (sum, cls) => sum + (cls.subjects || []).reduce((s, x) => s + (Number(x.qty) || 0), 0),
  0,
);

// Compare what each plaque code's imported sections actually add up to
// against the school's own FRONT PG grand total for that code
// (excelImport.js tags sections with `frontPgQty`). Sections sharing a
// plaque code are summed together first — one code can be split across
// several sections (KOSAS: PK 020 A appears in two, 30 + 46 = 76). Unlike
// checkColumnTotals there's no safe auto-fix: the parser can't know which
// class or subject the shortfall belongs to, so this only ever asks.
// `excludeSectionIdxs` skips groups already covered by a column-total
// question, so the same blank cell isn't queried twice.
export function checkExpansionTotals(sections, excludeSectionIdxs = []) {
  const skip = new Set(excludeSectionIdxs);
  const groups = new Map();
  (sections || []).forEach((section, sectionIdx) => {
    if (!section.jenisPlak) return;
    const key = section.jenisPlak.toUpperCase().replace(/[()\s]/g, '').replace(/-+/g, '');
    const g = groups.get(key)
      || { jenisPlak: section.jenisPlak, frontPgQty: null, computed: 0, sectionIdxs: [] };
    g.computed += sumSection(section);
    g.sectionIdxs.push(sectionIdx);
    if (section.frontPgQty != null) g.frontPgQty = section.frontPgQty;
    groups.set(key, g);
  });

  const issues = [];
  groups.forEach((g) => {
    if (g.frontPgQty == null || g.computed === g.frontPgQty) return;
    if (g.sectionIdxs.some((i) => skip.has(i))) return;
    issues.push({
      id: `frontpg:${g.jenisPlak}`,
      sectionIdxs: g.sectionIdxs,
      jenisPlak: g.jenisPlak,
      computed: g.computed,
      stated: g.frontPgQty,
    });
  });
  return issues;
}
