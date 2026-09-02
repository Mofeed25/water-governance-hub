
REVOKE ALL ON FUNCTION public.meter_readings_fill() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.meter_readings_invoice() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_logs_sync_balance() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipts_apply_payment() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_subscriber_balance(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recompute_subscriber_balance(uuid) TO service_role;
