-- PHASE 5, STEP 5.2: Incident Lifecycle Enforcement Tables
-- Description: Add tables for managing incident acknowledgement, escalation, root causes, and resolution

-- Incident Escalations Table
CREATE TABLE IF NOT EXISTS incident_escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  escalation_level VARCHAR(50) NOT NULL,  -- 'level_1', 'level_2', 'level_3', 'executive'
  reason TEXT NOT NULL,
  escalated_by_user_id UUID NOT NULL REFERENCES users(id),
  escalation_note TEXT,
  escalation_recipients TEXT,  -- JSON array of user IDs or email addresses
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(incident_id, escalation_level)
);

CREATE INDEX IF NOT EXISTS idx_escalations_incident ON incident_escalations(incident_id);
CREATE INDEX IF NOT EXISTS idx_escalations_level ON incident_escalations(escalation_level);
CREATE INDEX IF NOT EXISTS idx_escalations_created ON incident_escalations(created_at DESC);

-- Root Cause Analyses Table
CREATE TABLE IF NOT EXISTS incident_root_cause_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  root_cause TEXT NOT NULL,
  assigned_by_user_id UUID NOT NULL REFERENCES users(id),
  confidence_level VARCHAR(20) NOT NULL,  -- 'low', 'medium', 'high'
  analysis_notes TEXT,
  analysis_evidence JSONB,  -- Supporting data/logs
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_root_cause_incident ON incident_root_cause_analyses(incident_id);
CREATE INDEX IF NOT EXISTS idx_root_cause_confidence ON incident_root_cause_analyses(confidence_level);
CREATE INDEX IF NOT EXISTS idx_root_cause_assigned ON incident_root_cause_analyses(assigned_at DESC);

-- Incident Timeline Events Table (for detailed lifecycle tracking)
CREATE TABLE IF NOT EXISTS incident_timeline_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  description TEXT,
  performed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timeline_incident ON incident_timeline_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_type ON incident_timeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_timeline_created ON incident_timeline_events(created_at DESC);

-- Incident Acknowledgements Table (for audit trail)
CREATE TABLE IF NOT EXISTS incident_acknowledgements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  acknowledged_by_user_id UUID NOT NULL REFERENCES users(id),
  acknowledgement_note TEXT,
  acknowledged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acknowledgements_incident ON incident_acknowledgements(incident_id);
CREATE INDEX IF NOT EXISTS idx_acknowledgements_user ON incident_acknowledgements(acknowledged_by_user_id);
CREATE INDEX IF NOT EXISTS idx_acknowledgements_timestamp ON incident_acknowledgements(acknowledged_at DESC);

-- Incident Resolution Summary Table (enforce requirement before closure)
CREATE TABLE IF NOT EXISTS incident_resolution_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  root_cause TEXT NOT NULL,
  remediation_steps TEXT NOT NULL,
  prevention_measures TEXT NOT NULL,
  post_mortem_url TEXT,
  estimated_impact TEXT,
  resolved_by_user_id UUID NOT NULL REFERENCES users(id),
  resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  closed_by_user_id UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_resolution_incident ON incident_resolution_summaries(incident_id);
CREATE INDEX IF NOT EXISTS idx_resolution_resolved ON incident_resolution_summaries(resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolution_closed ON incident_resolution_summaries(closed_at DESC);

-- Incident Assignments Table (for assigning incidents to teams/individuals)
CREATE TABLE IF NOT EXISTS incident_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  assigned_to_user_id UUID NOT NULL REFERENCES users(id),
  assigned_by_user_id UUID NOT NULL REFERENCES users(id),
  assignment_reason VARCHAR(255),
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assignments_incident ON incident_assignments(incident_id);
CREATE INDEX IF NOT EXISTS idx_assignments_assignee ON incident_assignments(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_active ON incident_assignments(incident_id, unassigned_at) WHERE unassigned_at IS NULL;

-- Incident SLA Tracking Table (for compliance monitoring)
CREATE TABLE IF NOT EXISTS incident_sla_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  severity_level VARCHAR(20) NOT NULL,
  sla_acknowledgement_minutes INT,
  sla_resolution_minutes INT,
  acknowledged_at TIMESTAMP,
  acknowledged_delta_minutes INT,
  acknowledged_sla_met BOOLEAN,
  resolved_at TIMESTAMP,
  resolved_delta_minutes INT,
  resolved_sla_met BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sla_incident ON incident_sla_tracking(incident_id);
CREATE INDEX IF NOT EXISTS idx_sla_severity ON incident_sla_tracking(severity_level);
CREATE INDEX IF NOT EXISTS idx_sla_compliance ON incident_sla_tracking(acknowledged_sla_met, resolved_sla_met);
