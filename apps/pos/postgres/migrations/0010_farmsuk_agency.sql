-- Agency channel for บริษัท ฟาร์มสุข (เบทาโกร). The company owns the goods and bills the
-- customer; the shop only delivers and earns a monthly incentive (percent of the month's
-- sales at the company's standard price, by customer group) plus a per-sack transport fee
-- (by route). Kept apart from shop sales: no stock, no sales, no receivables.

CREATE TABLE public.agency_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  incentive_pct NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (incentive_pct >= 0 AND incentive_pct <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX agency_groups_org_id_idx ON public.agency_groups (org_id);

CREATE TABLE public.agency_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  rate_per_sack NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (rate_per_sack >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX agency_routes_org_id_idx ON public.agency_routes (org_id);

CREATE TABLE public.agency_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  code TEXT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'กระสอบ',
  std_price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (std_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX agency_products_org_id_idx ON public.agency_products (org_id);

CREATE TABLE public.agency_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  group_id UUID REFERENCES public.agency_groups (id),
  route_id UUID REFERENCES public.agency_routes (id),
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agency_customers_org_id_idx ON public.agency_customers (org_id);

-- One delivery (trip / company bill). Group, route, percent and rate are copied in so
-- later rate changes never rewrite past evidence.
CREATE TABLE public.agency_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_no TEXT NOT NULL,
  event_id UUID NOT NULL,
  terminal_id TEXT NOT NULL,
  delivered_on DATE NOT NULL,
  company_ref TEXT,
  customer_id UUID REFERENCES public.agency_customers (id),
  customer_name TEXT NOT NULL,
  group_id UUID REFERENCES public.agency_groups (id),
  group_name TEXT NOT NULL,
  incentive_pct NUMERIC(6, 3) NOT NULL,
  route_id UUID REFERENCES public.agency_routes (id),
  route_name TEXT NOT NULL,
  rate_per_sack NUMERIC(12, 2) NOT NULL,
  sacks NUMERIC(14, 3) NOT NULL DEFAULT 0,
  sales_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  incentive_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  transport_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_no),
  UNIQUE (org_id, event_id)
);
CREATE INDEX agency_deliveries_org_id_idx ON public.agency_deliveries (org_id);
CREATE INDEX agency_deliveries_org_date_idx ON public.agency_deliveries (org_id, delivered_on DESC);

CREATE TABLE public.agency_delivery_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  delivery_id UUID NOT NULL REFERENCES public.agency_deliveries (id),
  line_no INTEGER NOT NULL,
  product_id UUID REFERENCES public.agency_products (id),
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
  std_price NUMERIC(14, 2) NOT NULL CHECK (std_price >= 0),
  amount NUMERIC(14, 2) NOT NULL
);
CREATE INDEX agency_delivery_lines_org_id_idx ON public.agency_delivery_lines (org_id);
CREATE INDEX agency_delivery_lines_delivery_idx ON public.agency_delivery_lines (delivery_id);

-- Money the company transferred, recorded against the sales month it pays for.
CREATE TABLE public.agency_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  kind TEXT NOT NULL CHECK (kind IN ('incentive', 'transport', 'both')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  received_on DATE NOT NULL,
  reference TEXT,
  note TEXT,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agency_payments_org_id_idx ON public.agency_payments (org_id);
CREATE INDEX agency_payments_org_period_idx ON public.agency_payments (org_id, period);

ALTER TABLE public.agency_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_groups_tenant ON public.agency_groups FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_routes_tenant ON public.agency_routes FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_products FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_products_tenant ON public.agency_products FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_customers_tenant ON public.agency_customers FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_deliveries_tenant ON public.agency_deliveries FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_delivery_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_delivery_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_delivery_lines_tenant ON public.agency_delivery_lines FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_payments_tenant ON public.agency_payments FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
