-- Reverts the never-shipped "text_positions" column added then immediately
-- retired the same session (position-based overlay was replaced with a
-- plain live text-list preview instead — see OrderCategoryBlock.jsx's
-- .ref-sample-live-preview). Nothing ever wrote real data into this column
-- from user-facing UI before it was removed, so this is safe to drop.
alter table public.catalog_reference_images drop column if exists text_positions;
