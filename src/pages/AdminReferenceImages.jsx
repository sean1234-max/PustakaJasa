import AdminLayout from '../components/AdminLayout';
import ImageDrop from '../components/ImageDrop';
import { useAppState } from '../state/useAppState';
import { REFERENCE_IMAGE_SLOTS } from '../data/catalog';
import { logAdminAction } from '../lib/adminApi';

// Admin-only fork of ProductionReferenceImages.jsx — same
// updateReferenceImage handler and the same admin-audit-log call,
// restyled to match the Admin Portal redesign. Kept separate rather than
// sharing one component with /production/reference-images because that
// route needs to keep Production's own (unredesigned) look — see
// AdminLayout.jsx's header comment.
export default function AdminReferenceImages() {
  const { state, updateReferenceImage } = useAppState();

  const handleChange = (slotId, label, url) => {
    updateReferenceImage(slotId, url);
    logAdminAction({ action: 'Admin uploaded a reference image', targetTable: 'catalog_reference_images', targetId: slotId, after: { label } });
  };

  return (
    <AdminLayout
      title="Reference Sample Images"
      subtitle={'These are the "how to fill it in" examples teachers see for each award category. Replacing one here updates it for every teacher immediately — teachers can only view it, not change it.'}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10">
        {REFERENCE_IMAGE_SLOTS.map((slot) => (
          <div key={slot.id}>
            <h3 className="text-headline-sm text-on-surface mb-3">{slot.label}</h3>
            <ImageDrop
              value={state.refImages?.[slot.id]}
              fileName={slot.label}
              onChange={(url) => handleChange(slot.id, slot.label, url)}
              placeholder="Upload reference image"
              subtext="PNG or JPG, click anywhere to replace"
              height={220}
              thumbSize={180}
              stacked
            />
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}
