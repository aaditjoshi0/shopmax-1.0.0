-- ============================================================================
-- Seed an admin user for ShopMax
-- Run this in the Supabase SQL Editor (Dashboard -> SQL -> New query).
-- ============================================================================

-- First, create the admin user via Supabase Auth (do this through the UI or API):
-- 1. Go to Authentication > Users > Invite user
-- 2. Email: admin@shopmax.com
-- 3. Password: Admin@123456
-- 4. Auto-confirm: ON

-- Then run this to set the role to admin:
update public.profiles
set role = 'admin',
    full_name = 'ShopMax Admin'
where email = 'admin@shopmax.com';

-- Verify
select id, email, full_name, role from public.profiles where role = 'admin';

-- If no admin user exists yet, create a profile manually (linked to auth.users):
-- (Replace the UUID with the actual user ID from Auth > Users)
-- insert into public.profiles (id, email, full_name, role)
-- values ('REPLACE-WITH-ACTUAL-UUID', 'admin@shopmax.com', 'ShopMax Admin', 'admin')
-- on conflict (id) do update set role = 'admin';
