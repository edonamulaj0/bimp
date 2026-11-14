-- Marketing-site images generated once with Cloudinary from the committed model renders (apps/shared/site-images.ts).
CREATE TABLE site_images (
  key TEXT PRIMARY KEY,
  public_id TEXT,
  transformation TEXT NOT NULL,  -- regenerated when the configured transformation changes
  status TEXT NOT NULL,          -- pending | ready | failed
  error TEXT,
  updated_at INTEGER NOT NULL
);
