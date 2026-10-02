-- Phase 2: every remaining table that names an account but has no tenant_id
-- (findings #17). Migration 074 covered accounts, memberships and
-- credentials. These are the rest, each decided rather than left open:
--
--   * Incidents belong to the tenant they affect (affected_tenant_id), or to
--     the platform when that is NULL. Their child tables follow the incident.
--     Superadmins review incidents platform-wide, on the system pool.
--   * Per-person records (clock drift, role-boundary and privilege
--     escalation events) follow the person, as credentials do (074).
--   * Everything else is platform-level and written or read only by the
--     control plane or by nothing at all (legacy tables no code uses). The
--     runtime role sees none of it.
--
-- tests/identityIsolation.manual.ts fails if a table naming an account is
-- neither under a policy nor decided here.

-- ── Incidents ───────────────────────────────────────────────────────────────
SELECT app_apply_scoped_rls('incidents',
  '(SELECT app_is_system()) OR affected_tenant_id = (SELECT app_current_tenant())');
SELECT app_apply_scoped_rls('infrastructure_incidents',
  '(SELECT app_is_system()) OR affected_tenant_id = (SELECT app_current_tenant())');

-- Visible when the incident is: the EXISTS reads incidents under its policy.
SELECT app_apply_scoped_rls(t::regclass,
  '(SELECT app_is_system()) OR EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id)')
  FROM unnest(ARRAY[
    'incident_timeline', 'escalation_events', 'error_logs',
    'incident_notifications', 'incident_timeline_events', 'incident_escalations',
    'incident_root_cause_analyses', 'incident_acknowledgements', 'incident_resolution_summaries',
    'incident_assignments', 'incident_sla_tracking', 'incident_activity_log'
  ]) AS t;

-- ── Per-person records follow the person ────────────────────────────────────
SELECT app_apply_scoped_rls('drift_audit_log', '(SELECT app_is_system()) OR app_user_visible(user_id)');
SELECT app_apply_scoped_rls('time_authority_incidents', '(SELECT app_is_system()) OR app_user_visible(user_id)');
SELECT app_apply_scoped_rls('role_boundary_violations', '(SELECT app_is_system()) OR app_user_visible(user_id)');
SELECT app_apply_scoped_rls('privilege_escalation_events',
  '(SELECT app_is_system()) OR app_user_visible(affected_user_id) OR app_user_visible(user_id)');

-- ── Platform-level: the control plane only ──────────────────────────────────
-- Superadmin records (their sessions, allow-list, actions, behaviour) and
-- legacy tables that no code reads or writes. The policy is "system only",
-- so a runtime-role query sees nothing and cannot write.
SELECT app_apply_scoped_rls(t::regclass, '(SELECT app_is_system())')
  FROM unnest(ARRAY[
    'access_requests', 'anomaly_log', 'attendance_state_history', 'attendance_transition_attempts',
    'change_log', 'confirmation_tokens', 'drift_reviews', 'dry_run_logs', 'mfa_audit_log',
    'rate_limit_violations', 'rate_limits', 'role_assignment_approvals', 'role_assignment_history',
    'role_assignment_rules', 'role_change_audit', 'role_change_audit_log', 'role_escalation_events',
    'role_revalidation_queue', 'security_event_logs', 'superadmin_action_logs', 'superadmin_audit_log',
    'superadmin_behavior_baseline', 'superadmin_ip_allowlist', 'superadmin_sessions'
  ]) AS t;
