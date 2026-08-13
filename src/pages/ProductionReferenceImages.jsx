import Nav from '../components/Nav';
import ImageDrop from '../components/ImageDrop';
import { useAppState } from '../state/useAppState';
import { REFERENCE_IMAGE_SLOTS } from '../data/catalog';
import { logAdminAction } from '../lib/adminApi';

// Shared as-is between /production/reference-images and
// /admin/reference-images (see src/App.jsx) — same component, same
// updateReferenceImage handler. Only the admin-audit-log call below is
// role-gated, so Production's existing behavior is completely unaffected.
export default function ProductionReferenceImages() {
  const { state, updateReferenceImage } = useAppState();

  const handleChange = (slotId, label, url) => {
    updateReferenceImage(slotId, url);
    if (state.role === 'admin') {
      logAdminAction({ action: 'Admin uploaded a reference image', targetTable: 'catalog_reference_images', targetId: slotId, after: { label } });
    }
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
                onChange={(url) => handleChange(slot.id, slot.label, url)}
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
