-- ฟาร์มสุข deliveries filled from the shop's own stock: the stock leaves now (agency_lend)
-- and the company replaces the same product later (agency_return). agency_loan_entries is
-- the per-product ledger: + lent, - returned / voided; the sum is what the company owes.

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN
  ('sale', 'sale_void', 'receive', 'transfer_out', 'transfer_in', 'adjust', 'agency_lend', 'agency_lend_void', 'agency_return'));

ALTER TABLE public.agency_products
  ADD COLUMN shop_product_id UUID REFERENCES public.products (id);

ALTER TABLE public.agency_deliveries
  ADD COLUMN stock_location_id UUID REFERENCES public.locations (id),
  ADD COLUMN lent_qty NUMERIC(14, 3) NOT NULL DEFAULT 0;

ALTER TABLE public.agency_delivery_lines
  ADD COLUMN shop_product_id UUID REFERENCES public.products (id),
  ADD COLUMN unit_cost NUMERIC(16, 4) NOT NULL DEFAULT 0;

-- Replacement goods received from ฟาร์มสุข (FR202610-0001).
CREATE TABLE public.agency_stock_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_no TEXT NOT NULL,
  event_id UUID NOT NULL,
  terminal_id TEXT NOT NULL,
  received_on DATE NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations (id),
  company_ref TEXT,
  note TEXT,
  total_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_no),
  UNIQUE (org_id, event_id)
);
CREATE INDEX agency_stock_returns_org_id_idx ON public.agency_stock_returns (org_id);

CREATE TABLE public.agency_loan_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('lend', 'lend_void', 'return')),
  product_id UUID NOT NULL REFERENCES public.products (id),
  qty NUMERIC(14, 3) NOT NULL CHECK (qty <> 0),
  unit_cost NUMERIC(16, 4) NOT NULL DEFAULT 0,
  delivery_id UUID REFERENCES public.agency_deliveries (id),
  return_id UUID REFERENCES public.agency_stock_returns (id),
  event_id UUID NOT NULL,
  occurred_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agency_loan_entries_org_id_idx ON public.agency_loan_entries (org_id);
CREATE INDEX agency_loan_entries_product_idx ON public.agency_loan_entries (org_id, product_id);

ALTER TABLE public.agency_stock_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_stock_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_stock_returns_read ON public.agency_stock_returns FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY agency_stock_returns_append ON public.agency_stock_returns FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.agency_loan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_loan_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_loan_entries_read ON public.agency_loan_entries FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY agency_loan_entries_append ON public.agency_loan_entries FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
