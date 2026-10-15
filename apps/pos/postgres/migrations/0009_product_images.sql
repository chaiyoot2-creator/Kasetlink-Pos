-- Product photo: the image lives in FuseBase file storage (app bucket); the row keeps
-- only its display URL and attachment id (never the bytes).

ALTER TABLE public.products
  ADD COLUMN image_url TEXT,
  ADD COLUMN image_file_id TEXT;
