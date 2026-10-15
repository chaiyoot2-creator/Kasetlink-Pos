-- Delivery routing: map pins (lat/lng) for shop locations and customers, product sack
-- weights, delivery vehicles, delivery orders (from POS bills or entered directly) and
-- planned trips with their stop order, distance and route line.

ALTER TABLE public.locations
  ADD COLUMN lat DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN address TEXT;

ALTER TABLE public.customers
  ADD COLUMN lat DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN map_note TEXT;

ALTER TABLE public.agency_customers
  ADD COLUMN lat DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN map_note TEXT;

-- Weight of one selling unit (sack). NULL: read from the name ("30 กก.") or category.
ALTER TABLE public.products
  ADD COLUMN weight_kg NUMERIC(10, 3) CHECK (weight_kg IS NULL OR weight_kg > 0);

CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  name TEXT NOT NULL,
  plate TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'pickup',
  min_load_kg NUMERIC(10, 1) NOT NULL DEFAULT 0 CHECK (min_load_kg >= 0),
  capacity_kg NUMERIC(10, 1) NOT NULL CHECK (capacity_kg > 0),
  cost_per_km NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (cost_per_km >= 0),
  driver_name TEXT,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_org_id_idx ON public.vehicles (org_id);

CREATE TABLE public.delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_no TEXT NOT NULL,
  delivery_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sale', 'agency')),
  sale_id UUID REFERENCES public.sales (id),
  customer_id UUID REFERENCES public.customers (id),
  agency_customer_id UUID REFERENCES public.agency_customers (id),
  recipient_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  lat DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  total_bags NUMERIC(14, 3) NOT NULL DEFAULT 0,
  total_weight_kg NUMERIC(14, 3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'planned', 'delivered', 'cancelled')),
  note TEXT,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_no)
);
CREATE INDEX delivery_orders_org_id_idx ON public.delivery_orders (org_id);
CREATE INDEX delivery_orders_org_date_idx ON public.delivery_orders (org_id, delivery_date, status);
CREATE UNIQUE INDEX delivery_orders_sale_uidx ON public.delivery_orders (org_id, sale_id) WHERE sale_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE public.delivery_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  order_id UUID NOT NULL REFERENCES public.delivery_orders (id),
  line_no INTEGER NOT NULL,
  product_id UUID REFERENCES public.products (id),
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
  unit_weight_kg NUMERIC(10, 3) NOT NULL CHECK (unit_weight_kg >= 0),
  weight_kg NUMERIC(14, 3) NOT NULL
);
CREATE INDEX delivery_order_lines_org_id_idx ON public.delivery_order_lines (org_id);
CREATE INDEX delivery_order_lines_order_idx ON public.delivery_order_lines (order_id);

CREATE TABLE public.delivery_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  doc_no TEXT NOT NULL,
  trip_date DATE NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles (id),
  vehicle_name TEXT NOT NULL,
  depot_location_id UUID NOT NULL REFERENCES public.locations (id),
  return_to_depot BOOLEAN NOT NULL DEFAULT true,
  total_weight_kg NUMERIC(14, 3) NOT NULL DEFAULT 0,
  total_bags NUMERIC(14, 3) NOT NULL DEFAULT 0,
  distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0,
  duration_min NUMERIC(10, 1) NOT NULL DEFAULT 0,
  distance_source TEXT NOT NULL DEFAULT 'estimate' CHECK (distance_source IN ('google', 'estimate')),
  route_polyline TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  note TEXT,
  created_by TEXT DEFAULT NULLIF(current_setting('app.user_id', true), ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_no)
);
CREATE INDEX delivery_trips_org_id_idx ON public.delivery_trips (org_id);
CREATE INDEX delivery_trips_org_date_idx ON public.delivery_trips (org_id, trip_date);

CREATE TABLE public.delivery_trip_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  trip_id UUID NOT NULL REFERENCES public.delivery_trips (id),
  seq INTEGER NOT NULL,
  order_id UUID NOT NULL REFERENCES public.delivery_orders (id),
  leg_km NUMERIC(10, 2) NOT NULL DEFAULT 0,
  leg_min NUMERIC(10, 1) NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ
);
CREATE INDEX delivery_trip_stops_org_id_idx ON public.delivery_trip_stops (org_id);
CREATE INDEX delivery_trip_stops_trip_idx ON public.delivery_trip_stops (trip_id);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicles_tenant ON public.vehicles FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_orders_tenant ON public.delivery_orders FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.delivery_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_order_lines_tenant ON public.delivery_order_lines FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.delivery_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_trips FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_trips_tenant ON public.delivery_trips FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.delivery_trip_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_trip_stops FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_trip_stops_tenant ON public.delivery_trip_stops FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
