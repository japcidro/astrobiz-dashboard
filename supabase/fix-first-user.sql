-- Fix: Allow the trigger function to insert employees bypassing RLS
-- The handle_new_user() function already has SECURITY DEFINER,
-- but we need a policy that allows inserts from the trigger

-- Drop the restrictive admin-only insert policy
drop policy if exists "employees_admin_insert" on employees;

-- Create a new insert policy that allows:
-- 1. The trigger (service role) to insert new employees
-- 2. Admins to insert employees manually
create policy "employees_insert" on employees
  for insert with check (
    -- Allow if the auth_id matches the current user (self-registration via trigger)
    auth.uid() = auth_id
    -- Or if an admin is doing the insert
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );
