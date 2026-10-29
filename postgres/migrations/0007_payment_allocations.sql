-- Credit bill settlement: each debt payment gets a receipt number (RC202610-0001) and
-- records which bills it paid. A credit sale itself is a delivery note / invoice; the
-- receipt (ใบเสร็จรับเงิน) is issued when the money arrives.
-- Payments recorded before this migration have no allocation rows; the app settles
-- them against the oldest bills (first in, first out).

ALTER TABLE public.ar_entries
  ADD COLUMN receipt_no TEXT,
  ADD CONSTRAINT ar_entries_receipt_no_key UNIQUE (org_id, receipt_no);

CREATE TABLE public.ar_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  payment_id UUID NOT NULL REFERENCES public.ar_entries (id),
  sale_id UUID NOT NULL REFERENCES public.sales (id),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ar_allocations_org_id_idx ON public.ar_allocations (org_id);
CREATE INDEX ar_allocations_sale_idx ON public.ar_allocations (org_id, sale_id);
CREATE INDEX ar_allocations_payment_idx ON public.ar_allocations (payment_id);

ALTER TABLE public.ar_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY ar_allocations_read ON public.ar_allocations FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY ar_allocations_append ON public.ar_allocations FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
