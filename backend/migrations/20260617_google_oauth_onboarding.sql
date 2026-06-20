-- Migration: Google OAuth sign-up with role selection.
--   * USER.onboarded distinguishes a finished account from a fresh OAuth shell.
--   * handle_new_user detects OAuth (no 'role' meta) -> onboarded=false, keeps the
--     Google avatar, and makes the placeholder username collision-safe.
--   * complete_oauth_signup lets a new OAuth user pick role + username exactly once.
--   * Sensitive USER columns are no longer client-updatable.

ALTER TABLE public."USER" ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_base text; v_username text;
begin
  v_base := coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1));
  v_username := v_base;
  if exists (select 1 from public."USER" where username = v_username) then
    v_username := v_base || '_' || left(new.id::text, 8);
  end if;
  insert into public."USER" (id, email, name, username, role, "avatarUrl", "socialLink", contact, onboarded, "createdAt")
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    v_username,
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    coalesce(new.raw_user_meta_data->>'avatarUrl', new.raw_user_meta_data->>'avatar_url'),
    nullif(new.raw_user_meta_data->>'telegram',''),
    nullif(new.raw_user_meta_data->>'phone',''),
    (new.raw_user_meta_data ? 'role'),  -- email signups send 'role'; OAuth users don't
    now()
  );
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.complete_oauth_signup(p_role text, p_username text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_name text := btrim(coalesce(p_username,''));
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  if p_role not in ('user','organiser') then return json_build_object('error','invalid_role'); end if;
  if v_name = '' then return json_build_object('error','username_required'); end if;
  begin
    update public."USER" set role=p_role, username=v_name, onboarded=true
      where id=v_uid and onboarded=false;
  exception when unique_violation then
    return json_build_object('error','username_taken');
  end;
  if not found then return json_build_object('error','already_onboarded'); end if;
  return json_build_object('status','ok');
end; $function$;
REVOKE EXECUTE ON FUNCTION public.complete_oauth_signup(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oauth_signup(text, text) TO authenticated;

REVOKE UPDATE (role, "walletBalance", email, "stripeCustomerId", "stripePaymentMethodId", "cardBrand", "cardLast4")
  ON public."USER" FROM authenticated;
