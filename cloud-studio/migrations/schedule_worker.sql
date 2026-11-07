select cron.schedule('studio-visual-research','* * * * *',$job$
 select net.http_post(url:='https://sfheqjnxlkygjfohoybo.supabase.co/functions/v1/studio-visual-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-studio-worker',
 (select decrypted_secret from vault.decrypted_secrets where name='studio_worker_token')),
 body:='{}'::jsonb,timeout_milliseconds:=100000)
 where exists(select 1 from studio_core.jobs where kind='identify' and
 ((state='queued' and available_at<=now()) or (state='running' and lease_until<=now())));
$job$);

select cron.schedule('studio-photo-render','* * * * *',$job$
 select net.http_post(url:='https://sfheqjnxlkygjfohoybo.supabase.co/functions/v1/studio-render-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-studio-worker',
 (select decrypted_secret from vault.decrypted_secrets where name='studio_worker_token')),
 body:='{}'::jsonb,timeout_milliseconds:=120000)
 where exists(select 1 from studio_core.jobs where kind='render' and
 ((state='queued' and available_at<=now()) or (state='running' and lease_until<=now())));
$job$);
