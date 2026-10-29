-- Five customer price levels (names configurable per shop) plus per-customer fixed prices.
-- Existing data is converted in place: retail/wholesale/member -> levels 1/2/3.
-- Pricing at the POS: customer fixed price -> product price of the customer's level -> level 1.

-- Products: price_retail/wholesale/member become levels 1..3, add levels 4..5 (0 = not set).
ALTER TABLE public.products RENAME COLUMN price_retail TO price_l1;
ALTER TABLE public.products RENAME COLUMN price_wholesale TO price_l2;
ALTER TABLE public.products RENAME COLUMN price_member TO price_l3;
ALTER TABLE public.products RENAME CONSTRAINT products_price_retail_check TO products_price_l1_check;
ALTER TABLE public.products RENAME CONSTRAINT products_price_wholesale_check TO products_price_l2_check;
ALTER TABLE public.products RENAME CONSTRAINT products_price_member_check TO products_price_l3_check;
ALTER TABLE public.products
  ADD COLUMN price_l4 NUMERIC(14, 2) NOT NULL DEFAULT 0 CONSTRAINT products_price_l4_check CHECK (price_l4 >= 0),
  ADD COLUMN price_l5 NUMERIC(14, 2) NOT NULL DEFAULT 0 CONSTRAINT products_price_l5_check CHECK (price_l5 >= 0);

-- Customers: customer_type text -> price_level 1..5.
ALTER TABLE public.customers DROP CONSTRAINT customers_customer_type_check;
ALTER TABLE public.customers ALTER COLUMN customer_type DROP DEFAULT;
ALTER TABLE public.customers ALTER COLUMN customer_type TYPE SMALLINT
  USING (CASE customer_type WHEN 'wholesale' THEN 2 WHEN 'member' THEN 3 ELSE 1 END);
ALTER TABLE public.customers RENAME COLUMN customer_type TO price_level;
ALTER TABLE public.customers ALTER COLUMN price_level SET DEFAULT 1;
ALTER TABLE public.customers ADD CONSTRAINT customers_price_level_check CHECK (price_level BETWEEN 1 AND 5);

-- Sales: price_tier text -> price_level 1..5 (history keeps its level).
ALTER TABLE public.sales DROP CONSTRAINT sales_price_tier_check;
ALTER TABLE public.sales ALTER COLUMN price_tier TYPE SMALLINT
  USING (CASE price_tier WHEN 'wholesale' THEN 2 WHEN 'member' THEN 3 ELSE 1 END);
ALTER TABLE public.sales RENAME COLUMN price_tier TO price_level;
ALTER TABLE public.sales ADD CONSTRAINT sales_price_level_check CHECK (price_level BETWEEN 1 AND 5);

-- Where each sold line's price came from: fixed | level | fallback | manual.
ALTER TABLE public.sale_lines ADD COLUMN price_source TEXT;

-- Level names shown in the UI.
ALTER TABLE public.shop_settings
  ADD COLUMN price_level_names TEXT[] NOT NULL DEFAULT ARRAY['ปลีก', 'ส่ง', 'สมาชิก', 'ส่งพิเศษ', 'ตัวแทน'];

-- Fixed prices for specific customers.
CREATE TABLE public.customer_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  customer_id UUID NOT NULL REFERENCES public.customers (id),
  product_id UUID NOT NULL REFERENCES public.products (id),
  price NUMERIC(14, 2) NOT NULL CHECK (price >= 0),
  note TEXT,
  updated_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, customer_id, product_id)
);
CREATE INDEX customer_prices_org_id_idx ON public.customer_prices (org_id);
CREATE INDEX customer_prices_product_idx ON public.customer_prices (org_id, product_id);

ALTER TABLE public.customer_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_prices_tenant ON public.customer_prices FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
