import { useEffect, useRef, useState } from 'react';
import { computeContainRect } from '../utils/imageOverlay';

// Reference Sample image, optionally with the teacher's own typed text
// overlaid live at Production-configured positions (see
// ReferenceImagePositionEditor.jsx / supabase/migrations/
// 0037_add_reference_image_text_positions.sql). `positions` is keyed by
// row NUMBER ("1".."5"), not field identity, so it stays correct
// regardless of drag-reordering or Main Template's extra rows — `lines`
// should be `blk.lines` (computeBlocks.js), already numbered/reordered.
// Renders exactly like the old plain `<img>`/placeholder whenever
// `positions` is empty/undefined, so every category Production hasn't
// configured (or that doesn't use this feature) is unaffected.
export default function ReferenceImageOverlay({ imageUrl, positions, lines }) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const [rect, setRect] = useState(null);

  const recompute = () => {
    const wrap = wrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img || !img.naturalWidth) return;
    const { width, height } = wrap.getBoundingClientRect();
    setRect(computeContainRect(width, height, img.naturalWidth, img.naturalHeight));
  };

  useEffect(() => {
    setRect(null);
    if (!wrapRef.current) return undefined;
    const observer = new ResizeObserver(recompute);
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  if (!imageUrl) {
    return <div className="ref-sample-placeholder">No reference image set yet</div>;
  }

  const hasPositions = positions && Object.keys(positions).length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'block' }}>
      <img ref={imgRef} src={imageUrl} alt="Reference sample" className="ref-sample-img" onLoad={recompute} />
      {hasPositions && rect && (lines || []).map((line) => {
        const pos = positions[String(line.num)];
        if (!pos || !String(line.value || '').trim()) return null;
        return (
          <div
            key={line.slotId}
            style={{
              position: 'absolute',
              left: rect.x + (pos.x / 100) * rect.width,
              top: rect.y + (pos.y / 100) * rect.height,
              transform: 'translate(-50%, -50%)',
              background: 'rgba(255,255,255,0.88)',
              border: '1px solid rgba(0,0,0,0.15)',
              padding: '1px 4px',
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1.3,
              color: '#1d1f20',
              whiteSpace: 'nowrap',
              maxWidth: rect.width * 0.92,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pointerEvents: 'none',
            }}
          >
            {line.value}
          </div>
        );
      })}
    </div>
  );
}
