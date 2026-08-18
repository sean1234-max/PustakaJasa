-- Business rule: a school may have more than one salesman (0025), but at
-- most three (e.g. a sales manager + a salesman, with room for a third).
-- Enforced as a trigger rather than a check constraint since the limit
-- depends on counting sibling rows, and applied here (not just in the
-- admin UI) so it holds no matter which admin page the assignment comes
-- from (school detail or salesman detail).
create or replace function public.enforce_max_salesmen_per_school()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.salesman_assignments where teacher_id = new.teacher_id) >= 3 then
    raise exception 'A school can have at most 3 salesmen assigned.';
  end if;
  return new;
end;
$$;

create trigger salesman_assignments_max_three
  before insert on public.salesman_assignments
  for each row execute function public.enforce_max_salesmen_per_school();
