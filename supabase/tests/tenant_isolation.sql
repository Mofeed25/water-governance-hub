begin;
create extension if not exists pgtap with schema extensions;

-- Structural and privilege-level security gates.
select plan(16);

select ok((select relrowsecurity from pg_class where oid='public.tenants'::regclass), 'tenants has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.subscribers'::regclass), 'subscribers has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.meter_readings'::regclass), 'meter_readings has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.receipts'::regclass), 'receipts has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.billing_logs'::regclass), 'billing_logs has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.user_roles'::regclass), 'user_roles has RLS enabled');

select ok(has_table_privilege('authenticated','public.subscribers','SELECT'), 'tenant users can read subscribers through RLS');
select ok(has_table_privilege('authenticated','public.meter_readings','INSERT'), 'browser can submit meter readings through RLS');
select ok(has_table_privilege('authenticated','public.receipts','INSERT'), 'browser can submit receipts through RLS');
select ok(has_table_privilege('authenticated','public.billing_logs','SELECT'), 'tenant users can read invoices through RLS');
select ok(not has_table_privilege('authenticated','public.billing_logs','INSERT'), 'browser cannot create invoices directly');
select ok(not has_table_privilege('authenticated','public.billing_logs','UPDATE'), 'browser cannot mutate invoices directly');
select ok(not has_table_privilege('authenticated','public.receipts','UPDATE'), 'browser cannot mutate receipts directly');
select ok(not has_table_privilege('authenticated','public.meter_readings','UPDATE'), 'browser cannot mutate meter readings directly');
select ok(not has_column_privilege('authenticated','public.profiles','tenant_id','UPDATE'), 'users cannot update their tenant assignment');

-- The isolation helper must reference the caller identity, not merely whether a tenant is active.
select ok(
  (select pg_get_functiondef(p.oid) like '%current_tenant_id%'
   from pg_proc p
   where p.oid = 'public.can_access_tenant(uuid)'::regprocedure),
  'tenant access helper is bound to the caller tenant'
);

select * from finish();
rollback;
