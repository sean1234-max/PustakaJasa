// flashKey: that tab flashes 3 times (opened to fill in its KIV rows, Sean 2026-10-17)
export default function CategoryTabs({ categories, active, onSelect, flashKey = null }) {
  return (
    <div className="tabs">
      {categories.map((cat) => (
        <button
          key={cat.key}
          type="button"
          className={`btn ${cat.key === active ? 'btn-primary' : 'btn-ghost'}${cat.key === flashKey ? ' tab-flash' : ''}`}
          onClick={() => onSelect(cat.key)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
