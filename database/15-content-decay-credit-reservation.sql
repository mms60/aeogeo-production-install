-- One report credit per buyer, guaranteed by the database.
--
-- A credit used to be recorded only when Stripe confirmed the payment, so two
-- tabs could each look for an open credit, find none, and both open a payment.
-- The credit is now reserved before Stripe is called, and this partial unique
-- index is what makes "at most one report per buyer" true even when both
-- requests arrive at the same instant: the second insert is refused, so the
-- loser answers with the winner's credit instead of starting another payment.

-- 'pending' is a checkout that exists but has not been paid; 'expired' is an
-- abandoned one that can no longer be paid. The table shipped with a named
-- check constraint that allowed only the original four states. Postgres
-- rewrites IN (...) into "= ANY (ARRAY[...])", so it is dropped by name.
alter table public.content_decay_report_credits
  drop constraint if exists content_decay_report_credits_status_check;

alter table public.content_decay_report_credits
  add constraint content_decay_report_credits_status_check
  check (status in ('pending', 'open', 'claimed', 'refunded', 'revoked', 'expired'));

-- The reservation is written before Stripe has returned a session.
alter table public.content_decay_report_credits
  alter column stripe_session_id drop not null;

-- Where to send a buyer who already has an unpaid checkout, so a second tab
-- resumes the same payment instead of starting one.
alter table public.content_decay_report_credits
  add column if not exists checkout_url text;

create unique index if not exists content_decay_report_credits_one_open_idx
  on public.content_decay_report_credits (user_id, environment)
  where status in ('pending', 'open');
