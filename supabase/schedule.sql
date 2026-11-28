-- Automatic results every 5 minutes on Saturday afternoons, run by Supabase itself
-- (more reliable than GitHub's schedules, which are often skipped on busy Saturday afternoons).
-- Paste into Supabase > SQL Editor > New query, then Run. Safe to run again.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname = 'family-picks-results';

-- Times are UTC: 14:00-18:55 covers 3pm-6pm UK in both winter and summer.
select cron.schedule(
  'family-picks-results',
  '*/5 14-18 * * 6',
  $$ select net.http_post(
       url := 'https://ocofvhvilspvibnkyumg.supabase.co/functions/v1/update-results',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"source": "cron"}'::jsonb
     ) $$
);
