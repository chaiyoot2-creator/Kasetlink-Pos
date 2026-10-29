-- Credit terms: each customer has a payment term in days; every credit bill gets a due date.
-- Outstanding per bill is derived first-in-first-out from the customer's payments, so the
-- bill-level view always adds up to customers.balance (older bills fall back to sold date + term).

ALTER TABLE public.customers
  ADD COLUMN credit_term_days INTEGER NOT NULL DEFAULT 30
    CONSTRAINT customers_credit_term_days_check CHECK (credit_term_days BETWEEN 0 AND 365);

ALTER TABLE public.sales ADD COLUMN due_date DATE;

CREATE INDEX sales_credit_idx ON public.sales (org_id, customer_id, sold_at) WHERE payment_method = 'credit';
