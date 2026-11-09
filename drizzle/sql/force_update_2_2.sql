-- drizzle/sql/force_update_2_2.sql
--
-- Makes every iPhone on a version older than 2.2 show "Update required"
-- (components/ForceUpdateGate.tsx) until it updates.
--
-- ⚠️  Run this ONLY AFTER 2.2 is approved AND live on the App Store
--     (check the App Store listing on your phone shows 2.2 and lets you
--     update). Run it earlier and every user is told to update to a version
--     they can't download yet — the whole app is blocked.
--
-- The table already exists (force_update_2_1_1.sql created it); this only
-- raises the minimum. Safe to run more than once.

update public.app_min_version
   set min_version = '2.2',
       store_url   = 'https://apps.apple.com/app/id6770193673',
       message     = 'This version of FlipStart is out of date. Update to keep scanning — the new version has bigger Scan Packs.',
       enabled     = true,
       updated_at  = now()
 where platform = 'ios';

-- Check it worked (should show min_version 2.2, enabled = true):
select platform, min_version, enabled, updated_at from public.app_min_version;

-- ── To undo (lets everyone back in at once) ─────────────────────────────────
--   update public.app_min_version set enabled = false where platform = 'ios';