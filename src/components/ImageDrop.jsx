import { useState, useRef } from 'react';

// Stored as a base64 data URL directly in a Postgres text column (no
// Supabase Storage/CDN involved — see supabase/migrations/0001_orders.sql
// logo_data_url, 0006_catalog_admin.sql image_data_url), so there's no
// server-side size limit backing this beyond the project's whole database
// quota. Capped client-side to keep any single upload (and, since RLS
// scopes writes to logged-in accounts, any single account) from being able
// to balloon the database with an oversized "image".
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Reimplements the mockup's drag-and-drop upload behavior (drop image ->
// preview) with plain File/FileReader APIs — the original used a proprietary
// <image-slot> web component that isn't available outside its design tool.
//
// `stacked` switches from the default side-by-side thumbnail+text row to a
// large image-on-top-of-text card (image width 100%, height `thumbSize`) —
// opt-in and defaults to false, so every existing caller (NewOrderStep1's
// logo upload) renders exactly as before.
export default function ImageDrop({ value, fileName, onChange, placeholder, subtext, height = 76, thumbSize = 52, stacked = false }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const ingest = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image is too large — please use one under 5 MB.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result, file.name);
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <div
        className={`image-drop${stacked ? ' image-drop-stacked' : ''}${dragOver ? ' image-drop-over' : ''}`}
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
            <img
              src={value}
              alt=""
              style={stacked
                ? { width: '100%', height: thumbSize, objectFit: 'contain', border: '1px solid var(--color-neutral-300)', background: '#fff', borderRadius: 4 }
                : { width: thumbSize, height: thumbSize, objectFit: 'contain', border: '1px solid var(--color-neutral-300)', background: '#fff' }}
            />
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
      {error && <div className="login-error" style={{ marginTop: 'var(--space-2)' }}>{error}</div>}
    </div>
  );
}
