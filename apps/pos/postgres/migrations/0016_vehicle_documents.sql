-- Vehicle paperwork: voluntary insurance, compulsory insurance (พ.ร.บ.) and the yearly
-- registration tax, each with start / expiry dates and what it cost, so the shop can see
-- how many days are left on every truck and what keeping the fleet legal costs.

ALTER TABLE public.vehicles
  ADD COLUMN insurance_company TEXT,
  ADD COLUMN insurance_start DATE,
  ADD COLUMN insurance_expiry DATE,
  ADD COLUMN insurance_cost NUMERIC(12, 2) CHECK (insurance_cost IS NULL OR insurance_cost >= 0),
  ADD COLUMN act_company TEXT,
  ADD COLUMN act_start DATE,
  ADD COLUMN act_expiry DATE,
  ADD COLUMN act_cost NUMERIC(12, 2) CHECK (act_cost IS NULL OR act_cost >= 0),
  ADD COLUMN tax_expiry DATE,
  ADD COLUMN tax_cost NUMERIC(12, 2) CHECK (tax_cost IS NULL OR tax_cost >= 0);
