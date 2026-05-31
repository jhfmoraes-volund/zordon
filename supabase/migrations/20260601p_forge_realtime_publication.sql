-- Migration: Ensure ForgeEvent + ForgeRun in supabase_realtime publication
-- Created: 2026-05-31
-- Story: FUI-001

-- Idempotent: only adds tables if not already in publication
DO $$
BEGIN
  -- Add ForgeEvent if not already in publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'ForgeEvent'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."ForgeEvent";
  END IF;

  -- Add ForgeRun if not already in publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'ForgeRun'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."ForgeRun";
  END IF;
END $$;
