// Jenis Plak search for PlakPicker (Sean, 2026-11-14): "628" finds "YK - 628", spaces / "-" / "/"
// don't matter ("yk628", "YK-628"), and several words narrow a nested code at once ("13187 gold b"
// → SM-13187 / GOLD / BASE B). Only leaves (codes that can really be picked) are returned.

// Every leaf in the tree, paired with its full path (["MP393", "GOLD", "BASE B"]).
export function collectLeaves(nodes, path = []) {
  return (nodes || []).flatMap((node) => {
    const nextPath = [...path, node.code];
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) return [{ path: nextPath, node }];
    return collectLeaves(node.children, nextPath);
  });
}

// lower case, letters and digits only: "YK - 628" → "yk628"
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Leaves holding every typed word, best first: the exact code, then codes that start with what was
// typed, then the most typed words matching a whole word of the code ("b" → BASE B before BASE A),
// then catalog order.
export function searchLeaves(catalog, query) {
  const words = String(query || '').trim().split(/\s+/).map(squash).filter(Boolean);
  if (!words.length) return [];
  const whole = squash(query);
  return collectLeaves(catalog)
    .map((leaf, i) => {
      const key = squash(leaf.path.join(''));
      if (!words.every((w) => key.includes(w))) return null;
      const tokens = new Set(leaf.path.join(' ').split(/[^a-z0-9]+/i).map(squash).filter(Boolean));
      const exactWords = words.filter((w) => tokens.has(w)).length;
      return { ...leaf, rank: key === whole ? 0 : key.startsWith(whole) ? 1 : 2, exactWords, i };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || b.exactWords - a.exactWords || a.i - b.i);
}
