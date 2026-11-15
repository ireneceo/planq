-- 상황판 «들어온 문의» 칸 조회 — 개발시작.md 1-B · scripts/feedback-board.js --build 의 입력 (읽기 전용)
-- 한 줄에 JSON 하나(mysql -N -r). 이메일·이름·전화 칸은 읽지 않는다 — 이 파일에 그 칸 이름이 없어야 한다(검사 grep).
-- 운영에 접수 확인 칸이 아직 없으면(배포 전) `sed 's/fi\.ack_sent_at/NULL/'` 로 바꿔 넘긴다. 조사 칸이 없으면 같은 식으로 fi.ai_triage* 를 NULL 로.
SELECT JSON_OBJECT(
  'src', 'fb', 'id', fi.id, 'kind', fi.kind, 'category', fi.category, 'priority', fi.priority, 'status', fi.status,
  'approved_at', fi.approved_at, 'created_at', fi.created_at, 'title', fi.title, 'body', LEFT(fi.body, 600),
  'answered', (fi.admin_response IS NOT NULL AND fi.admin_response <> ''), 'responded_at', fi.responded_at,
  'ack_sent_at', fi.ack_sent_at,
  'triage_verdict', fi.ai_triage_verdict, 'triage_at', fi.ai_triage_at,
  'triage_summary', LEFT(JSON_UNQUOTE(JSON_EXTRACT(fi.ai_triage, '$.summary')), 400),
  'followups', (SELECT COUNT(*) FROM feedback_items c WHERE c.parent_id = fi.id),
  'open_followups', (SELECT COUNT(*) FROM feedback_items c WHERE c.parent_id = fi.id
      AND (c.admin_response IS NULL OR c.admin_response = '')
      AND (fi.responded_at IS NULL OR c.created_at > fi.responded_at)),
  'ws', b.name
)
FROM feedback_items fi LEFT JOIN businesses b ON b.id = fi.business_id
WHERE fi.parent_id IS NULL AND fi.status IN ('pending', 'reviewing', 'queued', 'in_progress')
ORDER BY fi.id;
SELECT JSON_OBJECT(
  'src', 'landing', 'id', ci.id, 'kind', ci.kind, 'status', ci.status, 'created_at', ci.created_at,
  'replied_at', ci.replied_at, 'locale', ci.locale, 'body', LEFT(ci.message, 600)
)
FROM contact_inquiries ci
WHERE ci.status IN ('new', 'in_progress')
ORDER BY ci.id;
