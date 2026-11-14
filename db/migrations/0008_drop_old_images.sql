-- The marketing site stopped using generated images long ago: its table goes.
DROP TABLE IF EXISTS site_images;
-- The visuals table is still used (presentation images are now made from the 2D plan), so it stays; the rows in it
-- are images of the removed 3D view, most of them broken by the comma bug in their prompts. They are cleared.
-- The files themselves stay in the Cloudinary account.
DELETE FROM visuals;
