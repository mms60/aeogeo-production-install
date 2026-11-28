-- Apply the approved entitlement matrix to plan enforcement.
-- Migration 03 seeded provisional limits: 300 pages per audit and 4,500 / 15,000
-- monthly pages. The approved matrix is 25 pages per audit and 300 / 1,500 / 5,000
-- monthly pages. Scan allowances are set by migration 16; approval is a separate
-- decision, so this migration never changes geo_plan_catalog.approved.
begin;

update public.geo_plan_catalog
 set domains = case id
       when 'starter' then 1
       when 'professional' then 3
       when 'agency' then 10
     end,
     per_audit = 25,
     monthly_pages = case id
       when 'starter' then 300
       when 'professional' then 1500
       when 'agency' then 5000
     end
 where id in ('starter','professional','agency');

commit;
