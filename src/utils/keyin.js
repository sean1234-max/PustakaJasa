// Who places a New Order on a school's behalf, picking the school on Step 1 (search_schools): a salesman
// (0081) or Production keying it in for a salesman / teacher (0125, Sean 2026-11-11).
export const picksSchool = (role) => role === 'salesman' || role === 'production';
