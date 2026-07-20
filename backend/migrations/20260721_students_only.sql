-- ── Students only ────────────────────────────────────────────────────────────
-- party.fun is now exclusively for CURRENT UNIVERSITY STUDENTS. Instructors and
-- professors are gone, so `memberType` (student | instructor | professor) has no
-- meaning left, and `orgId` is always a matriculation number — rename it to say so.
--
-- Every account (attendee AND organiser) must now carry a university and a
-- matriculation number matching ^[A-Za-z][0-9]{8}[A-Za-z]$. That regex already
-- existed here, but only on the `memberType = 'student'` branch; this makes it
-- universal and deletes the 9-digit staff-ID branch.
--
-- EXISTING ROWS ARE NOT DELETED AND NOT INTERRUPTED. Accounts without a usable
-- matriculation number (old professor staff IDs, attendees who never supplied one)
-- are BACKFILLED with a generated one, and accounts with no university default to
-- SMU — so every existing account stays onboarded and nobody is bounced back through
-- setup. All events, bookings and tickets are untouched.
--
-- The column stays NULLABLE on purpose: the Google OAuth flow inserts a shell USER
-- row via handle_new_user BEFORE the person picks anything, so a NULL matriculation
-- number is a legitimate transient state on every OAuth signup.
--
-- Safe to run more than once.

-- ── 1. Rename the column and its unique index ────────────────────────────────
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'USER' AND column_name = 'orgId'
  ) THEN
    ALTER TABLE public."USER" RENAME COLUMN "orgId" TO "matricNumber";
  END IF;
END $do$;
ALTER INDEX IF EXISTS user_org_id_unique RENAME TO user_matric_unique;

-- One matriculation number = exactly one account (a student cannot hold both an
-- attendee and an organiser account). Recreated defensively in case the rename above
-- found no index to rename.
CREATE UNIQUE INDEX IF NOT EXISTS user_matric_unique
  ON public."USER" ("matricNumber") WHERE "matricNumber" IS NOT NULL;

-- ── 2. Drop memberType (takes its CHECK constraint with it) ──────────────────
ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_member_type_check;
ALTER TABLE public."USER" DROP COLUMN IF EXISTS "memberType";

-- ── 3. Repair existing rows BEFORE the new constraints are added ─────────────
-- Old professor staff IDs are 9 digits and can never satisfy the student format.
UPDATE public."USER"
   SET "matricNumber" = NULL
 WHERE "matricNumber" IS NOT NULL
   AND "matricNumber" !~ '^[A-Za-z][0-9]{8}[A-Za-z]$';

-- Generated numbers are drawn from a sequence so they are unique by construction —
-- the global unique index below would reject a collision, and random generation can
-- collide. The Z…Z shape (Z00000001Z, Z00000002Z, …) marks them as system-generated:
--   select * from public."USER" where "matricNumber" ~ '^Z[0-9]{8}Z$';
CREATE SEQUENCE IF NOT EXISTS public.user_backfill_matric_seq;

-- Backfill rather than gate: these accounts carry on uninterrupted.
UPDATE public."USER"
   SET "matricNumber" = 'Z' || lpad(nextval('public.user_backfill_matric_seq')::text, 8, '0') || 'Z'
 WHERE "matricNumber" IS NULL;

-- user_student_membership_check below requires a university for every onboarded
-- account. Rather than send these accounts back through FinishSignup, default them
-- to SMU so nobody is interrupted. NOTE this is a guess: it only affects attendees
-- who previously chose "I'm not enrolled into a university", and it decides which
-- university-restricted events they can join — they can correct it once from
-- Settings (the one-time university change).
UPDATE public."USER"
   SET university = 'SMU'
 WHERE university IS NULL;

-- ── 4. Constraints ───────────────────────────────────────────────────────────
ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_org_id_format_check;
ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_matric_format_check;
-- NULL stays legal on purpose: a force-completed user sits at NULL until they finish.
-- "must have one" is enforced by the onboarded constraint below, not by NOT NULL.
ALTER TABLE public."USER" ADD CONSTRAINT user_matric_format_check
  CHECK ("matricNumber" IS NULL OR "matricNumber" ~ '^[A-Za-z][0-9]{8}[A-Za-z]$');

-- Was organiser-only; now every ONBOARDED account needs both fields.
ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_organiser_membership_check;
ALTER TABLE public."USER" DROP CONSTRAINT IF EXISTS user_student_membership_check;
ALTER TABLE public."USER" ADD CONSTRAINT user_student_membership_check
  CHECK (onboarded IS NOT TRUE OR (university IS NOT NULL AND "matricNumber" IS NOT NULL));

-- ── 5. RPCs ──────────────────────────────────────────────────────────────────
-- Both lose their p_member_type argument, so the signature changes and the old
-- overloads must be dropped by OID first (CREATE OR REPLACE never drops another
-- signature — the lesson of 20260716_remove_gst.sql).
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('validate_signup_identity', 'complete_oauth_signup')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $do$;

-- Shared signup validation: university + matriculation number are now required for
-- BOTH roles, and the matriculation number must be globally unused.
CREATE OR REPLACE FUNCTION public.validate_signup_identity(
  p_username text,
  p_role text,
  p_university text DEFAULT NULL,
  p_matric_number text DEFAULT NULL,
  p_current_user_id uuid DEFAULT NULL
)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_name text := btrim(coalesce(p_username, ''));
  v_univ text := nullif(btrim(coalesce(p_university, '')), '');
  v_id   text := nullif(btrim(coalesce(p_matric_number, '')), '');
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

  -- Students only: no role is exempt from either field any more.
  if v_univ is null or v_univ not in ('NUS','NTU','SMU','SUSS','SUTD','SIM','SIT') then
    return json_build_object('error','invalid_university');
  end if;
  if v_id is null or v_id !~ '^[A-Za-z][0-9]{8}[A-Za-z]$' then
    return json_build_object('error','invalid_matric');
  end if;
  if exists (
    select 1 from public."USER"
    where lower("matricNumber") = lower(v_id)
      and (p_current_user_id is null or id <> p_current_user_id)
  ) then
    return json_build_object('error', 'matric_taken');
  end if;

  return json_build_object('status', 'ok');
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.validate_signup_identity(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_signup_identity(text, text, text, text, uuid) TO anon, authenticated, service_role;

-- Email/password signup trigger. Reads matricNumber, but still accepts the old
-- `orgId` metadata key so a frontend deployed before this migration keeps working.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_base text;
  v_username text;
  v_role text;
  v_matric text;
  v_validation json;
begin
  v_base := btrim(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)));
  v_role := coalesce(new.raw_user_meta_data->>'role', 'user');
  v_username := v_base;
  v_matric := nullif(coalesce(new.raw_user_meta_data->>'matricNumber', new.raw_user_meta_data->>'orgId'), '');

  if new.raw_user_meta_data ? 'role' and v_role in ('user', 'organiser') then
    v_validation := public.validate_signup_identity(
      v_base,
      v_role,
      new.raw_user_meta_data->>'university',
      v_matric,
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
                             university, "matricNumber", "walletBalance", "createdAt")
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
    v_matric,
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

-- Completion screen for BOTH Google-OAuth shells and existing accounts that this
-- migration flipped back to onboarded = false. grant_signup_wallet_credit is
-- idempotent, so a returning user is never paid the $20 bonus twice.
CREATE OR REPLACE FUNCTION public.complete_oauth_signup(
  p_role text, p_username text,
  p_university text DEFAULT NULL, p_matric_number text DEFAULT NULL
)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_username,''));
  v_univ text := nullif(btrim(coalesce(p_university,'')),'');
  v_id   text := nullif(btrim(coalesce(p_matric_number,'')),'');
  v_validation json;
begin
  if v_uid is null then return json_build_object('error','not_authenticated'); end if;
  v_validation := public.validate_signup_identity(p_username, p_role, p_university, p_matric_number, v_uid);
  if (v_validation->>'error') is not null then return v_validation; end if;

  begin
    update public."USER"
      set role = p_role, username = v_name, onboarded = true,
          university = v_univ, "matricNumber" = v_id
      where id = v_uid and onboarded = false;
  exception when unique_violation then
    return json_build_object('error', case when v_id is not null then 'matric_taken' else 'username_taken' end);
  end;
  if not found then return json_build_object('error','already_onboarded'); end if;

  perform public.grant_signup_wallet_credit(v_uid);

  return json_build_object('status','ok');
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.complete_oauth_signup(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_oauth_signup(text, text, text, text) TO authenticated;
