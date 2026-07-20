-- Migration: Add video support to social_posts table
-- Rename to ops_social_posts and add video_url, media_type columns

-- Step 1: Rename existing table
ALTER TABLE IF EXISTS public.social_posts RENAME TO social_posts_legacy;

-- Step 2: Create new table with video support
CREATE TABLE public.ops_social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('product', 'tech')),
  platform text NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'instagram')),
  platforms jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending_approval',
  caption text,
  title text,
  image_url text,
  video_url text,
  media_type text DEFAULT 'image',
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Step 3: Migrate existing data
INSERT INTO public.ops_social_posts (id, type, platform, platforms, status, caption, title, image_url, posted_at, created_at, updated_at, media_type, video_url)
SELECT 
  id, 
  type, 
  platform, 
  platforms, 
  status, 
  caption, 
  title, 
  image_url, 
  posted_at, 
  created_at, 
  updated_at,
  'image' as media_type,
  NULL as video_url
FROM public.social_posts_legacy;

-- Step 4: Drop old table
DROP TABLE public.social_posts_legacy;

-- Step 5: Create indexes
CREATE INDEX idx_ops_social_posts_platform ON public.ops_social_posts(platform);
CREATE INDEX idx_ops_social_posts_status ON public.ops_social_posts(status);
CREATE INDEX idx_ops_social_posts_created_at ON public.ops_social_posts(created_at);
CREATE INDEX idx_ops_social_posts_media_type ON public.ops_social_posts(media_type);

-- Step 6: Enable Row Level Security
ALTER TABLE public.ops_social_posts ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policies
CREATE POLICY "Authenticated users can read ops_social_posts" ON public.ops_social_posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert ops_social_posts" ON public.ops_social_posts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ops_social_posts" ON public.ops_social_posts
  FOR UPDATE TO authenticated USING (true);

-- Step 8: Create updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_ops_social_posts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ops_social_posts_touch_updated_at 
BEFORE UPDATE ON public.ops_social_posts
FOR EACH ROW EXECUTE FUNCTION public.touch_ops_social_posts_updated_at();