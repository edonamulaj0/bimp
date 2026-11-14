-- The sheet as rendered for reading, known as soon as a drawing has been analysed: the canvas shows it while the
-- model is still being read. For a PDF with several pages, the page being read.
ALTER TABLE jobs ADD COLUMN render_sha TEXT;
