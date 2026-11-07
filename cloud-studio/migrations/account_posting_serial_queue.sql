create or replace function public.studio_posting_claim(p_id uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c studio_core.posting_copies; s public.active_listings; a studio_core.posting_accounts; token text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into c from studio_core.posting_copies where id=p_id and owner_id=auth.uid() for update;
 if c.id is null or c.revision<>p_revision or c.state<>'prepared' then raise exception 'Refresh the queue; this product is not ready'; end if;
 select * into s from public.active_listings where id=c.source_id for share;
 if s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0 or studio_core.posting_digest(s)<>c.source_digest
 then raise exception 'Source changed or sold; refresh the queue' using errcode='40001'; end if;
 select * into a from studio_core.posting_accounts where id=c.account_id and owner_id=auth.uid() for update;
 if exists(select 1 from studio_core.posting_copies where account_id=c.account_id and owner_id=auth.uid() and id<>c.id and state in ('filling','filled'))
 then raise exception 'Finish the current destination draft before starting another'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 update studio_core.posting_copies set state='filling',transfer_hash=encode(extensions.digest(token,'sha256'),'hex'),
  transfer_expires=now()+interval '15 minutes',updated_at=now() where id=c.id;
 insert into studio_core.posting_events(copy_id,state) values(c.id,'filling');
 return jsonb_build_object('token',token,'id',c.id,'profile_id',a.profile_id,'account_label',a.label);
end $$;
