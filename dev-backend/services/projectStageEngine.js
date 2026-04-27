// Project Stage Engine — 자동 진행/완료 + next_action 계산 (Phase D+1)
//
// 사용처:
//   - routes/projects.js POST: 프로젝트 생성 시 stage 시드
//   - routes/posts.js: post 발행/카테고리 변경 시 stage 자동 진행
//   - routes/signatures.js: 양사 서명 완료 시 contract stage 완료
//   - routes/invoices.js: invoice 발송/결제/세금계산서 마킹 시 invoice/tax stage 진행
//   - routes/projects.js GET /:id/transactions: stages + next_action 응답에 포함
//
// 설계 원칙:
//   - 멱등 (여러 번 호출돼도 동일 결과)
//   - best-effort (실패해도 본 작업 차단 안 함 — try/catch)
//   - 트랜잭션 외부에서 호출 (commit 후)

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Project, ProjectStage, Post, Invoice, InvoiceInstallment, SignatureRequest, Client } = require('../models');

// ─── 템플릿 정의 ───
// 4 type: fixed (일시) / subscription (지속 구독) / consulting (컨설팅) / custom (자유)
const STAGE_TEMPLATES = {
  fixed: [
    { kind: 'quote',       label: '견적 발행',         order: 1 },
    { kind: 'contract',    label: '계약 체결',         order: 2 },
    { kind: 'invoice',     label: '청구서 발행 + 결제', order: 3 },
    { kind: 'tax_invoice', label: '세금계산서 발행',     order: 4 },
  ],
  subscription: [
    { kind: 'contract',    label: '계약 체결',         order: 1 },
    { kind: 'invoice',     label: '월별 청구·결제',     order: 2, metadata: { recurring: true } },
    { kind: 'tax_invoice', label: '세금계산서 발행',     order: 3 },
  ],
  consulting: [
    { kind: 'proposal',    label: '제안서 작성',       order: 1 },
    { kind: 'contract',    label: 'SOW 체결',         order: 2 },
    { kind: 'invoice',     label: '회차별 청구·결제',  order: 3 },
    { kind: 'tax_invoice', label: '세금계산서 발행',     order: 4 },
  ],
  custom: [], // 사용자가 직접 추가
};

const STAGE_TEMPLATE_KEYS = Object.keys(STAGE_TEMPLATES);

// ─── 시드: 프로젝트 생성 시 stage 자동 생성 ───
async function seedStages(projectId, templateKey, transaction = null) {
  const tpl = STAGE_TEMPLATES[templateKey] || STAGE_TEMPLATES.custom;
  if (tpl.length === 0) return [];
  // 이미 시드된 경우 skip
  const existing = await ProjectStage.count({ where: { project_id: projectId }, transaction });
  if (existing > 0) return [];
  const rows = tpl.map(s => ({
    project_id: projectId,
    order_index: s.order,
    kind: s.kind,
    label: s.label,
    status: 'pending',
    metadata: s.metadata || null,
    is_template_seeded: true,
  }));
  return ProjectStage.bulkCreate(rows, { transaction });
}

// ─── 핵심: 프로젝트 stages 자동 진행 (entity 상태 → stage 상태) ───
// 프로젝트의 모든 stage 를 entity 현황 기반으로 재계산.
// 한 번에 atomic 하게 (race condition 방지).
async function progressProject(projectId) {
  if (!projectId) return null;
  const stages = await ProjectStage.findAll({
    where: { project_id: projectId },
    order: [['order_index', 'ASC']],
  });
  if (stages.length === 0) return null;

  // 프로젝트의 entity 모음 (한 번에 fetch — 여러 stage 가 공유)
  const [posts, invoices] = await Promise.all([
    Post.findAll({
      where: { project_id: projectId },
      attributes: ['id', 'category', 'status', 'shared_at', 'created_at'],
      order: [['created_at', 'ASC']],
    }),
    Invoice.findAll({
      where: { project_id: projectId },
      attributes: ['id', 'status', 'paid_at', 'sent_at', 'paid_amount', 'grand_total', 'installment_mode'],
      include: [
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['is_business'] },
      ],
      order: [['created_at', 'ASC']],
    }),
  ]);

  // post 별 서명 진행
  const postIds = posts.map(p => p.id);
  const allSigs = postIds.length
    ? await SignatureRequest.findAll({
        where: { entity_type: 'post', entity_id: { [Op.in]: postIds } },
        attributes: ['id', 'entity_id', 'status'],
      })
    : [];
  const sigsByPost = {};
  for (const s of allSigs) {
    if (!sigsByPost[s.entity_id]) sigsByPost[s.entity_id] = [];
    sigsByPost[s.entity_id].push(s);
  }

  const results = [];
  // 직전 stage 완료 여부 — 다음 stage 의 active 여부 결정
  let prevCompleted = true;

  for (const stage of stages) {
    const evaluation = evaluateStage(stage, posts, invoices, sigsByPost, prevCompleted);
    if (evaluation.changed) {
      await stage.update(evaluation.patch);
    }
    results.push({ id: stage.id, kind: stage.kind, status: stage.status, ...evaluation.patch });
    prevCompleted = stage.status === 'completed' || stage.status === 'skipped';
  }

  return results;
}

// stage 하나에 대해 entity 상태 평가
function evaluateStage(stage, posts, invoices, sigsByPost, prevCompleted) {
  const now = new Date();
  let patch = {};
  let changed = false;

  switch (stage.kind) {
    case 'quote': {
      const quote = posts.find(p => p.category === 'quote' && p.status === 'published');
      if (quote) {
        if (stage.status !== 'completed') {
          patch = {
            status: 'completed',
            linked_entity_type: 'post',
            linked_entity_id: quote.id,
            started_at: stage.started_at || quote.created_at,
            completed_at: quote.shared_at || quote.created_at || now,
          };
          changed = true;
        }
      } else if (stage.status === 'pending' && prevCompleted) {
        patch = { status: 'active', started_at: now };
        changed = true;
      }
      break;
    }
    case 'proposal': {
      const proposal = posts.find(p => p.category === 'proposal' && p.status === 'published');
      if (proposal) {
        if (stage.status !== 'completed') {
          patch = { status: 'completed', linked_entity_type: 'post', linked_entity_id: proposal.id, completed_at: proposal.shared_at || proposal.created_at || now };
          changed = true;
        }
      } else if (stage.status === 'pending' && prevCompleted) {
        patch = { status: 'active', started_at: now };
        changed = true;
      }
      break;
    }
    case 'contract': {
      // 계약/SOW 후보 (양사 서명 완료된 게 있으면 그 post 와 연결)
      const candidates = posts.filter(p =>
        (p.category === 'contract' || p.category === 'sow') && p.status === 'published'
      );
      // 서명 완료된 candidate 찾기
      let signedPost = null;
      for (const p of candidates) {
        const sigs = sigsByPost[p.id] || [];
        if (sigs.length > 0 && sigs.every(s => s.status === 'signed')) {
          signedPost = p;
          break;
        }
      }
      if (signedPost) {
        if (stage.status !== 'completed') {
          patch = { status: 'completed', linked_entity_type: 'post', linked_entity_id: signedPost.id, completed_at: now };
          changed = true;
        }
      } else if (candidates.length > 0) {
        // 작성됐으나 미서명 — active
        if (stage.status !== 'active') {
          patch = { status: 'active', linked_entity_type: 'post', linked_entity_id: candidates[0].id, started_at: stage.started_at || now };
          changed = true;
        }
      } else if (stage.status === 'pending' && prevCompleted) {
        patch = { status: 'active', started_at: now };
        changed = true;
      }
      break;
    }
    case 'invoice': {
      // 모든 invoice 가 paid (또는 모든 회차 paid) 면 completed
      // 일부 진행 중이면 active
      const recurring = stage.metadata?.recurring;
      if (invoices.length === 0) {
        if (stage.status === 'pending' && prevCompleted) {
          patch = { status: 'active', started_at: now };
          changed = true;
        }
        break;
      }
      const allPaid = invoices.every(inv => inv.status === 'paid');
      // recurring (구독) 의 경우 항상 active 유지 — 다음 달 청구 대기
      if (recurring) {
        if (stage.status !== 'active') {
          patch = { status: 'active', linked_entity_type: 'invoice', linked_entity_id: invoices[invoices.length - 1].id, started_at: stage.started_at || now };
          changed = true;
        }
      } else if (allPaid) {
        if (stage.status !== 'completed') {
          patch = { status: 'completed', linked_entity_type: 'invoice', linked_entity_id: invoices[invoices.length - 1].id, completed_at: now };
          changed = true;
        }
      } else {
        if (stage.status !== 'active') {
          patch = { status: 'active', linked_entity_type: 'invoice', linked_entity_id: invoices[0].id, started_at: stage.started_at || now };
          changed = true;
        }
      }
      break;
    }
    case 'tax_invoice': {
      // 한국 사업자 고객의 paid 회차 모두 tax_invoice_no 입력 시 completed.
      // 개인 고객 / 해외 고객 (country !== 'KR') 만 있으면 skipped.
      // (해외 거래는 영세율 — 한국 세금계산서 의무 없음, commercial invoice 로 대체)
      const businessInvoices = invoices.filter(inv =>
        inv.Client?.is_business && (inv.Client?.country || 'KR') === 'KR'
      );
      if (businessInvoices.length === 0) {
        if (stage.status !== 'skipped' && invoices.length > 0) {
          patch = { status: 'skipped', completed_at: now };
          changed = true;
        }
        break;
      }
      // paid 회차 중 tax_invoice_no 미입력 카운트
      let pendingCount = 0;
      let paidCount = 0;
      for (const inv of businessInvoices) {
        const insts = inv.installments || [];
        if (inv.installment_mode === 'split' && insts.length > 0) {
          for (const it of insts) {
            if (it.status === 'paid') {
              paidCount++;
              if (!it.tax_invoice_no) pendingCount++;
            }
          }
        } else if (inv.status === 'paid') {
          // 단일 — Invoice 자체에는 tax_invoice 컬럼이 별개 (tax_invoice_status 등). 단순화: paid 단일은 별도 ux
          paidCount++;
          // single invoice 의 tax_invoice 마킹은 현재 인스털먼트 단위로만 구현 — 이 케이스는 스킵
        }
      }
      if (paidCount === 0) {
        if (stage.status === 'pending' && prevCompleted) {
          patch = { status: 'active', started_at: now };
          changed = true;
        }
      } else if (pendingCount === 0) {
        if (stage.status !== 'completed') {
          patch = { status: 'completed', completed_at: now };
          changed = true;
        }
      } else {
        if (stage.status !== 'active') {
          patch = { status: 'active', started_at: stage.started_at || now };
          changed = true;
        }
      }
      break;
    }
    default: {
      // custom — 자동 진행 룰 없음 (사용자가 수동 처리)
      break;
    }
  }
  return { changed, patch };
}

// ─── next_action 계산: 사용자가 지금 해야 할 일 (현재 active stage 의 핵심 액션) ───
async function computeNextAction(projectId) {
  const stages = await ProjectStage.findAll({
    where: { project_id: projectId },
    order: [['order_index', 'ASC']],
  });
  if (stages.length === 0) return null;

  // 첫 번째 active 또는 pending stage 의 액션
  const target = stages.find(s => s.status === 'active') || stages.find(s => s.status === 'pending');
  if (!target) return null;

  // entity 정보를 한 번 더 찾아 액션 컨텍스트 만들기
  return await deriveActionForStage(target, projectId);
}

async function deriveActionForStage(stage, projectId) {
  const base = { stage_id: stage.id, stage_kind: stage.kind, stage_label: stage.label, status: stage.status };

  switch (stage.kind) {
    case 'quote': {
      const quote = await Post.findOne({
        where: { project_id: projectId, category: 'quote', status: 'published' },
        order: [['created_at', 'DESC']],
      });
      const draftQuote = quote ? null : await Post.findOne({
        where: { project_id: projectId, category: 'quote', status: 'draft' },
      });
      if (quote) {
        return { ...base, action_kind: 'wait_or_proceed', label: '견적 완료', hint: '계약 단계로 진행', link: null };
      }
      if (draftQuote) {
        return { ...base, action_kind: 'publish_post', label: '견적서 발행하기', hint: '초안을 발행하면 다음 단계로 넘어갑니다', link: `/projects/p/${projectId}?tab=docs&post=${draftQuote.id}` };
      }
      return { ...base, action_kind: 'create_post', label: '견적서 작성하기', hint: '이 프로젝트의 문서 탭에서 새 견적서 작성', link: `/projects/p/${projectId}?tab=docs&new=1&category=quote` };
    }
    case 'proposal': {
      const proposal = await Post.findOne({ where: { project_id: projectId, category: 'proposal', status: 'published' } });
      if (proposal) return { ...base, action_kind: 'wait_or_proceed', label: '제안서 발행됨', hint: 'SOW 단계로 진행', link: null };
      return { ...base, action_kind: 'create_post', label: '제안서 작성하기', hint: '이 프로젝트의 문서 탭에서 새 제안서 작성', link: `/projects/p/${projectId}?tab=docs&new=1&category=proposal` };
    }
    case 'contract': {
      // contract / sow post 찾기
      const post = await Post.findOne({
        where: { project_id: projectId, category: { [Op.in]: ['contract', 'sow'] } },
        order: [['created_at', 'DESC']],
      });
      if (!post) {
        return { ...base, action_kind: 'create_post', label: '계약서 작성하기', hint: '계약/SOW 를 작성하면 서명 받기로 진행', link: `/projects/p/${projectId}?tab=docs&new=1&category=contract` };
      }
      const sigs = await SignatureRequest.findAll({ where: { entity_type: 'post', entity_id: post.id } });
      if (sigs.length === 0) {
        return { ...base, action_kind: 'request_signature', label: '서명 요청 보내기', hint: `${post.title} — 양사 서명을 받아 계약을 체결합니다`, link: `/projects/p/${projectId}?tab=docs&post=${post.id}&action=sign` };
      }
      const allSigned = sigs.every(s => s.status === 'signed');
      if (allSigned) {
        return { ...base, action_kind: 'wait_or_proceed', label: '계약 체결 완료', hint: '청구서 발행 단계로 진행', link: null };
      }
      const anyRejected = sigs.some(s => s.status === 'rejected');
      if (anyRejected) {
        return { ...base, action_kind: 'review_signature', label: '서명 거절됨', hint: '거절 사유 확인 후 재요청', link: `/projects/p/${projectId}?tab=docs&post=${post.id}` };
      }
      const pending = sigs.filter(s => s.status !== 'signed' && s.status !== 'rejected').length;
      return { ...base, action_kind: 'wait_signature', label: `서명 대기 ${pending}명`, hint: '서명자에게 재발송 가능', link: `/projects/p/${projectId}?tab=docs&post=${post.id}` };
    }
    case 'invoice': {
      const invoices = await Invoice.findAll({
        where: { project_id: projectId },
        include: [{ model: InvoiceInstallment, as: 'installments', separate: true }],
        order: [['created_at', 'DESC']],
      });
      const latestPostId = await findContractPostId(projectId);
      if (invoices.length === 0) {
        // 청구서 없음 → 계약 기반 발행 유도 (D2 prefill 흐름 사용)
        const link = latestPostId
          ? `/bills?tab=invoices&new=1&split=1&from_post=${latestPostId}`
          : `/bills?tab=invoices&new=1`;
        return { ...base, action_kind: 'create_invoice', label: '청구서 발행하기', hint: '계약 기반으로 청구서를 만듭니다', link };
      }
      // 알림 받은 회차 우선
      for (const inv of invoices) {
        const notifyInst = (inv.installments || []).find(i => i.notify_paid_at && i.status !== 'paid' && i.status !== 'canceled');
        if (notifyInst) {
          return { ...base, action_kind: 'mark_paid', label: '입금 확인하기', hint: `${inv.invoice_number} · ${notifyInst.label} · 송금 완료 알림 받음`, link: `/bills?tab=invoices&invoice=${inv.id}` };
        }
        if (inv.notify_paid_at && inv.status !== 'paid' && inv.status !== 'canceled') {
          return { ...base, action_kind: 'mark_paid', label: '입금 확인하기', hint: `${inv.invoice_number} · 송금 완료 알림 받음`, link: `/bills?tab=invoices&invoice=${inv.id}` };
        }
      }
      // 미발송(draft) 청구서 우선
      const draft = invoices.find(i => i.status === 'draft');
      if (draft) return { ...base, action_kind: 'send_invoice', label: '청구서 발송하기', hint: `${draft.invoice_number} 초안을 발송하세요`, link: `/bills?tab=invoices&invoice=${draft.id}` };
      // 모두 발송됨 — 결제 대기
      const partial = invoices.find(i => i.status === 'partially_paid' || i.status === 'sent' || i.status === 'overdue');
      if (partial) return { ...base, action_kind: 'wait_payment', label: '결제 대기 중', hint: `${partial.invoice_number} — 고객 입금 대기`, link: `/bills?tab=invoices&invoice=${partial.id}` };
      // 모두 paid
      return { ...base, action_kind: 'wait_or_proceed', label: '결제 완료', hint: '세금계산서 단계로 진행', link: null };
    }
    case 'tax_invoice': {
      const invoices = await Invoice.findAll({
        where: { project_id: projectId },
        include: [
          { model: InvoiceInstallment, as: 'installments', separate: true },
          { model: Client, attributes: ['is_business', 'biz_name', 'display_name'] },
        ],
      });
      // 사업자 고객 + paid + tax_invoice_no 미입력 회차 첫 번째
      for (const inv of invoices) {
        if (!inv.Client?.is_business) continue;
        const target = (inv.installments || []).find(i => i.status === 'paid' && !i.tax_invoice_no);
        if (target) {
          return { ...base, action_kind: 'mark_tax_invoice', label: '세금계산서 발행하기', hint: `${inv.invoice_number} · ${target.label} · 외부 발행 후 번호 마킹`, link: `/bills?tab=tax-invoices` };
        }
      }
      return { ...base, action_kind: 'wait_or_proceed', label: '세금계산서 처리 완료', hint: null, link: null };
    }
    default:
      return { ...base, action_kind: 'custom', label: stage.label, hint: '사용자 정의 단계', link: null };
  }
}

async function findContractPostId(projectId) {
  // 계약/SOW post 가 있으면 그 id, 없으면 견적이라도
  const post = await Post.findOne({
    where: { project_id: projectId, category: { [Op.in]: ['contract', 'sow', 'quote'] }, status: 'published' },
    order: [
      [sequelize.literal("FIELD(category, 'contract', 'sow', 'quote')"), 'ASC'],
      ['created_at', 'DESC'],
    ],
    attributes: ['id'],
  });
  return post ? post.id : null;
}

// ─── 외부 호출용: post 변경 시 trigger ───
async function onPostChanged(postId) {
  try {
    const post = await Post.findByPk(postId, { attributes: ['project_id'] });
    if (post?.project_id) await progressProject(post.project_id);
  } catch (e) { console.error('[stageEngine.onPostChanged]', e.message); }
}

// 서명 변경 시
async function onSignatureChanged(signatureId) {
  try {
    const sr = await SignatureRequest.findByPk(signatureId, { attributes: ['entity_type', 'entity_id'] });
    if (sr?.entity_type === 'post') {
      const post = await Post.findByPk(sr.entity_id, { attributes: ['project_id'] });
      if (post?.project_id) await progressProject(post.project_id);
    }
  } catch (e) { console.error('[stageEngine.onSignatureChanged]', e.message); }
}

// invoice/installment 변경 시
async function onInvoiceChanged(invoiceId) {
  try {
    const inv = await Invoice.findByPk(invoiceId, { attributes: ['project_id'] });
    if (inv?.project_id) await progressProject(inv.project_id);
  } catch (e) { console.error('[stageEngine.onInvoiceChanged]', e.message); }
}

module.exports = {
  STAGE_TEMPLATES,
  STAGE_TEMPLATE_KEYS,
  seedStages,
  progressProject,
  computeNextAction,
  onPostChanged,
  onSignatureChanged,
  onInvoiceChanged,
};
