import { useState } from 'react';
import Nav from '../components/Nav';
import ImageDrop from '../components/ImageDrop';
import ReferenceImagePositionEditor from '../components/ReferenceImagePositionEditor';
import { useAppState } from '../state/useAppState';
import { REFERENCE_IMAGE_SLOTS } from '../data/catalog';

export default function ProductionReferenceImages() {
  const { state, updateReferenceImage, updateReferenceImagePositions } = useAppState();
  const [expandedSlotId, setExpandedSlotId] = useState(null);

  const handleChange = (slotId, url) => {
    updateReferenceImage(slotId, url);
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Production</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Reference Sample Images</div>
        <p className="hint-text">
          These are the "how to fill it in" examples teachers see for each award category. Replacing one here updates it for every teacher immediately — teachers can only view it, not change it.
        </p>

        <div className="ref-image-admin-grid">
          {REFERENCE_IMAGE_SLOTS.map((slot) => (
            <div key={slot.id} className="field">
              <label>{slot.label}</label>
              <ImageDrop
                value={state.refImages?.[slot.id]}
                fileName={slot.label}
                onChange={(url) => handleChange(slot.id, url)}
                placeholder="Upload reference image"
                subtext="PNG or JPG, click to browse"
                height={160}
                thumbSize={64}
              />
              {state.refImages?.[slot.id] && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 'var(--space-2)' }}
                  onClick={() => setExpandedSlotId(expandedSlotId === slot.id ? null : slot.id)}
                >
                  {expandedSlotId === slot.id ? 'Hide Text Positions' : 'Edit Text Positions'}
                </button>
              )}
              {expandedSlotId === slot.id && (
                <ReferenceImagePositionEditor
                  imageUrl={state.refImages[slot.id]}
                  positions={state.refImagePositions?.[slot.id]}
                  onSave={(positions) => updateReferenceImagePositions(slot.id, positions)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
