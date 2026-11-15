-- drizzle/sql/onboarding_answers.sql
--
-- Onboarding V2: a queryable copy of each user's onboarding answers on their
-- own profiles row, so the founder dashboard can segment by
-- how they heard about FlipStart, goal, experience and what they want help
-- with, against paid conversion, activation and retention.
--
-- ✅ Safe to run any time, and more than once. Run it BEFORE the build with
--    onboarding V2 reaches users — until it exists, the app's write to this
--    column fails quietly (the answers are still kept in the account's
--    metadata and in the onboarding events), so nothing breaks, but those
--    users' answers won't be in this column.
--
-- What the app writes (snake_case, coded values — never display text):
--   {
--     "schema_version": 3,
--     "flow": "v2",
--     "primary_goal": "resell_profit" | "personal_finds" | "both",
--     "experience_level": "beginner" | "basic" | "experienced" | "regular_reseller",
--     "pain_points": ["item_identification", "valuation_uncertainty", ...],
--     "acquisition_source": "tiktok" | "instagram" | "youtube" | "app_store"
--                         | "facebook" | "reddit" | "friend" | "other" | null,
--     "acquisition_source_other": "optional free text, only for other",
--     "answered_at": "2026-11-14T19:30:00.000Z"
--   }
--
-- The app updates it the same way Edit Profile updates display_name: the
-- signed-in user, on their own row. No new policy is needed for that. It holds
-- preferences only; nothing that grants access or money reads it.

alter table public.profiles
  add column if not exists onboarding_answers jsonb;

comment on column public.profiles.onboarding_answers is
  'Onboarding V2 answers written by the app (schema_version 3). Self-reported preferences only.';