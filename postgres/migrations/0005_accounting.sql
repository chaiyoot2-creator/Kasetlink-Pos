-- Accounting hand-off: full tax invoices (ใบกำกับภาษีเต็มรูป) for selected bills.
-- Every bill stays in the books; `for_accounting` only marks which bills get a full
-- invoice and go to the accounting office. Invoice numbers are a separate gap-free
-- running sequence assigned at issue time; an issued invoice is cancelled only by
-- voiding its bill.

ALTER TABLE public.shop_settings
  ADD COLUMN vat_registered BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 7 CONSTRAINT shop_settings_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate < 100),
  ADD COLUMN branch_code TEXT NOT NULL DEFAULT '00000';

ALTER TABLE public.customers
  ADD COLUMN tax_id TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN branch_code TEXT,
  ADD COLUMN send_to_accounting BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.sales
  ADD COLUMN for_accounting BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN tax_invoice_no TEXT,
  ADD COLUMN tax_invoice_at TIMESTAMPTZ,
  ADD COLUMN vat_rate NUMERIC(5, 2),
  ADD COLUMN vat_amount NUMERIC(14, 2),
  -- Buyer details frozen at issue time so the issued document never changes.
  ADD COLUMN buyer JSONB,
  ADD COLUMN accounting_sent_at TIMESTAMPTZ,
  ADD CONSTRAINT sales_tax_invoice_no_key UNIQUE (org_id, tax_invoice_no);

CREATE INDEX sales_accounting_idx ON public.sales (org_id, for_accounting, sold_at DESC);
