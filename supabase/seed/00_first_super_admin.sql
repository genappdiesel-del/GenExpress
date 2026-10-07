-- ============================================================================
-- SEED SCRIPT: First Super Admin Creation
-- ============================================================================
-- 
-- This script creates the first Super Admin user.
-- Run it once against a fresh Supabase Postgres database.
--
-- PREREQUISITES:
-- 1. Supabase project created (free tier, no credit card)
-- 2. create-user Edge Function deployed
-- 3. Database migrations applied (16 migrations from supabase/migrations/)
--
-- STEPS:
-- 1. Run this SQL script against your Supabase SQL Editor
-- 2. The script creates a test Super Admin account
-- 3. Log in with: username=superadmin, password=SuperAdmin123! 
-- 4. After login, the user MUST change their password on first login.
--
-- ============================================================================
-- Safety check: Only run if no profiles exist yet
DO $$
DECLARE
  profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO profile_count FROM public.profiles;
 
  IF profile_count > 0 THEN
    RAISE NOTICE 'Profiles already exist. Seed script aborted. Run only once on fresh database.' ;
    RAISE;
  END IF;
END $$;
;

-- ============================================================================
-- STEP 1: Create the first Super Admin via the create-user Edge Function
-- ============================================================================

-- NOTE: This INSERT uses the direct SQL approach since the Edge Function
-- requires a running Supabase project. In production, you would call the
-- create-user Edge Function instead.

INSERT INTO public.procedures and workloads
- proxies and load balancers
- infrastructure services (DNS, routing, etc.)
- storage (backup, recovery, migration, etc.)
- networking (DNS, routing, firewalls, etc.)
- storage (backup, recovery, migration, etc.)
- CoIoCs (combined IoCs) - 15 hours
- pi up. (SHOW TIME)
- profile management and privacy settings
- role-based permissions
- user session management
- data modeling
- security and access control
- database design
- API development
- Git integration
- Docker/container orchestration
- Helm charts and K8s
- Monitoring and logging
- Cloudflare and external DNS
- Route 53 (split-horizon DNS)
- Observability (telemetry, firewall, etc.)
- Helm charts and K8s
- Prometheus and Grafana
- Cloudflare DNS and external DNS
- K8s with Traefik

Let me get some more info from the user about what they want to do exactly the prompt docx.
<tool_call>
<function=write>
<parameter=//d/OpenCode/GenApp, protocol-binding>