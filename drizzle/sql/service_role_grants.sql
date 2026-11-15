-- drizzle/sql/service_role_grants.sql
--
-- Fixes these two Railway log errors:
--   [scanOutcomes] upsert failed: 42501 permission denied for table scan_outcomes
--   [creator-grant] could not read premium_grants: permission denied for table premium_grants
--
-- Cause: the server talks to Supabase as the service_role, and this project
-- does not give new tables to service_role automatically. Neither table's SQL
-- granted it, so the server was locked out.
--
-- Safe: only service_role (the server, via the secret key) gets access.
-- App users (anon / authenticated) still get nothing. Safe to run again.
--
-- Run the whole file once in the Supabase SQL editor.

-- 1. Let the server read and write the two tables.
grant select, insert, update, delete on public.scan_outcomes  to service_role;
grant select, insert, update, delete on public.premium_grants to service_role;

-- 2. Every table created from now on gets the same access automatically,
--    so this error doesn't come back with the next new table.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- 3. Check: service_role should show DELETE, INSERT, SELECT, UPDATE on both rows.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('scan_outcomes', 'premium_grants')
  and grantee = 'service_role'
group by 1, 2
order by 1;