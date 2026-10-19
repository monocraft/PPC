-- PostgREST hoists timeout from the invoked RPC, not its nested native commit.
-- Match the existing native 12-second bound without changing role/global limits.
alter function public.ppc_master_ascm_sharepoint_commit(jsonb) set statement_timeout = '12s';
notify pgrst, 'reload schema';
