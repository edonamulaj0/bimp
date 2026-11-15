-- Which version of the pilot house an account has been given (apps/shared/house-plan.ts, a hash of the plan).
-- Null = not yet: the next time the account loads the app it gets the current house, added or updated.
ALTER TABLE users ADD COLUMN sample_version TEXT;
