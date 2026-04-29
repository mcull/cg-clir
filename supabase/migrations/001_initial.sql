-- Creative Growth CLIR Digital Gallery
-- Initial schema migration

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE artists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  bio           TEXT,
  -- Optional override URL for the artist's official page on
  -- creativegrowth.org. Populated by scripts/sync-artist-external-urls.ts
  -- which matches our slugs against the public sitemap. When set, the
  -- artwork detail page links here (new tab) instead of the internal
  -- /artists/{slug} page.
  external_url  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_artists_slug ON artists(slug);

CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT,
  sort_order    INT DEFAULT 0,
  ai_suggested  BOOLEAN DEFAULT false,
  -- Discriminator for what kind of category this is. 'format' is the
  -- existing AI-suggested taxonomy (Drawings, Paintings, etc.); 'theme'
  -- is the controlled subject taxonomy added in 2026-04-23; 'medium' is
  -- the normalized material taxonomy added in 2026-04-25.
  kind          TEXT CHECK (kind IN ('format', 'theme', 'medium')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE artworks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id         UUID REFERENCES artists(id),
  title             TEXT NOT NULL,
  date_created      TEXT,
  medium            TEXT,
  height            NUMERIC,
  width             NUMERIC,
  depth             NUMERIC,
  inventory_number  TEXT UNIQUE,

  -- Image
  image_url         TEXT,
  image_original    TEXT,

  -- Accessibility alt text. alt_text_long is for <img alt> on the artwork
  -- detail page; alt_text is the short form for grid pages.
  alt_text          TEXT,
  alt_text_long     TEXT,
  description_origin TEXT CHECK (description_origin IN ('human', 'ai')),
  sku               TEXT,
  decade            TEXT,

  -- Metadata
  tags              TEXT[],
  genre             TEXT,
  notes             TEXT,
  on_website        BOOLEAN DEFAULT true,
  sort_order        INT DEFAULT 0,

  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_artworks_artist ON artworks(artist_id);
CREATE INDEX idx_artworks_tags ON artworks USING GIN(tags);
CREATE INDEX idx_artworks_inventory ON artworks(inventory_number);
CREATE INDEX idx_artworks_sku ON artworks(sku);
CREATE INDEX idx_artworks_decade ON artworks(decade);

CREATE TABLE artwork_categories (
  artwork_id   UUID REFERENCES artworks(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (artwork_id, category_id)
);

CREATE TABLE download_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id   UUID REFERENCES artworks(id),
  ip_hash      TEXT,
  user_agent   TEXT,
  referrer     TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_downloads_artwork ON download_events(artwork_id);
CREATE INDEX idx_downloads_date ON download_events(created_at);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artists_updated_at
  BEFORE UPDATE ON artists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER artworks_updated_at
  BEFORE UPDATE ON artworks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE artworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE artwork_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_events ENABLE ROW LEVEL SECURITY;

-- Public read access (anon)
CREATE POLICY "Public can view artists"
  ON artists FOR SELECT
  USING (true);

CREATE POLICY "Public can view artworks on website"
  ON artworks FOR SELECT
  USING (on_website = true);

CREATE POLICY "Public can view categories"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "Public can view artwork_categories"
  ON artwork_categories FOR SELECT
  USING (true);

-- Download events: anyone can insert (public downloads)
CREATE POLICY "Anyone can log downloads"
  ON download_events FOR INSERT
  WITH CHECK (true);

-- Admin full access (authenticated users with @creativegrowth.org email)
-- Note: In dev mode with AUTH_BYPASS=true, we use the service role key
-- which bypasses RLS entirely. These policies apply in production.

CREATE POLICY "Admins can manage artists"
  ON artists FOR ALL
  USING (
    auth.jwt() ->> 'email' LIKE '%@creativegrowth.org'
  );

CREATE POLICY "Admins can manage artworks"
  ON artworks FOR ALL
  USING (
    auth.jwt() ->> 'email' LIKE '%@creativegrowth.org'
  );

CREATE POLICY "Admins can manage categories"
  ON categories FOR ALL
  USING (
    auth.jwt() ->> 'email' LIKE '%@creativegrowth.org'
  );

CREATE POLICY "Admins can manage artwork_categories"
  ON artwork_categories FOR ALL
  USING (
    auth.jwt() ->> 'email' LIKE '%@creativegrowth.org'
  );

CREATE POLICY "Admins can view download events"
  ON download_events FOR SELECT
  USING (
    auth.jwt() ->> 'email' LIKE '%@creativegrowth.org'
  );

-- ============================================================
-- FULL-TEXT SEARCH
-- ============================================================

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(medium, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(alt_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(alt_text_long, '')), 'D')
  ) STORED;

CREATE INDEX idx_artworks_fts ON artworks USING GIN(fts);
