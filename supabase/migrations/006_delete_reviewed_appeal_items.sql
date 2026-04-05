-- Remove historical approved/rejected appeal rows to free space; only pending are kept going forward.
DELETE FROM attendance_appeal_items
WHERE status IN ('approved', 'rejected');

DELETE FROM attendance_appeals a
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_appeal_items i WHERE i.appeal_id = a.id
);
