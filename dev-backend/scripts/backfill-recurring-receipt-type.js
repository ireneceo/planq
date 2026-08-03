#!/usr/bin/env node
/**
 * 정기 청구서 증빙 의향 백필 — 운영 피드백 2026-08-03 (Irene).
 *
 * 문제: 정기 청구 엔진(`services/recurring_invoice.js` / `clientSubscriptionBilling.js`)이
 *   `receipt_type` 을 payload 에 넣지 않아 모델 기본값 `'none'` 으로 생성됐다. 고객이 한국
 *   사업자로 등록돼 있고 사업자번호·세금계산서 이메일까지 DB 에 다 있는데도 화면엔
 *   "발행 대상 아님" 이 떴다. → 쓰기측은 이미 고쳤고(같은 커밋), 이 스크립트는 **옛 데이터** 를 맞춘다.
 *
 * 안전 설계:
 *   - **dry-run 기본**. `--apply` 를 줘야 실제로 쓴다.
 *   - 술어는 `services/receiptsDue.defaultReceiptTypeFor` **단일 원천** 재사용 (쓰기측과 동일).
 *   - **이미 발행된 건은 절대 건드리지 않는다** (issued / 외부 발행번호 존재 / 취소된 청구서).
 *   - `updated_at` 보존 — `silent: true` 로 타임스탬프를 흔들지 않는다(감사 이력 오염 방지).
 *   - **멱등**: 조건이 `receipt_type='none'` 이라 두 번째 실행은 변경 0 이어야 한다.
 *
 * 큐 부풀림 없음(설계 게이트 확인): `receiptsDue` 의 큐 편입 게이트는 `paid` 다. 여기서
 *   `tax_invoice_status='pending'` 을 세워도 미결제 건은 큐에 안 들어간다 — 운영자에게
 *   유령 할 일이 쏟아지지 않는다.
 *
 * 사용:
 *   node scripts/backfill-recurring-receipt-type.js            # dry-run
 *   node scripts/backfill-recurring-receipt-type.js --apply    # 실제 적용
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { Invoice, Client } = require('../models');
const { sequelize } = require('../config/database');
const { defaultReceiptTypeFor } = require('../services/receiptsDue');

const APPLY = process.argv.includes('--apply');

(async () => {
  console.log(`\n=== 정기청구 증빙 의향 백필 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  // 정기 엔진 산출물만 — 멱등키 접두사가 출처를 말해준다 (proj: = 프로젝트 월정액, sub: = 고객 구독)
  const rows = await Invoice.findAll({
    where: {
      [Op.or]: [
        { idempotency_key: { [Op.like]: 'proj:%' } },
        { idempotency_key: { [Op.like]: 'sub:%' } },
      ],
      receipt_type: { [Op.or]: [null, 'none'] },
      status: { [Op.ne]: 'canceled' },
      // 이미 발행된 증빙은 손대지 않는다
      tax_invoice_status: { [Op.notIn]: ['issued'] },
      tax_invoice_external_id: null,
    },
    include: [{ model: Client, attributes: ['id', 'is_business', 'country', 'biz_name', 'display_name'] }],
    order: [['id', 'ASC']],
  });

  console.log(`후보(정기 생성 · receipt_type 미지정 · 미발행): ${rows.length}건\n`);

  let changed = 0;
  let skipped = 0;
  for (const inv of rows) {
    const kind = defaultReceiptTypeFor(inv.Client, inv.currency);
    if (kind !== 'tax_invoice') {
      skipped += 1;
      continue;
    }
    const who = inv.Client?.biz_name || inv.Client?.display_name || `client#${inv.client_id}`;
    console.log(`  ${APPLY ? '적용' : '예정'} ${inv.invoice_number} · ${who} · ${inv.currency} · status=${inv.status}`);
    if (APPLY) {
      await inv.update(
        { receipt_type: 'tax_invoice', tax_invoice_status: 'pending' },
        { silent: true },   // updated_at 보존
      );
    }
    changed += 1;
  }

  console.log(`\n대상 ${changed}건 / 술어 미충족(개인·외화·비한국) ${skipped}건`);
  if (!APPLY && changed > 0) console.log('\n실제 적용하려면 --apply 를 붙여 다시 실행하세요.');
  if (APPLY) console.log('\n★ 멱등 확인: 같은 명령을 한 번 더 실행해 "대상 0건" 이 나와야 정상입니다.');

  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
