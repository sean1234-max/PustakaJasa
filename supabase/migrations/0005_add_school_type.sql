-- Backs the new "SK / Not SK" pick on New Order → Function Details. SK
-- schools skip the logo upload entirely, so this needs to be a column of
-- its own rather than inferred from logo_data_url being null (an older
-- Not-SK order that hasn't gotten around to uploading yet would look
-- identical to an SK one otherwise).
alter table public.orders add column if not exists school_type text;
