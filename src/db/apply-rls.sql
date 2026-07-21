-- ============================================================================
-- ShopMax RLS Migration
-- Run this in the Supabase SQL Editor to apply proper auth-based Row Level
-- Security policies across all user-scoped tables.
--
-- These policies replace the permissive "USING (true)" policies with real
-- user-isolated policies. The server also attempts to apply these on startup
-- via the exec_sql RPC, but if that RPC doesn't exist, run this manually.
-- ============================================================================

-- 1. Helper function: admin role check
-- SECURITY DEFINER lets this function bypass RLS on the profiles table so
-- that orders and other tables can verify admin status without recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 2. Carts — owner only
DROP POLICY IF EXISTS "carts all"   ON public.carts;
DROP POLICY IF EXISTS "carts owner" ON public.carts;
CREATE POLICY "carts owner" ON public.carts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Cart items — accessible only through cart ownership
DROP POLICY IF EXISTS "cart_items all"   ON public.cart_items;
DROP POLICY IF EXISTS "cart_items owner" ON public.cart_items;
CREATE POLICY "cart_items owner" ON public.cart_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.carts WHERE id = cart_id AND user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.carts WHERE id = cart_id AND user_id = auth.uid())
  );

-- 4. Orders — owner CRUD, admin SELECT
DROP POLICY IF EXISTS "orders all"   ON public.orders;
DROP POLICY IF EXISTS "orders owner" ON public.orders;
DROP POLICY IF EXISTS "orders admin" ON public.orders;
CREATE POLICY "orders owner" ON public.orders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "orders admin" ON public.orders
  FOR SELECT
  USING (public.is_admin());

-- 5. Products — public read (browsing, stock validation during cart add)
DROP POLICY IF EXISTS "products public" ON public.products;
CREATE POLICY "products public" ON public.products
  FOR SELECT
  USING (true);

-- 6. Coupons — public read (order validation uses anon client)
DROP POLICY IF EXISTS "coupons public" ON public.coupons;
CREATE POLICY "coupons public" ON public.coupons
  FOR SELECT
  USING (true);

-- 7. Profiles — owner CRUD, admin SELECT
DROP POLICY IF EXISTS "profiles all"   ON public.profiles;
DROP POLICY IF EXISTS "profiles owner" ON public.profiles;
DROP POLICY IF EXISTS "profiles admin" ON public.profiles;
CREATE POLICY "profiles owner" ON public.profiles
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles admin" ON public.profiles
  FOR SELECT
  USING (public.is_admin());
