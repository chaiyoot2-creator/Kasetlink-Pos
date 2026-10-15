-- Quotations (ใบเสนอราคา QT202610-0001). Prices are fixed at quoting time; when the customer
-- agrees the quotation is loaded into the POS cart and becomes a normal bill. The bill's
-- save marks the quotation converted (same transaction), so it cannot be sold twice.

CREATE TABLE public.quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_no TEXT NOT NULL,
  quote_date DATE NOT NULL,
  valid_until DATE NOT NULL,
  customer_id UUID REFERENCES public.customers (id),
  customer_name TEXT NOT NULL,
  customer_code TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  price_level SMALLINT NOT NULL DEFAULT 1 CHECK (price_level BETWEEN 1 AND 5),
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  bill_discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'cancelled')),
  sale_id UUID REFERENCES public.sales (id),
  converted_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_no)
);
CREATE INDEX quotations_org_id_idx ON public.quotations (org_id);
CREATE INDEX quotations_org_date_idx ON public.quotations (org_id, quote_date DESC);

CREATE TABLE public.quotation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  quotation_id UUID NOT NULL REFERENCES public.quotations (id),
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products (id),
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  line_discount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_total NUMERIC(14, 2) NOT NULL,
  price_source TEXT
);
CREATE INDEX quotation_lines_org_id_idx ON public.quotation_lines (org_id);
CREATE INDEX quotation_lines_quotation_idx ON public.quotation_lines (quotation_id);

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations FORCE ROW LEVEL SECURITY;
CREATE POLICY quotations_tenant ON public.quotations FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY quotation_lines_tenant ON public.quotation_lines FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
