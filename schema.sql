-- ============================================================================
-- SQL DDL Migration for party.fun Database Setup
-- Run these commands in your Supabase SQL Editor to initialize tables.
-- ============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Profiles Table (syncs with Supabase Auth users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone_telegram TEXT,
  student_id TEXT UNIQUE,
  role TEXT CHECK (role IN ('user', 'admin')) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Events Table (date and time merged to start_time)
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  organiser_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  image_url TEXT,
  backers_threshold INTEGER NOT NULL CHECK (backers_threshold > 0),
  hard_capacity INTEGER NOT NULL CHECK (hard_capacity > 0),
  status TEXT CHECK (status IN ('funding', 'greenlit', 'failed', 'completed')) DEFAULT 'funding',
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_capacity CHECK (hard_capacity >= backers_threshold),
  CONSTRAINT check_deadline CHECK (deadline <= start_time)
);

-- 3. Pricing Tiers Table
CREATE TABLE IF NOT EXISTS public.pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  tier_index INTEGER NOT NULL CHECK (tier_index >= 0),
  label TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  max_spots INTEGER NOT NULL CHECK (max_spots > 0),
  UNIQUE (event_id, tier_index)
);

-- 4. Pledges Table
CREATE TABLE IF NOT EXISTS public.pledges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status TEXT CHECK (status IN ('locked', 'refunded', 'claimed')) DEFAULT 'locked',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Normalized Statistics View (Aggregates stats dynamically)
-- ============================================================================
CREATE OR REPLACE VIEW public.events_with_stats AS
SELECT 
  e.id,
  e.title,
  e.organiser_id,
  e.description,
  e.start_time,
  e.location,
  e.image_url,
  e.backers_threshold,
  e.hard_capacity,
  e.status,
  e.deadline,
  e.created_at,
  -- Calculate backers count dynamically from locked pledges
  COALESCE(COUNT(DISTINCT p.user_id) FILTER (WHERE p.status = 'locked'), 0)::INTEGER AS backers_count,
  -- Calculate total tickets sold dynamically
  COALESCE(SUM(p.quantity) FILTER (WHERE p.status = 'locked'), 0)::INTEGER AS spots_sold,
  -- Calculate spots left dynamically
  (e.hard_capacity - COALESCE(SUM(p.quantity) FILTER (WHERE p.status = 'locked'), 0))::INTEGER AS spots_left
FROM 
  public.events e
LEFT JOIN 
  public.pledges p ON e.id = p.event_id
GROUP BY 
  e.id;

-- ============================================================================
-- Profile Creation Trigger on Auth Signup
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Anonymous Student'),
    NEW.email,
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
