-- Brands: a shop sells several feed companies, each with several brands.
-- Every brand belongs to exactly one supplier; products optionally reference a brand.

CREATE TABLE public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers (id),
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX brands_org_id_idx ON public.brands (org_id);
CREATE INDEX brands_supplier_idx ON public.brands (org_id, supplier_id);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands FORCE ROW LEVEL SECURITY;
CREATE POLICY brands_tenant ON public.brands FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.products ADD COLUMN brand_id UUID REFERENCES public.brands (id);
CREATE INDEX products_brand_idx ON public.products (org_id, brand_id);
