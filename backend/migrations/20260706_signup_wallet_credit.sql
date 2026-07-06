-- Migration: first-time signup wallet credit.
-- New users and organisers receive $20 directly in their in-app wallet balance.

CREATE OR REPLACE FUNCTION public.grant_signup_wallet_credit(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
begin
  if p_user_id is null then return; end if;

  if exists (
    select 1 from public."WALLET_TRANSACTIONS"
    where "userId" = p_user_id and type = 'signup_bonus'
  ) then
    return;
  end if;

  update public."USER"
    set "walletBalance" = coalesce("walletBalance", 0) + 20
    where id = p_user_id
      and coalesce("walletBalance", 0) = 0
    returning "walletBalance" into v_balance;

  if found then
    insert into public."WALLET_TRANSACTIONS"("userId", type, source, amount, "balanceAfter")
    values (p_user_id, 'signup_bonus', 'system', 20, v_balance);
  end if;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_signup_wallet_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_signup_wallet_credit(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_signup_identity(
  p_username text,
  p_role text,
  p_university text DEFAULT NULL,
  p_member_type text DEFAULT NULL,
  p_org_id text DEFAULT NULL,
  p_current_user_id uuid DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_username, ''));
  v_univ text := nullif(btrim(coalesce(p_university, '')), '');
  v_type text := nullif(btrim(coalesce(p_member_type, '')), '');
  v_id text := nullif(btrim(coalesce(p_org_id, '')), '');
begin
  if p_role not in ('user', 'organiser') then return json_build_object('error', 'invalid_role'); end if;
  if v_name = '' then return json_build_object('error', 'username_required'); end if;

  if exists (
    select 1 from public."USER"
    where lower(username) = lower(v_name)
      and (p_current_user_id is null or id <> p_current_user_id)
  ) then
    return json_build_object('error', 'username_taken');
  end if;

  if p_role = 'organiser' then
    if v_univ is null or v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then return json_build_object('error','invalid_university'); end if;
    if v_type not in ('student','instructor','professor') then return json_build_object('error','invalid_member_type'); end if;
    if v_type = 'student' and (v_id is null or v_id !~ '^[A-Za-z][0-9]{8}[A-Za-z]$') then return json_build_object('error','invalid_matric'); end if;
    if v_type in ('instructor','professor') and (v_id is null or v_id !~ '^[0-9]{9}$') then return json_build_object('error','invalid_staff_id'); end if;
    if exists (
      select 1 from public."USER"
      where lower("orgId") = lower(v_id)
        and (p_current_user_id is null or id <> p_current_user_id)
    ) then
      return json_build_object('error', 'org_id_taken');
    end if;
  else
    if v_univ is not null and v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then return json_build_object('error','invalid_university'); end if;
  end if;

  return json_build_object('status', 'ok');
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.validate_signup_identity(text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_signup_identity(text, text, text, text, text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.email
  from public."USER" u
  where u.username = btrim(coalesce(p_username, ''))
  limit 1
$function$;

REVOKE EXECUTE ON FUNCTION public.email_for_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_base text;
  v_username text;
  v_role text;
  v_validation json;
begin
  v_base := btrim(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)));
  v_role := coalesce(new.raw_user_meta_data->>'role', 'user');
  v_username := v_base;

  if new.raw_user_meta_data ? 'role' and v_role in ('user', 'organiser') then
    v_validation := public.validate_signup_identity(
      v_base,
      v_role,
      new.raw_user_meta_data->>'university',
      new.raw_user_meta_data->>'memberType',
      new.raw_user_meta_data->>'orgId',
      null
    );
    if (v_validation->>'error') is not null then
      raise exception '%', v_validation->>'error';
    end if;
  elsif exists (select 1 from public."USER" where username = v_username) then
    -- OAuth shell users have not chosen a username yet, so keep their temporary
    -- profile unique until complete_oauth_signup validates the final choice.
    v_username := v_base || '_' || left(new.id::text, 8);
  end if;

  insert into public."USER" (id, email, name, username, role, "avatarUrl", "socialLink", contact, onboarded,
                             university, "memberType", "orgId", "walletBalance", "createdAt")
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    v_username,
    v_role,
    coalesce(new.raw_user_meta_data->>'avatarUrl', new.raw_user_meta_data->>'avatar_url'),
    nullif(new.raw_user_meta_data->>'telegram',''),
    nullif(new.raw_user_meta_data->>'phone',''),
    (new.raw_user_meta_data ? 'role'),
    nullif(new.raw_user_meta_data->>'university',''),
    nullif(new.raw_user_meta_data->>'memberType',''),
    nullif(new.raw_user_meta_data->>'orgId',''),
    case when (new.raw_user_meta_data ? 'role') and v_role in ('user', 'organiser') then 20 else 0 end,
    now()
  );

  if (new.raw_user_meta_data ? 'role') and v_role in ('user', 'organiser') then
    insert into public."WALLET_TRANSACTIONS"("userId", type, source, amount, "balanceAfter")
    values (new.id, 'signup_bonus', 'system', 20, 20);
  end if;

  return new;
end;
$function$;

-- NOTE: body kept identical to the live function (7 universities incl. SIM;
-- attendees may keep an optional university) — the ONLY addition is the
-- grant_signup_wallet_credit call before the final return.
CREATE OR REPLACE FUNCTION public.complete_oauth_signup(
  p_role text, p_username text,
  p_university text DEFAULT NULL, p_member_type text DEFAULT NULL, p_org_id text DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_name text := btrim(coalesce(p_username,''));
  v_univ text := nullif(btrim(coalesce(p_university,'')),'');
  v_type text := nullif(btrim(coalesce(p_member_type,'')),'');
  v_id   text := nullif(btrim(coalesce(p_org_id,'')),'');
  v_validation json;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  v_validation := public.validate_signup_identity(p_username, p_role, p_university, p_member_type, p_org_id, v_uid);
  if (v_validation->>'error') is not null then return v_validation; end if;
  if p_role = 'organiser' then
    if v_univ is null or v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then return json_build_object('error','invalid_university'); end if;
    if v_type not in ('student','instructor','professor') then return json_build_object('error','invalid_member_type'); end if;
    if v_type = 'student' and (v_id is null or v_id !~ '^[A-Za-z][0-9]{8}[A-Za-z]$') then return json_build_object('error','invalid_matric'); end if;
    if v_type in ('instructor','professor') and (v_id is null or v_id !~ '^[0-9]{9}$') then return json_build_object('error','invalid_staff_id'); end if;
  else
    -- Attendees: university optional (NULL = "not enrolled"); no member type / ID.
    if v_univ is not null and v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then return json_build_object('error','invalid_university'); end if;
    v_type := null; v_id := null;
  end if;
  begin
    update public."USER"
      set role = p_role, username = v_name, onboarded = true,
          university = v_univ, "memberType" = v_type, "orgId" = v_id
      where id = v_uid and onboarded = false;
  exception when unique_violation then
    return json_build_object('error', case when v_id is not null then 'org_id_taken' else 'username_taken' end);
  end;
  if not found then return json_build_object('error','already_onboarded'); end if;

  perform public.grant_signup_wallet_credit(v_uid);

  return json_build_object('status','ok');
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_oauth_signup(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oauth_signup(text, text, text, text, text) TO authenticated;
