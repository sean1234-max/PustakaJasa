import { PlakRowPicture } from './PlakPreview';
import { phraseRe } from '../utils/orderSelfCheck';

// One Add to Cart question (Sean, 2026-11-26), shown as a picture, not only words: the plaque as it will be
// engraved beside the file's line, the word in question marked in both. `issue` from kertasKerjaCheck.js
// (source: the kertas kerja, or 'file' = the uploaded order file) or orderSelfCheck.js (the website's own:
// 'join', 'same'), plus `targets` (where a fix goes); `onFix` puts the fix in, `onKeep` remembers that the
// teacher wants it as it is.
const MARK = { background: '#ffe08a', borderRadius: 3, padding: '0 3px', fontWeight: 700 };
const BOX = { border: '1px solid #e2d9b8', background: '#fffdf5', borderRadius: 6, padding: '6px 10px', fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' };

function Marked({ text, word }) {
  if (!word) return text;
  const re = phraseRe(word);
  const parts = String(text).split(new RegExp(`(${re.source})`, 'i'));
  return parts.map((part, i) => (i % 2 ? <mark key={i} style={MARK}>{part}</mark> : part));
}

// The plaque's line(s) with the word — the picture shows the rest
function plaqueLineWith(p, word) {
  if (!p || !word) return '';
  const lines = [p.header, p.red, ...(p.black || [])].flatMap((t) => String(t || '').split('\n')).map((t) => t.trim()).filter(Boolean);
  const re = phraseRe(word);
  return lines.filter((l) => re.test(l)).join(' / ') || (re.test(lines.join(' ')) ? lines.join(' / ') : '');
}

const from = (i) => (i.source === 'file' ? 'uploaded file' : 'kertas kerja');
const SAME_GROUPS_SHOWN = 5;
const rowList = (nos) => (nos.length > 2 ? `${nos.slice(0, -1).join(', ')} and ${nos[nos.length - 1]}` : nos.join(' and '));
const times = (n) => (n === 2 ? 'twice' : `${n} times`);
const B = ({ children }) => <strong>{children}</strong>;

// Each question in one short line, a hint under it, and the answers as buttons (Sean, 2026-11-27: shorter,
// more direct). `fix` is the one-click answer (only where `targets` say where it goes), `keep` the other.
const ASK = {
  typo: (i) => ({
    q: <>Which spelling: <B>{i.kk}</B> or <B>{i.word}</B>?</>,
    hint: `The ${from(i)} has ${i.kk}.`,
    fix: i.kk,
    keep: i.word,
  }),
  missing: (i) => ({
    q: <>Missing <B>{i.word}</B>?</>,
    hint: `The ${from(i)} has it, the ${i.where === 'header' ? 'TAJUK' : 'plaque'} doesn't. To add it, go Back to editing.`,
    keep: 'Leave it out',
  }),
  extra: (i) => ({
    q: <>Is <B>{i.word}</B> right?</>,
    hint: `It's not in the ${from(i)}. To change it, go Back to editing.`,
    keep: 'Yes, it\'s right',
  }),
  file: () => ({
    q: <>Is this the right kertas kerja?</>,
    hint: 'It hardly matches this order — check the school and the event.',
    keep: 'Yes, right file',
  }),
  join: (i) => ({
    q: <><B>{i.kk}</B> or <B>{i.word}</B>?</>,
    fix: i.kk,
    keep: i.word,
  }),
  same: (i) => {
    const last = i.rowNos[i.rowNos.length - 1];
    if (i.level) {
      return {
        q: <><B>{i.level.from}</B> {times(i.rowNos.length)} — should one be <B>{i.level.missing.join(' or ')}</B>?</>,
        hint: `Rows ${rowList(i.rowNos)}.`,
        fix: i.level.to && `Row ${last} → ${i.level.to}`,
        keep: `No, ${i.rowNos.length === 2 ? 'both' : 'all'} ${i.level.from}`,
      };
    }
    if (i.groups.length === 1) {
      return { q: <>Same plaque {times(i.rowNos.length)} — is that right?</>, hint: `Rows ${rowList(i.rowNos)}.`, keep: 'Yes, keep them' };
    }
    return {
      q: <>These plaques repeat — is that right?</>,
      list: [
        ...i.groups.slice(0, SAME_GROUPS_SHOWN).map((g) => `Rows ${rowList(g.rowNos)}: ${g.text.split(' / ').slice(-2).join(' / ')}`),
        ...(i.groups.length > SAME_GROUPS_SHOWN ? [`… and ${i.groups.length - SAME_GROUPS_SHOWN} more`] : []),
      ],
      keep: 'Yes, keep them',
    };
  },
};

export default function KertasKerjaIssue({ issue, onFix, onKeep }) {
  const ask = ASK[issue.kind](issue);
  const canFix = !!ask.fix && issue.targets?.length > 0;
  // a fix with nowhere to go (the word isn't in an editable line): the salesman edits it himself
  const keep = !canFix && ask.fix && ask.keep === issue.word ? `Keep ${issue.word}` : ask.keep;
  const hint = [
    [ask.hint, !canFix && ask.fix ? 'To change it, go Back to editing.' : ''].filter(Boolean).join(' '),
    issue.count > 1 && issue.kind !== 'same' ? `${issue.count} plaques` : '',
  ].filter(Boolean).join(' · ');
  const p = issue.plaque;
  const kkWord = issue.kind === 'typo' ? issue.kk : issue.kind === 'missing' ? issue.word : null;
  const plaqueWord = issue.kind === 'missing' ? null : issue.kind === 'same' ? issue.level?.from : issue.word;
  const plaqueLine = plaqueLineWith(p, plaqueWord);
  return (
    <>
      <p className="confirm-item-q" style={{ margin: 0, fontSize: 15 }}>{ask.q}</p>
      {hint && <p className="hint-text" style={{ margin: '2px 0 0' }}>{hint}</p>}
      {ask.list && (
        <ul className="hint-text" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {ask.list.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      {(p || issue.kkText) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, margin: '8px 0' }}>
          {p && (
            <figure style={{ margin: 0 }}>
              <figcaption className="hint-text" style={{ fontWeight: 600, margin: '0 0 4px' }}>Plaque</figcaption>
              {p.row && <div style={{ maxWidth: 260, marginBottom: 6 }}><PlakRowPicture row={p.row} /></div>}
              {plaqueLine && <div style={BOX}><Marked text={plaqueLine} word={plaqueWord} /></div>}
            </figure>
          )}
          {issue.kkText && (
            <figure style={{ margin: 0 }}>
              <figcaption className="hint-text" style={{ fontWeight: 600, margin: '0 0 4px' }}>{issue.source === 'file' ? 'Uploaded file' : 'Kertas kerja'}</figcaption>
              <div style={BOX}><Marked text={issue.kkText} word={kkWord} /></div>
            </figure>
          )}
        </div>
      )}
      <div className="confirm-item-opts">
        {canFix && <button type="button" className="btn btn-secondary" onClick={onFix}>{ask.fix}</button>}
        <button type="button" className="btn btn-secondary" onClick={onKeep}>{keep}</button>
      </div>
    </>
  );
}
