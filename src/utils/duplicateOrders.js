// Duplicate order check (0094, Sean 2026-10-15): why an order looks like another.
const REASON_TEXT = {
  same_teacher_function_date: 'same teacher, same Function Date',
  // 0094's, on orders flagged before 2026-10-15
  in_progress: 'still in progress',
  same_file: 'same Excel file',
  same_function_date: 'same Function Date',
};

export const duplicateReasons = (reasons) => (reasons || []).map((r) => REASON_TEXT[r] || r).join(', ');

// One line for Production: "ORD-0059 (same Excel file, still in progress)"
export const duplicateSummary = (check) => (check?.matches || [])
  .map((m) => `${m.id} (${duplicateReasons(m.reasons)})`).join('; ');
