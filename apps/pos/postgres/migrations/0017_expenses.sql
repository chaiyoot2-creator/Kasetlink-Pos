-- Business expenses entered by staff (fuel, repairs, electricity, rent, wages …), grouped
-- by category and optionally linked to a delivery vehicle so each vehicle shows what it
-- costs to run. client_ref makes a double-tapped "save" record the expense only once.

CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  -- Expenses in this category must name a vehicle (fuel, repairs …).
  is_vehicle BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX expense_categories_org_id_idx ON public.expense_categories (org_id);

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  client_ref UUID NOT NULL,
  expense_date DATE NOT NULL,
  category_id UUID NOT NULL REFERENCES public.expense_categories (id),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  vendor TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'transfer', 'card', 'other')),
  vehicle_id UUID REFERENCES public.vehicles (id),
  note TEXT,
  created_by UUID,
  created_by_name TEXT,
  updated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_ref)
);
CREATE INDEX expenses_org_date_idx ON public.expenses (org_id, expense_date);
CREATE INDEX expenses_org_vehicle_idx ON public.expenses (org_id, vehicle_id, expense_date);
CREATE INDEX expenses_org_category_idx ON public.expenses (org_id, category_id);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_categories_tenant ON public.expense_categories FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY expenses_tenant ON public.expenses FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
