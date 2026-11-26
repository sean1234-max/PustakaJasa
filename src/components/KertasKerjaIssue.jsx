import { PlakRowPicture } from './PlakPreview';

// One kertas kerja question on Add to Cart (Sean, 2026-11-26): the plaque as it will be engraved, what the
// teacher's kertas kerja (the form bot's reading of it) says, and the answer. `issue` from
// kertasKerjaCheck.js plus `targets` (lines a spelling fix can go into); `onFix` puts the kertas kerja's
// spelling in, `onKeep` remembers that the teacher wants it as it is.
const QUESTION = {
  typo: (i) => <>The kertas kerja spells it <strong>{i.kk}</strong>; this plaque has <strong>{i.word}</strong>.</>,
  missing: (i) => <>The kertas kerja has <strong>{i.word}</strong> on this {i.where === 'header' ? 'TAJUK' : 'plaque'}; the order doesn&apos;t.</>,
  extra: (i) => <><strong>{i.word}</strong> is not in the kertas kerja.</>,
};

export default function KertasKerjaIssue({ issue, onFix, onKeep }) {
  const canFix = issue.kind === 'typo' && issue.targets?.length > 0;
  return (
    <>
      <p className="confirm-item-q" style={{ margin: 0 }}>
        {QUESTION[issue.kind](issue)}
        {issue.count > 1 && <span className="hint-text" style={{ marginLeft: 8 }}>({issue.count} plaques)</span>}
      </p>
      {issue.kkText && <p className="hint-text" style={{ margin: '2px 0 6px' }}>Kertas kerja: {issue.kkText}</p>}
      {issue.plaque?.row && (
        <div style={{ maxWidth: 260, margin: '6px 0' }}>
          <PlakRowPicture row={issue.plaque.row} />
        </div>
      )}
      <div className="confirm-item-opts">
        {canFix && <button type="button" className="btn btn-ghost" onClick={onFix}>Use the kertas kerja: {issue.kk}</button>}
        <button type="button" className="btn btn-ghost" onClick={onKeep}>The teacher wants it this way</button>
      </div>
      {!canFix && <p className="hint-text" style={{ margin: '4px 0 0' }}>Wrong? Go back to editing and fix it on the plaque.</p>}
    </>
  );
}
