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
const { Project, ProjectStage, Post, Invoice, InvoiceInstallment, SignatureRequest, Client, PostBillingTerms } = require('../models');

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

// ─── 거래 문서 종류 — 문서 «분류» 는 자유 글자다 ───
// 템플릿으로 만든 문서는 분류가 화면 이름(«계약서»·«견적서» …)으로 저장된다(PostsPage KIND_LABELS_KO).
// 예전엔 여기서 영어 값('contract')만 알아봐서, 템플릿으로 만든 계약서는 서명·청구가 끝나도
// «계약 체결» 이 영영 대기였다(2026-11-03 실측). 거래 단계가 읽는 분류는 이 표 한 곳에서 판정한다.
const DEAL_DOC_ALIASES = {
  quote: ['quote', '견적서', '견적'],
  proposal: ['proposal', '제안서', '제안'],
  contract: ['contract', '계약서', '계약'],
  sow: ['sow', '작업내역서'],
};
const ALIAS_TO_KIND = new Map();
for (const [kind, names] of Object.entries(DEAL_DOC_ALIASES)) {
  for (const n of names) ALIAS_TO_KIND.set(String(n).trim().toLowerCase(), kind);
}
function dealKindOf(category) {
  if (!category) return null;
  return ALIAS_TO_KIND.get(String(category).trim().toLowerCase()) || null;
}
// DB 조회용 — 이 종류에 해당하는 분류 글자 전부(대소문자 무시 비교는 MySQL 기본 정렬이 한다)
function categoriesFor(...kinds) {
  return kinds.flatMap((k) => DEAL_DOC_ALIASES[k] || []);
}

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

// ─── «이 프로젝트의 실계약» 판정 — 한 곳 (2026-11-04, Fable 설계 권고 B-1) ───
// 예전엔 단계판(progressProject)은 «가장 오래된» 계약 문서, «다음 할 일»(deriveActionForStage)은 «가장 최근» 계약 문서를 봐서
// 계약서가 둘 이상이면 서로 다른 문서를 가리켰다. 이제 세 곳(단계판·다음 할 일·청구서 만들기 링크)이 이 함수 하나를 쓴다.
// 실계약 신호가 강한 순서(같은 순위 안에서는 최근 것):
//   ① 서명 회차가 전부 signed 인 문서  ② 서명 요청을 보낸 문서  ③ 청구 조건을 적었거나 청구서의 근거가 된 문서  ④ 분류만 계약/SOW 인 문서
// 후보 = 이 프로젝트 소속·발행된 문서 중 분류가 계약/SOW 이거나 ③(청구가 붙은 문서 — 분류 글자가 달라도 실계약이다).
function pickContractPost(posts, sigsByPost, billingPostIds) {
  const billed = new Set((billingPostIds || []).map(Number));
  const cands = posts.filter((p) => p.status === 'published'
    && (p.category === 'contract' || p.category === 'sow' || billed.has(Number(p.id))));
  if (cands.length === 0) return null;
  const rank = (p) => {
    const sigs = sigsByPost[p.id] || [];
    if (sigs.length > 0 && sigs.every((x) => x.status === 'signed')) return 0;
    if (sigs.length > 0) return 1;
    if (billed.has(Number(p.id))) return 2;
    return 3;
  };
  const t = (p) => (p.created_at ? new Date(p.created_at).getTime() : 0);
  const best = cands.slice().sort((a, b) => rank(a) - rank(b) || t(b) - t(a) || b.id - a.id)[0];
  return { post: best, signed: rank(best) === 0, sigs: sigsByPost[best.id] || [] };
}

// 단계 계산이 쓰는 문서·서명·청구 연결을 한 번에 읽는다(progressProject 와 다음 할 일이 같은 재료를 쓰게).
async function loadDealDocs(projectId) {
  const posts = await Post.findAll({
    where: { project_id: projectId },
    // ★ Post 모델의 작성일 속성 이름은 createdAt 이다 — 'created_at' 로 고르면 값이 비어 온다.
    attributes: ['id', 'title', 'category', 'status', 'shared_at', 'createdAt'],
    order: [['created_at', 'ASC']],
  }).then((rows) => rows.map((p) => ({
    id: p.id, title: p.title, status: p.status, shared_at: p.shared_at, created_at: p.createdAt,
    category: dealKindOf(p.category) || p.category,
  })));
  const postIds = posts.map((p) => p.id);
  // 🔴 운영 #239 — `kind: 'sign'` 필수. 확인 요청(kind='confirm')은 서명이 아니다.
  //   회차 술어는 서명본과 한 벌(signRoundWhere — 취소·닫힌 회차 제외, Fable 2026-10-22 R1).
  const [allSigs, terms, srcInv] = postIds.length ? await Promise.all([
    SignatureRequest.findAll({ where: require('./signedDocument').signRoundWhere('post', { [Op.in]: postIds }), attributes: ['id', 'entity_id', 'status', 'rejected_kind'] }),
    PostBillingTerms.findAll({ where: { post_id: { [Op.in]: postIds } }, attributes: ['post_id'] }),
    Invoice.findAll({ where: { project_id: projectId, source_post_id: { [Op.in]: postIds } }, attributes: ['source_post_id'] }),
  ]) : [[], [], []];
  const sigsByPost = {};
  for (const x of allSigs) (sigsByPost[x.entity_id] = sigsByPost[x.entity_id] || []).push(x);
  const billingPostIds = [...new Set([...terms.map((r) => r.post_id), ...srcInv.map((r) => r.source_post_id)])];
  return { posts, sigsByPost, billingPostIds };
}

// 거래 탭 문서 목록 조건 — 분류가 견적·제안·계약·SOW 이거나, 청구 조건/청구서 근거가 붙은 문서(pickContractPost 후보와 같은 집합)
async function dealDocsWhere(projectId) {
  const { billingPostIds } = await loadDealDocs(projectId);
  const byCat = { category: { [Op.in]: categoriesFor('contract', 'quote', 'sow', 'proposal') } };
  return { [Op.or]: billingPostIds.length ? [byCat, { id: { [Op.in]: billingPostIds } }] : [byCat] };
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
  const [{ posts, sigsByPost, billingPostIds }, invoices] = await Promise.all([
    loadDealDocs(projectId),
    Invoice.findAll({
      where: { project_id: projectId },
      attributes: ['id', 'status', 'paid_at', 'sent_at', 'paid_amount', 'grand_total', 'installment_mode', 'tax_invoice_status'],
      include: [
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['is_business', 'country'] },
      ],
      order: [['created_at', 'ASC']],
    }),
  ]);
  const contractPick = pickContractPost(posts, sigsByPost, billingPostIds);

  const results = [];
  // 직전 stage 완료 여부 — 다음 stage 의 active 여부 결정
  let prevCompleted = true;
  // 견적·제안을 건너뛰고 계약(또는 바로 청구)부터 한 거래 — 그 앞 단계는 «진행 중» 이 아니라 «건너뜀» 이다.
  //   예전엔 견적 단계가 영영 «진행 중» 이라 «다음 할 일» 이 결제가 끝난 뒤에도 «견적서 작성하기» 였다(2026-11-03 실측).
  //   나중에 견적서를 발행하면 아래 평가가 다시 «완료» 로 돌린다(멱등). 사람이 직접 정한 단계(manual_locked)는 건드리지 않는다.
  const movedPast = invoices.length > 0 || !!contractPick;

  for (const stage of stages) {
    // ① 수동 완료/건너뛰기(manual_locked)는 자동 평가 skip — 사용자 설정 존중(외부 체결 계약 등).
    //    단, 다음 stage 활성화 판단(prevCompleted)에는 현재 status 반영.
    if (stage.metadata && stage.metadata.manual_locked) {
      results.push({ id: stage.id, kind: stage.kind, status: stage.status, manual_locked: true });
      prevCompleted = stage.status === 'completed' || stage.status === 'skipped';
      continue;
    }
    const evaluation = evaluateStage(stage, posts, invoices, sigsByPost, prevCompleted, movedPast, contractPick);
    if (evaluation.changed) {
      await stage.update(evaluation.patch);
    }
    results.push({ id: stage.id, kind: stage.kind, status: stage.status, ...evaluation.patch });
    prevCompleted = stage.status === 'completed' || stage.status === 'skipped';
  }

  return results;
}

// stage 하나에 대해 entity 상태 평가
function evaluateStage(stage, posts, invoices, sigsByPost, prevCompleted, movedPast = false, contractPick = null) {
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
      } else if (movedPast && !stage.metadata?.no_auto_skip && (stage.status === 'pending' || stage.status === 'active')) {
        patch = { status: 'skipped', completed_at: now };
        changed = true;
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
      } else if (movedPast && !stage.metadata?.no_auto_skip && (stage.status === 'pending' || stage.status === 'active')) {
        patch = { status: 'skipped', completed_at: now };
        changed = true;
      } else if (stage.status === 'pending' && prevCompleted) {
        patch = { status: 'active', started_at: now };
        changed = true;
      }
      break;
    }
    case 'contract': {
      // 실계약 판정은 pickContractPost 한 곳(단계판·다음 할 일·청구서 링크가 같은 문서를 본다)
      if (contractPick && contractPick.signed) {
        if (stage.status !== 'completed' || stage.linked_entity_id !== contractPick.post.id) {
          patch = { status: 'completed', linked_entity_type: 'post', linked_entity_id: contractPick.post.id, completed_at: stage.status === 'completed' ? (stage.completed_at || now) : now };
          changed = true;
        }
      } else if (contractPick) {
        // 작성됐으나 미서명 — active (보는 문서가 바뀌면 연결도 따라간다)
        if (stage.status !== 'active' || stage.linked_entity_id !== contractPick.post.id) {
          patch = { status: 'active', linked_entity_type: 'post', linked_entity_id: contractPick.post.id, started_at: stage.started_at || now };
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
          // 단건 — 청구서 자체의 tax_invoice_status 로 판정한다(POST /:biz/:id/mark-tax-invoice 가 'issued' 로 둔다).
          //   예전엔 paidCount 만 올리고 미발행을 세지 않아, 사업자 고객 단건 청구는 입금만 하면 세금계산서를 안 끊어도
          //   «세금계산서 발행: 완료» 였다(Fable 2026-11-04 실측 — 성주재단 같은 가장 흔한 모양).
          paidCount++;
          if (inv.tax_invoice_status !== 'issued') pendingCount++;
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

  // 지금 거래가 와 있는 자리부터 본다 — 뒤 단계에 이미 문서·청구가 붙었으면(계약 없이 바로 청구 등)
  //   그 앞의 빈 단계를 «다음 할 일» 로 내밀지 않는다. 앞 단계는 단계판에서 [완료 처리]·[건너뛰기] 로 정리할 수 있다.
  let from = 0;
  stages.forEach((s, i) => { if (s.linked_entity_id || s.status === 'completed') from = i; });
  const rest = stages.slice(from);
  const target = rest.find(s => s.status === 'active') || rest.find(s => s.status === 'pending');
  if (!target) return null;

  // entity 정보를 한 번 더 찾아 액션 컨텍스트 만들기
  return await deriveActionForStage(target, projectId);
}

async function deriveActionForStage(stage, projectId) {
  const base = { stage_id: stage.id, stage_kind: stage.kind, stage_label: stage.label, status: stage.status };

  switch (stage.kind) {
    case 'quote': {
      const quote = await Post.findOne({
        where: { project_id: projectId, category: { [Op.in]: categoriesFor('quote') }, status: 'published' },
        order: [['created_at', 'DESC']],
      });
      const draftQuote = quote ? null : await Post.findOne({
        where: { project_id: projectId, category: { [Op.in]: categoriesFor('quote') }, status: 'draft' },
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
      const proposal = await Post.findOne({ where: { project_id: projectId, category: { [Op.in]: categoriesFor('proposal') }, status: 'published' } });
      if (proposal) return { ...base, action_kind: 'wait_or_proceed', label: '제안서 발행됨', hint: 'SOW 단계로 진행', link: null };
      return { ...base, action_kind: 'create_post', label: '제안서 작성하기', hint: '이 프로젝트의 문서 탭에서 새 제안서 작성', link: `/projects/p/${projectId}?tab=docs&new=1&category=proposal` };
    }
    case 'contract': {
      // 단계판과 같은 판정(pickContractPost) — 계약서가 둘 이상일 때 두 곳이 다른 문서를 보던 것(2026-11-04 Fable B-1)
      const { posts, sigsByPost, billingPostIds } = await loadDealDocs(projectId);
      const pick = pickContractPost(posts, sigsByPost, billingPostIds);
      const post = pick ? pick.post : null;
      if (!post) {
        // 발행 전 계약서 초안이 있으면 그것부터 마무리
        const draft = await Post.findOne({ where: { project_id: projectId, status: 'draft', category: { [Op.in]: categoriesFor('contract', 'sow') } }, order: [['created_at', 'DESC']], attributes: ['id', 'title'] });
        if (draft) {
          return { ...base, action_kind: 'publish_post', label: '계약서 마무리하기', hint: `${draft.title} — 초안을 발행하면 서명을 받을 수 있습니다`, link: `/projects/p/${projectId}?tab=docs&post=${draft.id}` };
        }
        return { ...base, action_kind: 'create_post', label: '계약서 작성하기', hint: '계약/SOW 를 작성하면 서명 받기로 진행', link: `/projects/p/${projectId}?tab=docs&new=1&category=contract` };
      }
      // #239 — 위와 같은 이유로 kind:'sign' 한정 (확인 요청이 계약 체결 판정에 섞이면 안 된다).
      const sigs = pick.sigs;
      if (sigs.length === 0) {
        return { ...base, action_kind: 'request_signature', label: '서명 요청 보내기', hint: `${post.title} — 양사 서명을 받아 계약을 체결합니다`, link: `/projects/p/${projectId}?tab=docs&post=${post.id}&action=sign` };
      }
      const allSigned = sigs.every(s => s.status === 'signed');
      if (allSigned) {
        return { ...base, action_kind: 'wait_or_proceed', label: '계약 체결 완료', hint: '청구서 발행 단계로 진행', link: null };
      }
      // 고객 «수정 요청»(2026-10-22) — 거절과 다음 행동이 다르다: 같은 문서를 고쳐 다시 보낸다(services/signatureRound)
      if (sigs.some(s => s.status === 'rejected' && s.rejected_kind === 'revise')) {
        return { ...base, action_kind: 'review_signature', label: '수정 요청 받음', hint: '서명 진행에서 [고쳐서 다시 보내기] 후 재요청', link: `/projects/p/${projectId}?tab=docs&post=${post.id}` };
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
          ? `/bills?tab=invoices&new=1&split=1&from_post=${latestPostId}&project=${projectId}`
          : `/bills?tab=invoices&new=1&project=${projectId}`;
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
      // 모두 paid — 구독형은 다음 회차를 기다린다(세금계산서 단계가 없을 수도 있다)
      if (stage.metadata?.recurring) return { ...base, action_kind: 'wait_or_proceed', label: '이번 회차 결제 완료', hint: '다음 회차 청구를 기다립니다', link: null };
      return { ...base, action_kind: 'wait_or_proceed', label: '결제 완료', hint: '세금계산서 단계로 진행', link: null };
    }
    case 'tax_invoice': {
      const invoices = await Invoice.findAll({
        where: { project_id: projectId },
        include: [
          { model: InvoiceInstallment, as: 'installments', separate: true },
          { model: Client, attributes: ['is_business', 'country', 'biz_name', 'display_name'] },
        ],
        order: [['created_at', 'ASC']],
      });
      // 사업자 고객(국내) + paid + 세금계산서 미발행 — 분할은 회차, 단건은 청구서 자체(엔진 판정과 같은 술어)
      for (const inv of invoices) {
        if (!inv.Client?.is_business || (inv.Client?.country || 'KR') !== 'KR') continue;
        const insts = inv.installments || [];
        if (inv.installment_mode === 'split' && insts.length > 0) {
          const target = insts.find(i => i.status === 'paid' && !i.tax_invoice_no);
          if (target) {
            return { ...base, action_kind: 'mark_tax_invoice', label: '세금계산서 발행하기', hint: `${inv.invoice_number} · ${target.label} · 외부 발행 후 번호 마킹`, link: `/bills?tab=invoices&invoice=${inv.id}` };
          }
        } else if (inv.status === 'paid' && inv.tax_invoice_status !== 'issued') {
          return { ...base, action_kind: 'mark_tax_invoice', label: '세금계산서 발행하기', hint: `${inv.invoice_number} · 외부 발행 후 번호 마킹`, link: `/bills?tab=invoices&invoice=${inv.id}` };
        }
      }
      return { ...base, action_kind: 'wait_or_proceed', label: '세금계산서 처리 완료', hint: null, link: null };
    }
    default:
      return { ...base, action_kind: 'custom', label: stage.label, hint: '사용자 정의 단계', link: null };
  }
}

async function findContractPostId(projectId) {
  // 실계약(pickContractPost)이 있으면 그 문서, 없으면 최근 견적서라도
  const { posts, sigsByPost, billingPostIds } = await loadDealDocs(projectId);
  const pick = pickContractPost(posts, sigsByPost, billingPostIds);
  if (pick) return pick.post.id;
  const quotes = posts.filter((p) => p.category === 'quote' && p.status === 'published');
  return quotes.length ? quotes[quotes.length - 1].id : null;
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
  dealKindOf,
  categoriesFor,
  pickContractPost,
  loadDealDocs,
  dealDocsWhere,
  seedStages,
  progressProject,
  computeNextAction,
  onPostChanged,
  onSignatureChanged,
  onInvoiceChanged,
};
