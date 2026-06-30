-- Creative Growth CLIR — multi-image artworks
-- One-to-many artwork→image with a single primary, plus a trigger that
-- mirrors the primary image onto artworks.{image_url,image_original,alt_text}
-- so existing grid queries and the FTS index keep working unchanged.

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE artwork_images (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id         UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  image_url          TEXT,
  image_original     TEXT,
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  sort_order         INT NOT NULL DEFAULT 0,
  -- Per-image short description: drives <img alt> and the visible caption.
  short_description  TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_artwork_images_artwork ON artwork_images(artwork_id);
-- Exactly one primary per artwork.
CREATE UNIQUE INDEX idx_artwork_images_one_primary
  ON artwork_images(artwork_id) WHERE is_primary;

CREATE TRIGGER artwork_images_updated_at
  BEFORE UPDATE ON artwork_images
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PRIMARY-IMAGE SYNC TRIGGER
-- ============================================================
-- After any change, recompute the parent artwork's denormalized primary
-- cache. On DELETE of the primary, auto-promote the lowest-sorted survivor.
CREATE OR REPLACE FUNCTION sync_primary_image()
RETURNS TRIGGER AS $$
DECLARE
  target_artwork UUID := COALESCE(NEW.artwork_id, OLD.artwork_id);
  primary_row    artwork_images%ROWTYPE;
BEGIN
  SELECT * INTO primary_row
    FROM artwork_images
    WHERE artwork_id = target_artwork AND is_primary
    LIMIT 1;

  -- No primary left (e.g. primary was deleted): promote lowest sort_order.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN
    UPDATE artwork_images
      SET is_primary = true
      WHERE id = (
        SELECT id FROM artwork_images
          WHERE artwork_id = target_artwork
          ORDER BY sort_order ASC, created_at ASC
          LIMIT 1
      );
    -- The UPDATE above re-fires this trigger and sets the cache; we're done.
    RETURN NULL;
  END IF;

  IF FOUND THEN
    UPDATE artworks SET
      image_url      = primary_row.image_url,
      image_original = primary_row.image_original,
      alt_text       = primary_row.short_description
    WHERE id = target_artwork;
  ELSE
    -- Artwork has no images at all.
    UPDATE artworks SET image_url = NULL, image_original = NULL
      WHERE id = target_artwork;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_primary_image
  AFTER INSERT OR UPDATE OR DELETE ON artwork_images
  FOR EACH ROW EXECUTE FUNCTION sync_primary_image();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE artwork_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view images of published artworks"
  ON artwork_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM artworks a
      WHERE a.id = artwork_images.artwork_id AND a.on_website = true
    )
  );

CREATE POLICY "Admins can manage artwork_images"
  ON artwork_images FOR ALL
  USING (auth.jwt() ->> 'email' LIKE '%@creativegrowth.org');

-- ============================================================
-- BACKFILL — one primary image row per existing artwork
-- ============================================================
INSERT INTO artwork_images (artwork_id, image_url, image_original, is_primary, sort_order, short_description)
SELECT a.id, a.image_url, a.image_original, true, 0, a.alt_text
  FROM artworks a
  WHERE a.image_url IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM artwork_images i WHERE i.artwork_id = a.id);
