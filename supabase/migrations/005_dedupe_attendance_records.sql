-- Remove duplicate attendance rows per session+member (keep earliest by created_at, then id).
DELETE FROM attendance_records
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY session_id, member_id
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM attendance_records
  ) sub
  WHERE rn > 1
);
