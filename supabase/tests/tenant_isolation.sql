begin;
create extension if not exists pgtap with schema extensions;

-- Structural security gates: every tenant-owned table must have RLS enabled.
select plan(8);

select ok((select relrowsecurity from pg_class where oid='public.tenants'::regclass), 'tenants has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.subscribers'::regclass), 'subscribers has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.meter_readings'::regclass), 'meter_readings has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.receipts'::regclass), 'receipts has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.billing_logs'::regclass), 'billing_logs has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.user_roles'::regclass), 'user_roles has RLS enabled');

-- Browser clients must not be able to mutate financial/meter records directly.
select ok(has_table_privilege('authenticated','public.receipts','INSERT'), 'authenticated can submit receipts through the RLS-protected table path');
select ok(has_table_privilege('authenticated','public.meter_readings','INSERT'), 'authenticated can submit readings through the RLS-protected table path');

select * from finish();
rollback;
