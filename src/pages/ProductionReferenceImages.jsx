import Nav from '../components/Nav';
import ImageDrop from '../components/ImageDrop';
import { useAppState } from '../state/useAppState';
import { REFERENCE_IMAGE_SLOTS } from '../data/catalog';

export default function ProductionReferenceImages() {
  const { state, updateReferenceImage } = useAppState();

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
                onChange={(url) => updateReferenceImage(slot.id, url)}
                placeholder="Upload reference image"
                subtext="PNG or JPG, click to browse"
                height={160}
                thumbSize={64}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
