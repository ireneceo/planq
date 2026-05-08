// 시스템 preset 업무 템플릿 시드 (사이클 N+1)
// 실행: node scripts/seed-task-templates.js
// is_system=true & business_id=NULL 로 등록. 모든 워크스페이스에서 공유.
require('dotenv').config();
const { TaskTemplate, TaskTemplateItem, sequelize } = require('../models');

// 결과물 기반 명명 강제 — 모든 title 이 작성/발행/제작/등록/배포/런칭 등 완료-시점 명사로 끝남.
const PRESETS = [
  {
    name: 'WordPress 블로그 사이트',
    description: '디자인부터 SEO 까지 — 21일 안에 런칭.',
    category: 'web_dev',
    items: [
      { t: '요구사항 정의서 작성', off: 0, dur: 2, h: 8, role: '기획자', deps: null },
      { t: '사이트맵 + 와이어프레임 작성', off: 2, dur: 2, h: 12, role: '디자이너', deps: [0] },
      { t: '메인 페이지 디자인 시안 작성', off: 4, dur: 3, h: 24, role: '디자이너', deps: [1] },
      { t: '서브 페이지 디자인 시안 작성', off: 4, dur: 3, h: 16, role: '디자이너', deps: [1] },
      { t: 'WordPress 환경 셋업 + 테마 베이스 구축', off: 4, dur: 2, h: 12, role: '개발자', deps: [0] },
      { t: '메인 페이지 퍼블리싱', off: 7, dur: 3, h: 16, role: '개발자', deps: [2, 4] },
      { t: '서브 페이지 퍼블리싱', off: 7, dur: 3, h: 12, role: '개발자', deps: [3, 4] },
      { t: '컨텐츠 입력 + 이미지 최적화', off: 12, dur: 3, h: 16, role: '운영자', deps: [5, 6] },
      { t: 'SEO 메타 + sitemap.xml 등록', off: 15, dur: 1, h: 4, role: '마케터', deps: [7] },
      { t: '크로스브라우저 + 모바일 QA 보고서 작성', off: 16, dur: 2, h: 8, role: 'QA', deps: [7] },
      { t: '런칭 체크리스트 발행', off: 18, dur: 1, h: 4, role: '기획자', deps: [8, 9] },
      { t: '도메인 + DNS 배포 완료', off: 19, dur: 2, h: 4, role: '개발자', deps: [10], priority: 'high' },
    ],
  },
  {
    name: 'React/Next.js 웹앱',
    description: 'SaaS 또는 대시보드 — 30일 1차 런칭.',
    category: 'web_dev',
    items: [
      { t: '제품 요구사항 문서 작성', off: 0, dur: 3, h: 16, role: '기획자', deps: null },
      { t: '데이터 모델 + ERD 작성', off: 3, dur: 2, h: 12, role: '백엔드', deps: [0] },
      { t: 'API 명세서 작성', off: 5, dur: 2, h: 12, role: '백엔드', deps: [1] },
      { t: 'UX 플로우 + 와이어프레임 작성', off: 3, dur: 3, h: 16, role: '디자이너', deps: [0] },
      { t: 'UI 디자인 시안 작성', off: 6, dur: 5, h: 32, role: '디자이너', deps: [3] },
      { t: 'Next.js 프로젝트 셋업 + CI 구축', off: 5, dur: 2, h: 8, role: '개발자', deps: [0] },
      { t: 'DB 스키마 + 마이그레이션 작성', off: 7, dur: 2, h: 8, role: '백엔드', deps: [1] },
      { t: '인증 + 세션 모듈 구축', off: 9, dur: 3, h: 16, role: '백엔드', deps: [6] },
      { t: '핵심 API 엔드포인트 구현', off: 12, dur: 5, h: 40, role: '백엔드', deps: [7] },
      { t: '프론트 컴포넌트 라이브러리 작성', off: 11, dur: 5, h: 24, role: '프론트엔드', deps: [4] },
      { t: '핵심 페이지 통합', off: 16, dur: 5, h: 32, role: '프론트엔드', deps: [8, 9] },
      { t: '이메일 알림 통합 완료', off: 21, dur: 2, h: 8, role: '백엔드', deps: [8] },
      { t: '결제 통합 완료', off: 21, dur: 3, h: 16, role: '백엔드', deps: [8] },
      { t: 'E2E 테스트 작성', off: 24, dur: 3, h: 16, role: 'QA', deps: [10, 11, 12] },
      { t: '베타 사용자 온보딩 가이드 작성', off: 25, dur: 2, h: 8, role: '기획자', deps: [10] },
      { t: '런칭 체크리스트 발행', off: 27, dur: 1, h: 4, role: '기획자', deps: [13, 14] },
      { t: '운영 환경 배포 완료', off: 28, dur: 2, h: 8, role: '개발자', deps: [15], priority: 'high' },
      { t: '런칭 회고 + 다음 스프린트 정의서 작성', off: 30, dur: 2, h: 8, role: '기획자', deps: [16] },
    ],
  },
  {
    name: '마케팅 캠페인 (기획→실행→분석)',
    description: '4주 캠페인 — 채널 분배·콘텐츠·광고·리포트.',
    category: 'marketing',
    items: [
      { t: '캠페인 목표 + KPI 정의서 작성', off: 0, dur: 2, h: 8, role: '마케터', deps: null },
      { t: '타겟 페르소나 + 메시지 가이드 작성', off: 2, dur: 2, h: 8, role: '마케터', deps: [0] },
      { t: '채널별 예산 배분표 작성', off: 4, dur: 1, h: 4, role: '마케터', deps: [1] },
      { t: '랜딩 페이지 + 광고 소재 디자인 시안 작성', off: 5, dur: 5, h: 24, role: '디자이너', deps: [1] },
      { t: '랜딩 페이지 퍼블리싱 + 트래킹 코드 삽입', off: 10, dur: 2, h: 8, role: '개발자', deps: [3] },
      { t: '광고 캠페인 셋업 + 소재 검수 완료', off: 11, dur: 2, h: 8, role: '마케터', deps: [3] },
      { t: '캠페인 런칭', off: 13, dur: 1, h: 2, role: '마케터', deps: [4, 5], priority: 'high' },
      { t: '주간 성과 리포트 1차 발행', off: 20, dur: 1, h: 4, role: '마케터', deps: [6] },
      { t: '주간 성과 리포트 2차 + 최적화 적용', off: 25, dur: 2, h: 8, role: '마케터', deps: [7] },
      { t: '캠페인 종합 분석 보고서 작성', off: 28, dur: 2, h: 12, role: '마케터', deps: [8] },
    ],
  },
  {
    name: '콘텐츠 시리즈 (블로그 4편)',
    description: '주제 발굴부터 발행까지 — 2주.',
    category: 'marketing',
    items: [
      { t: '콘텐츠 주제 리스트 작성', off: 0, dur: 1, h: 4, role: '에디터', deps: null },
      { t: '편집 일정표 작성', off: 1, dur: 1, h: 2, role: '에디터', deps: [0] },
      { t: '1편 초안 작성', off: 2, dur: 2, h: 8, role: '에디터', deps: [1] },
      { t: '2편 초안 작성', off: 4, dur: 2, h: 8, role: '에디터', deps: [1] },
      { t: '3편 초안 작성', off: 6, dur: 2, h: 8, role: '에디터', deps: [1] },
      { t: '4편 초안 작성', off: 8, dur: 2, h: 8, role: '에디터', deps: [1] },
      { t: '검수 + 이미지 첨부 완료', off: 10, dur: 2, h: 6, role: '디자이너', deps: [2, 3, 4, 5] },
      { t: '발행 일정 등록 + 발행 완료', off: 12, dur: 2, h: 4, role: '마케터', deps: [6] },
    ],
  },
  {
    name: '신규 고객사 온보딩',
    description: '계약 후 첫 결과물 납품까지 — 2주.',
    category: 'sales',
    items: [
      { t: '킥오프 미팅 회의록 작성', off: 0, dur: 1, h: 4, role: '영업', deps: null },
      { t: '요구사항 정의서 작성', off: 1, dur: 3, h: 12, role: '기획자', deps: [0] },
      { t: '계약서 + NDA 발행', off: 1, dur: 2, h: 4, role: '영업', deps: [0] },
      { t: '결제 일정 + 청구서 1차 발행', off: 3, dur: 1, h: 2, role: '영업', deps: [2] },
      { t: '프로젝트 채널 + 폴더 구조 등록', off: 3, dur: 1, h: 2, role: '운영', deps: [2] },
      { t: '시스템 접속 권한 + 자료 공유 완료', off: 4, dur: 1, h: 2, role: '운영', deps: [4] },
      { t: '주간 진행 리포트 1차 발행', off: 9, dur: 1, h: 4, role: '기획자', deps: [1] },
      { t: '1차 결과물 검수 회의록 작성', off: 12, dur: 1, h: 2, role: '기획자', deps: [6] },
      { t: '온보딩 종료 보고서 작성', off: 14, dur: 1, h: 4, role: '영업', deps: [7] },
    ],
  },
  {
    name: '견적·계약·제작·납품',
    description: '단발 프로젝트 표준 흐름 — 10일.',
    category: 'sales',
    items: [
      { t: '요청사항 + 견적 명세서 작성', off: 0, dur: 1, h: 4, role: '영업', deps: null },
      { t: '견적서 발행', off: 1, dur: 1, h: 2, role: '영업', deps: [0] },
      { t: '계약서 발행 + 서명 완료', off: 2, dur: 1, h: 4, role: '영업', deps: [1] },
      { t: '청구서 1차 발행 (계약금)', off: 3, dur: 1, h: 1, role: '영업', deps: [2] },
      { t: '제작 완료', off: 4, dur: 4, h: 24, role: '제작', deps: [3], priority: 'high' },
      { t: '검수 + 수정사항 반영', off: 8, dur: 1, h: 4, role: '제작', deps: [4] },
      { t: '납품 + 잔금 청구서 발행', off: 10, dur: 1, h: 2, role: '영업', deps: [5] },
    ],
  },
  {
    name: '채용 프로세스',
    description: 'JD 작성부터 입사까지 — 3주.',
    category: 'ops',
    items: [
      { t: '직무 기술서 (JD) 작성', off: 0, dur: 1, h: 4, role: '인사', deps: null },
      { t: '채용 공고 등록', off: 1, dur: 1, h: 2, role: '인사', deps: [0] },
      { t: '서류 검토 보고서 작성', off: 7, dur: 2, h: 8, role: '인사', deps: [1] },
      { t: '1차 면접 진행 + 평가표 작성', off: 10, dur: 3, h: 12, role: '인사', deps: [2] },
      { t: '2차 면접 + 최종 합격 통보 발송', off: 14, dur: 3, h: 8, role: '인사', deps: [3] },
      { t: '입사 안내 + 계약서 발송', off: 19, dur: 2, h: 4, role: '인사', deps: [4] },
    ],
  },
  {
    name: '분기 회고',
    description: '데이터 수집 → 토론 → 액션 아이템.',
    category: 'ops',
    items: [
      { t: '분기 KPI 데이터 정리표 작성', off: 0, dur: 2, h: 8, role: '기획자', deps: null },
      { t: '회고 안건 + 진행자료 작성', off: 2, dur: 1, h: 4, role: '기획자', deps: [0] },
      { t: '회고 미팅 회의록 작성', off: 5, dur: 1, h: 2, role: '기획자', deps: [1] },
      { t: '액션 아이템 + 다음 분기 OKR 발행', off: 7, dur: 2, h: 8, role: '기획자', deps: [2] },
    ],
  },
  {
    name: '쇼핑몰 구축',
    description: '카페24/Shopify 기반 — 6주.',
    category: 'web_dev',
    items: [
      { t: '상품 카탈로그 + 카테고리 정의서 작성', off: 0, dur: 3, h: 12, role: '기획자', deps: null },
      { t: '결제 + 배송 정책 문서 작성', off: 0, dur: 2, h: 8, role: '운영', deps: null },
      { t: '브랜드 가이드 + 상세페이지 디자인 시안 작성', off: 3, dur: 7, h: 32, role: '디자이너', deps: [0] },
      { t: '플랫폼 셋업 + 기본 테마 적용', off: 3, dur: 3, h: 12, role: '개발자', deps: [0] },
      { t: '결제 모듈 통합 완료', off: 6, dur: 4, h: 16, role: '개발자', deps: [1, 3] },
      { t: '배송 모듈 통합 완료', off: 6, dur: 3, h: 12, role: '개발자', deps: [1, 3] },
      { t: '상품 등록 (1차 — 핵심 30개)', off: 10, dur: 5, h: 24, role: '운영', deps: [3] },
      { t: '상세페이지 퍼블리싱', off: 10, dur: 7, h: 40, role: '개발자', deps: [2, 3] },
      { t: '메인 + 카테고리 페이지 퍼블리싱', off: 14, dur: 4, h: 20, role: '개발자', deps: [2, 3] },
      { t: '회원가입 + 마이페이지 통합', off: 18, dur: 3, h: 16, role: '개발자', deps: [4] },
      { t: '쿠폰 + 적립금 정책 셋업', off: 21, dur: 2, h: 8, role: '운영', deps: [9] },
      { t: '주문 알림 + 이메일 템플릿 작성', off: 23, dur: 2, h: 8, role: '운영', deps: [4, 5] },
      { t: '결제 테스트 시나리오 보고서 작성', off: 25, dur: 2, h: 8, role: 'QA', deps: [4] },
      { t: '배송 테스트 시나리오 보고서 작성', off: 25, dur: 2, h: 8, role: 'QA', deps: [5] },
      { t: '상품 등록 (2차 — 잔여)', off: 27, dur: 5, h: 24, role: '운영', deps: [6] },
      { t: '인스타 + 네이버 SEO 최적화 등록', off: 32, dur: 3, h: 12, role: '마케터', deps: [8] },
      { t: '런칭 마케팅 캠페인 셋업', off: 35, dur: 3, h: 16, role: '마케터', deps: [15] },
      { t: 'QA 최종 보고서 발행', off: 38, dur: 2, h: 8, role: 'QA', deps: [12, 13] },
      { t: '내부 베타 회의록 작성', off: 40, dur: 1, h: 4, role: '기획자', deps: [17] },
      { t: '런칭 + 모니터링 보고서 작성', off: 42, dur: 3, h: 12, role: '운영', deps: [16, 17, 18], priority: 'high' },
    ],
  },
];

(async () => {
  try {
    console.log('Seeding system task templates...');
    let createdCount = 0;
    let skippedCount = 0;

    for (const preset of PRESETS) {
      const existing = await TaskTemplate.findOne({
        where: { is_system: true, business_id: null, name: preset.name },
      });
      if (existing) {
        console.log(`  [skip] ${preset.name} (already exists, id=${existing.id})`);
        skippedCount++;
        continue;
      }

      const total = preset.items.length > 0
        ? Math.max(...preset.items.map(i => i.off + i.dur))
        : 0;

      const tpl = await TaskTemplate.create({
        business_id: null,
        name: preset.name,
        description: preset.description,
        category: preset.category,
        is_system: true,
        is_default: false,
        total_duration_days: total,
        task_count: preset.items.length,
        usage_count: 0,
      });

      for (let i = 0; i < preset.items.length; i++) {
        const it = preset.items[i];
        await TaskTemplateItem.create({
          template_id: tpl.id,
          order_index: i,
          title: it.t,
          start_offset_days: it.off,
          duration_days: it.dur,
          estimated_hours: it.h || null,
          priority: it.priority || 'normal',
          role_hint: it.role || null,
          depends_on_indexes: it.deps || null,
        });
      }
      console.log(`  [+] ${preset.name} — ${preset.items.length} items, ${total}d (id=${tpl.id})`);
      createdCount++;
    }

    console.log(`\nSeeded: ${createdCount} created, ${skippedCount} skipped`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('Seed error:', e.message, e.stack);
    process.exit(1);
  }
})();
