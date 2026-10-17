-- Allow full master commits a bounded budget below the gateway's 15-second RPC deadline.
-- Keep role/global timeouts, lock_timeout, permissions and commit semantics unchanged.
ALTER FUNCTION public.ppc_master_commit(jsonb) SET statement_timeout = '12s';
NOTIFY pgrst, 'reload schema';

-- Rollback: ALTER FUNCTION public.ppc_master_commit(jsonb) RESET statement_timeout;
-- Then: NOTIFY pgrst, 'reload schema';
