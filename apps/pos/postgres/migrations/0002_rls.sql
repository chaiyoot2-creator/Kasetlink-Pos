-- Tenant isolation: every row belongs to the org in the Gate auth context.
-- pos_events and stock_movements are append-only (no UPDATE / DELETE policies).

ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_settings_tenant ON public.shop_settings FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant ON public.locations FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminals FORCE ROW LEVEL SECURITY;
CREATE POLICY terminals_tenant ON public.terminals FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
CREATE POLICY products_tenant ON public.products FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_tenant ON public.customers FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_tenant ON public.suppliers FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.doc_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_counters_tenant ON public.doc_counters FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.pos_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_events FORCE ROW LEVEL SECURITY;
CREATE POLICY pos_events_read ON public.pos_events FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY pos_events_append ON public.pos_events FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_lots_tenant ON public.stock_lots FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_read ON public.stock_movements FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY stock_movements_append ON public.stock_movements FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_tenant ON public.sales FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_lines_tenant ON public.sale_lines FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.ar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY ar_entries_read ON public.ar_entries FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY ar_entries_append ON public.ar_entries FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_tenant ON public.purchase_orders FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY po_lines_tenant ON public.po_lines FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY goods_receipts_tenant ON public.goods_receipts FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY goods_receipt_lines_tenant ON public.goods_receipt_lines FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.stock_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_documents_tenant ON public.stock_documents FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
