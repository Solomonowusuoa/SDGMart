-- General feedback / complaints (not tied to an order) reuse issue_reports.
-- Run in Supabase → SQL Editor. Safe to re-run.
alter table issue_reports alter column order_id drop not null;
