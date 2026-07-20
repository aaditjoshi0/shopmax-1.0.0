-- Run this in Supabase SQL Editor (Dashboard -> SQL -> New query)
-- It allows the app to insert/update products (needed for seeding).

-- Allow anyone to insert/update products (for seed script)
drop policy if exists "products write" on public.products;
create policy "products write" on public.products for all using (true) with check (true);

-- Verify the policy exists
select policyname, cmd from pg_policies where tablename = 'products';
