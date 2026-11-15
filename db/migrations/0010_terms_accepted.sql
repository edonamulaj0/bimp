-- Which version of the Terms of Service and Privacy Policy an account accepted at sign-up, and when.
-- Accounts created before this have neither: they signed up before the notice was shown.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
