-- 039: failure rates compare the metric type as text.
--
-- platform_metrics.metric_type is an enum, and LIKE has no operator for an
-- enum, so `m.metric_type LIKE '%failure%'` raised
--
--     operator does not exist: metric_type_enum ~~ unknown
--
-- every time the function ran. GET /api/metrics/failure-rates could therefore
-- only ever return 500. The cast is the whole fix; the arithmetic was right.
--
-- The declared return type says metric_category is a varchar while the body
-- casts it to TEXT, which Postgres accepts on RETURN QUERY but which is worth
-- lining up so the signature describes what comes back.

DROP FUNCTION IF EXISTS get_tenant_failure_rate(uuid, integer);

CREATE FUNCTION get_tenant_failure_rate(p_tenant_id UUID, p_hours INTEGER)
RETURNS TABLE (
  metric_category TEXT,
  failure_rate NUMERIC,
  total_count INTEGER,
  failure_count INTEGER
) AS $failurerate$
BEGIN
  RETURN QUERY
  SELECT
    (m.metric_category)::TEXT,
    ROUND(
      CAST(COUNT(*) FILTER (WHERE m.metric_type::TEXT LIKE '%failure%') AS NUMERIC)
        * 100 / NULLIF(COUNT(*), 0),
      2
    ) AS failure_rate,
    COUNT(*)::INTEGER AS total_count,
    (COUNT(*) FILTER (WHERE m.metric_type::TEXT LIKE '%failure%'))::INTEGER AS failure_count
  FROM platform_metrics m
  WHERE m.tenant_id = p_tenant_id
    AND m.created_at >= NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY m.metric_category;
END;
$failurerate$ LANGUAGE plpgsql;
