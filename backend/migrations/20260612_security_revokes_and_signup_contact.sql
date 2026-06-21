-- Migration: DB hardening (revokes) + persist Telegram/Phone at signup.
-- Apply via the Supabase SQL editor or `supabase db` against the project.

-- ─────────────────────────────────────────────────────────────────────────────
-- Hardening: handle_new_user is a trigger fn, not a public RPC; and the write
-- RPCs already reject anon internally — revoke anon EXECUTE as defence-in-depth.
-- (Reads get_*, and email_for_username for username login, stay anon-callable.)
-- ─────────────────────────────────────────────────────────────────────────────
-- handle_new_user is only ever invoked as a trigger (trigger execution ignores
-- EXECUTE grants), so it can be fully removed from the callable RPC surface.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- The write RPCs are granted to PUBLIC by default (which covers anon), so revoking
-- only `anon` is insufficient — revoke PUBLIC + anon and re-grant to authenticated.
DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.create_event(text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer)',
    'public.update_event(uuid, text, text, text, timestamptz, timestamptz, text, integer, integer, timestamptz, numeric, integer, numeric, integer)',
    'public.delete_event(uuid)',
    'public.cancel_event(uuid, text)',
    'public.create_pledge(uuid, integer)',
    'public.give_away_tickets(bigint, integer)',
    'public.soft_delete_booking(bigint)',
    'public.delete_my_account()'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Signup persists Telegram (USER.socialLink) + Phone (USER.contact) from the
-- auth metadata supplied at sign-up.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  begin
    insert into public."USER" (id, email, name, username, role, "avatarUrl", "socialLink", contact, "createdAt")
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
      coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
      coalesce(new.raw_user_meta_data->>'role', 'user'),
      new.raw_user_meta_data->>'avatarUrl',
      nullif(new.raw_user_meta_data->>'telegram',''),
      nullif(new.raw_user_meta_data->>'phone',''),
      now()
    );
    return new;
  end; $function$;
