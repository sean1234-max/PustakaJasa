export default function CategoryTabs({ categories, active, onSelect }) {
  return (
    <div className="tabs">
      {categories.map((cat) => (
        <button
          key={cat.key}
          type="button"
          className={`btn ${cat.key === active ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onSelect(cat.key)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
