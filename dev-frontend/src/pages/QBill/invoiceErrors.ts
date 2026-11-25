// invoiceErrors — 청구서 화면의 서버 거절 → 사용자 언어 (2026-10-16)
//
// 왜: 서버가 'owner_only — financial mutation requires …' 영어 문장을 보내고 발행 창·상세 드로어가 그것을
//   그대로 띄워 한국어 설정에서도 영어가 나왔다(Irene 신고). 서버는 이제 코드만 보내고, 화면은 이 함수 하나로 옮긴다.
//   errors 네임스페이스의 owner_only(«작성자만 변경…»)는 청구서에 맞지 않는 말이라 qbill 전용 문구를 쓴다.
import type { TFunction } from 'i18next';

const CODE_KEY: Record<string, string> = {
  owner_only: 'errors.ownerOnly',
  client_not_in_project: 'errors.clientNotInProject',
  project_not_in_workspace: 'errors.projectNotInWorkspace',
  client_not_in_workspace: 'errors.clientNotInWorkspace',
  // 첨부(services/invoiceAttachments) — 생성 요청에 실은 첨부가 거절되면 청구서도 만들어지지 않는다
  attachment_target_not_found: 'attach.error.notFound',
  attachment_target_invalid: 'attach.error.failed',
  too_many_attachments: 'attach.error.tooMany',
};

/** 알려진 거절 코드면 qbill 문구, 아니면 null(부르는 쪽이 자기 기본 문구를 쓴다). t 는 useTranslation('qbill').t */
export function invoiceErrorText(err: unknown, t: TFunction): string | null {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return null;
  // 옛 서버(배포 전)는 'owner_only — …' 처럼 코드 뒤에 문장을 붙였다 — 앞 토막으로 판정한다
  const code = msg.split(/[\s—:]/)[0];
  if (code === 'attachment_not_shareable') return t(`attach.reason.${msg.split(':')[1] || 'internal'}`) as string;
  const key = CODE_KEY[code];
  return key ? (t(key, { max: 20 }) as string) : null;
}
