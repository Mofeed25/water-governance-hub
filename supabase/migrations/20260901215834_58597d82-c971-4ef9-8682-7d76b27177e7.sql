ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

-- Also ensure billing_logs unique constraint exists for invoice generation ON CONFLICT
ALTER TABLE public.billing_logs
  ADD CONSTRAINT billing_logs_subscriber_period_key UNIQUE (subscriber_id, period);