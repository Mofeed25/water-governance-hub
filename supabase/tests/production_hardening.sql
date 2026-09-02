begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_table('public','tenants','tenants table exists');
select has_table('public','subscribers','subscribers table exists');
select has_table('public','meter_readings','meter readings table exists');
select has_table('public','receipts','receipts table exists');
select has_table('public','billing_logs','billing table exists');
select has_column('public','meter_readings','consumption_m3','consumption is persisted/computed');
select has_column('public','meter_readings','hash_signature','reading integrity digest exists');
select has_column('public','receipts','hash_signature','receipt integrity digest exists');
select has_index('public','idx_billing_unpaid','unpaid billing index exists');
select has_index('public','idx_user_roles_user_tenant_role','role lookup index exists');

select ok(
  exists (select 1 from pg_constraint where conname='meter_readings_tenant_subscriber_fk'),
  'meter readings enforce tenant/subscriber consistency'
);
select ok(
  exists (select 1 from pg_constraint where conname='receipts_tenant_subscriber_fk'),
  'receipts enforce tenant/subscriber consistency'
);
select ok(
  exists (select 1 from pg_constraint where conname='billing_logs_tenant_subscriber_fk'),
  'billing logs enforce tenant/subscriber consistency'
);
select ok(
  not has_function_privilege('anon','public.admin_set_user_access(uuid,uuid,public.app_role)','execute'),
  'anonymous callers cannot execute admin access RPC'
);

select * from finish();
rollback;
