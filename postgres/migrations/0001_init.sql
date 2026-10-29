-- KasetLink POS — core schema (phase 2)
-- Single source of truth for stock = stock_lots. Every business action writes one
-- row to pos_events and every stock change writes stock_movements rows that
-- reference that event (event_id, terminal_id, zone_id, occurred_at).

CREATE TABLE public.shop_settings (
  org_id TEXT PRIMARY KEY DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  shop_name TEXT NOT NULL DEFAULT 'ร้านอาหารสัตว์',
  address TEXT,
  phone TEXT,
  tax_id TEXT,
  promptpay_id TEXT,
  receipt_footer TEXT,
  expiry_alert_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_alert_days >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'store' CHECK (kind IN ('store', 'warehouse')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX locations_org_id_idx ON public.locations (org_id);

CREATE TABLE public.terminals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  location_id UUID REFERENCES public.locations (id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX terminals_org_id_idx ON public.terminals (org_id);

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  price_retail NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_retail >= 0),
  price_wholesale NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_wholesale >= 0),
  price_member NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_member >= 0),
  avg_cost NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  reorder_point NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  track_expiry BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku)
);
CREATE INDEX products_org_id_idx ON public.products (org_id);
CREATE UNIQUE INDEX products_org_barcode_uidx ON public.products (org_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_org_name_idx ON public.products (org_id, name);

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  customer_type TEXT NOT NULL DEFAULT 'retail' CHECK (customer_type IN ('retail', 'wholesale', 'member')),
  credit_limit NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX customers_org_id_idx ON public.customers (org_id);

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  phone TEXT,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_org_id_idx ON public.suppliers (org_id);

-- Running document numbers per type and day (S = sale, GR = goods receipt, ...).
CREATE TABLE public.doc_counters (
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_type TEXT NOT NULL,
  period TEXT NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, doc_type, period)
);

-- Append-only business event log (AI Vision / integrations read from here).
CREATE TABLE public.pos_events (
  event_id UUID PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  event_type TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  source TEXT NOT NULL DEFAULT 'pos',
  ref_type TEXT,
  ref_id UUID,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX pos_events_org_id_idx ON public.pos_events (org_id);
CREATE INDEX pos_events_org_occurred_idx ON public.pos_events (org_id, occurred_at DESC);
CREATE INDEX pos_events_org_type_idx ON public.pos_events (org_id, event_type);
CREATE INDEX pos_events_org_zone_idx ON public.pos_events (org_id, zone_id, occurred_at DESC);

CREATE TABLE public.stock_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  product_id UUID NOT NULL REFERENCES public.products (id),
  location_id UUID NOT NULL REFERENCES public.locations (id),
  lot_no TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  last_unit_cost NUMERIC(16, 4) NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_lots_org_id_idx ON public.stock_lots (org_id);
CREATE UNIQUE INDEX stock_lots_identity_uidx ON public.stock_lots
  (org_id, product_id, location_id, lot_no, (COALESCE(expiry_date, DATE '9999-12-31')));
CREATE INDEX stock_lots_product_idx ON public.stock_lots (org_id, product_id, location_id);
CREATE INDEX stock_lots_expiry_idx ON public.stock_lots (org_id, expiry_date) WHERE qty > 0;

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  event_id UUID NOT NULL REFERENCES public.pos_events (event_id),
  terminal_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN
    ('sale', 'sale_void', 'receive', 'transfer_out', 'transfer_in', 'adjust')),
  product_id UUID NOT NULL REFERENCES public.products (id),
  location_id UUID NOT NULL REFERENCES public.locations (id),
  lot_id UUID REFERENCES public.stock_lots (id),
  lot_no TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  qty_change NUMERIC(14, 3) NOT NULL,
  unit_cost NUMERIC(16, 4) NOT NULL DEFAULT 0,
  ref_type TEXT NOT NULL,
  ref_id UUID NOT NULL,
  reason TEXT,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_org_id_idx ON public.stock_movements (org_id);
CREATE INDEX stock_movements_event_idx ON public.stock_movements (event_id);
CREATE INDEX stock_movements_product_idx ON public.stock_movements (org_id, product_id, occurred_at DESC);
CREATE INDEX stock_movements_ref_idx ON public.stock_movements (ref_type, ref_id);

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  bill_no TEXT NOT NULL,
  event_id UUID NOT NULL UNIQUE REFERENCES public.pos_events (event_id),
  terminal_id TEXT NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations (id),
  customer_id UUID REFERENCES public.customers (id),
  price_tier TEXT NOT NULL CHECK (price_tier IN ('retail', 'wholesale', 'member')),
  subtotal NUMERIC(14, 2) NOT NULL,
  line_discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  bill_discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total NUMERIC(14, 2) NOT NULL CHECK (total >= 0),
  cost_total NUMERIC(16, 4) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'promptpay', 'credit')),
  cash_received NUMERIC(14, 2),
  change_amount NUMERIC(14, 2),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  void_event_id UUID REFERENCES public.pos_events (event_id),
  note TEXT,
  sold_at TIMESTAMPTZ NOT NULL,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, bill_no)
);
CREATE INDEX sales_org_id_idx ON public.sales (org_id);
CREATE INDEX sales_org_sold_at_idx ON public.sales (org_id, sold_at DESC);
CREATE INDEX sales_customer_idx ON public.sales (org_id, customer_id);

CREATE TABLE public.sale_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  sale_id UUID NOT NULL REFERENCES public.sales (id),
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products (id),
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  line_discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) NOT NULL,
  bill_discount_share NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14, 2) NOT NULL,
  unit_cost NUMERIC(16, 4) NOT NULL,
  cost_total NUMERIC(16, 4) NOT NULL
);
CREATE INDEX sale_lines_org_id_idx ON public.sale_lines (org_id);
CREATE INDEX sale_lines_sale_idx ON public.sale_lines (sale_id);
CREATE INDEX sale_lines_product_idx ON public.sale_lines (org_id, product_id);

-- Accounts receivable ledger for credit sales (ขายเชื่อ). amount > 0 = debt, < 0 = payment.
CREATE TABLE public.ar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  customer_id UUID NOT NULL REFERENCES public.customers (id),
  event_id UUID NOT NULL REFERENCES public.pos_events (event_id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sale', 'payment', 'sale_void')),
  amount NUMERIC(14, 2) NOT NULL,
  payment_method TEXT,
  ref_id UUID,
  note TEXT,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ar_entries_org_id_idx ON public.ar_entries (org_id);
CREATE INDEX ar_entries_customer_idx ON public.ar_entries (org_id, customer_id, created_at DESC);

CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  po_no TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers (id),
  location_id UUID NOT NULL REFERENCES public.locations (id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'received', 'cancelled')),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  note TEXT,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, po_no)
);
CREATE INDEX purchase_orders_org_id_idx ON public.purchase_orders (org_id);
CREATE INDEX purchase_orders_status_idx ON public.purchase_orders (org_id, status);

CREATE TABLE public.po_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  po_id UUID NOT NULL REFERENCES public.purchase_orders (id),
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products (id),
  qty_ordered NUMERIC(14, 3) NOT NULL CHECK (qty_ordered > 0),
  qty_received NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost NUMERIC(16, 4) NOT NULL CHECK (unit_cost >= 0)
);
CREATE INDEX po_lines_org_id_idx ON public.po_lines (org_id);
CREATE INDEX po_lines_po_idx ON public.po_lines (po_id);

CREATE TABLE public.goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  receipt_no TEXT NOT NULL,
  event_id UUID NOT NULL UNIQUE REFERENCES public.pos_events (event_id),
  po_id UUID REFERENCES public.purchase_orders (id),
  supplier_id UUID REFERENCES public.suppliers (id),
  location_id UUID NOT NULL REFERENCES public.locations (id),
  terminal_id TEXT NOT NULL,
  supplier_invoice_no TEXT,
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  note TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, receipt_no)
);
CREATE INDEX goods_receipts_org_id_idx ON public.goods_receipts (org_id);
CREATE INDEX goods_receipts_po_idx ON public.goods_receipts (po_id);

CREATE TABLE public.goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  receipt_id UUID NOT NULL REFERENCES public.goods_receipts (id),
  po_line_id UUID REFERENCES public.po_lines (id),
  product_id UUID NOT NULL REFERENCES public.products (id),
  qty NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(16, 4) NOT NULL CHECK (unit_cost >= 0),
  lot_no TEXT NOT NULL DEFAULT '',
  expiry_date DATE
);
CREATE INDEX goods_receipt_lines_org_id_idx ON public.goods_receipt_lines (org_id);
CREATE INDEX goods_receipt_lines_receipt_idx ON public.goods_receipt_lines (receipt_id);

-- Header for transfers and adjustments; the lines live in stock_movements.
CREATE TABLE public.stock_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_no TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('transfer', 'adjustment')),
  event_id UUID NOT NULL UNIQUE REFERENCES public.pos_events (event_id),
  from_location_id UUID REFERENCES public.locations (id),
  to_location_id UUID REFERENCES public.locations (id),
  reason_code TEXT,
  note TEXT,
  terminal_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_no)
);
CREATE INDEX stock_documents_org_id_idx ON public.stock_documents (org_id);
CREATE INDEX stock_documents_org_type_idx ON public.stock_documents (org_id, doc_type, occurred_at DESC);
