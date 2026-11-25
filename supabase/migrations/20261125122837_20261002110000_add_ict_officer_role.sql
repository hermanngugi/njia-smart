-- New department: ICT Officer (full control of ICT projects + ICT Service
-- Desk oversight, view-only on everything else per the updated access matrix).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'ict_officer';
