import { useState, useRef } from 'react';

// Reimplements the mockup's drag-and-drop upload behavior (drop image ->
// preview) with plain File/FileReader APIs — the original used a proprietary
// <image-slot> web component that isn't available outside its design tool.
export default function ImageDrop({ value, fileName, onChange, placeholder, subtext, height = 76, thumbSize = 52 }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const ingest = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result, file.name);
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={`image-drop${dragOver ? ' image-drop-over' : ''}`}
      style={{ minHeight: height }}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        ingest(e.dataTransfer.files && e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => ingest(e.target.files && e.target.files[0])}
      />
      {value ? (
        <>
          <img src={value} alt="" style={{ width: thumbSize, height: thumbSize, objectFit: 'contain', border: '1px solid var(--color-neutral-300)', background: '#fff' }} />
          <div>
            <div className="image-drop-title">{fileName}</div>
            <div className="image-drop-sub">Click to replace</div>
          </div>
        </>
      ) : (
        <>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div>
            <div className="image-drop-title">{placeholder}</div>
            <div className="image-drop-sub">{subtext}</div>
          </div>
        </>
      )}
    </div>
  );
}
