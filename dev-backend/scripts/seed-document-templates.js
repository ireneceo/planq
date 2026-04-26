// 시스템 기본 문서 템플릿 seed — 7종 (견적·청구·NDA·제안·회의록·계약·SOW)
// 멱등성: kind+is_system+name 기준 upsert.
// 실행: node scripts/seed-document-templates.js
//
// 시스템 템플릿(is_system=true, business_id=null) — 모든 워크스페이스 무관 노출.
// HTML: Tiptap table 호환 (<table><tbody><tr><th|td>…). 30년차 컨설팅 표준 양식.
//
// 변수 치환은 frontend renderTemplateClient() 가 처리:
//   {{business.name}} {{business.biz_number}} {{business.ceo}} {{business.address}}
//   {{business.phone}} {{business.email}} {{business.bank_account}}
//   {{client.name}} {{client.contact_name}} {{client.email}} {{client.phone}} {{client.address}}
//   {{title}} {{issued_at}} {{valid_until}} {{currency}} {{quote_number}} {{invoice_number}}
//   {{effective_date}} {{duration_months}} {{party_a.name}} {{party_b.name}}

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../config/database');
const { DocumentTemplate } = require('../models');

// ════════════════════════════════════════════════════════════════
// 1. 견적서 — 8 column 품목표 + 추가비용 + 결제분할 + 인도/AS + 가정/제외
// ════════════════════════════════════════════════════════════════
const QUOTE_BODY = `<h1>견 적 서 (QUOTATION)</h1>
<table><tbody>
<tr><th>견적번호</th><td>{{quote_number}}</td><th>발행일</th><td>{{issued_at}}</td></tr>
<tr><th>유효기간</th><td>{{valid_until}}</td><th>통화</th><td>{{currency}}</td></tr>
<tr><th>제목 / 프로젝트</th><td colspan="3">{{title}}</td></tr>
</tbody></table>

<h2>1. 공급자 (Issuer)</h2>
<table><tbody>
<tr><th>회사명</th><td>{{business.name}}</td><th>대표자</th><td>{{business.ceo}}</td></tr>
<tr><th>사업자등록번호</th><td>{{business.biz_number}}</td><th>업태 / 종목</th><td>—</td></tr>
<tr><th>주소</th><td colspan="3">{{business.address}}</td></tr>
<tr><th>전화</th><td>{{business.phone}}</td><th>이메일</th><td>{{business.email}}</td></tr>
<tr><th>담당자</th><td>—</td><th>직위</th><td>—</td></tr>
</tbody></table>

<h2>2. 공급받는 자 (Customer)</h2>
<table><tbody>
<tr><th>고객사</th><td>{{client.name}}</td><th>담당자</th><td>{{client.contact_name}}</td></tr>
<tr><th>이메일</th><td>{{client.email}}</td><th>전화</th><td>{{client.phone}}</td></tr>
<tr><th>주소</th><td colspan="3">{{client.address}}</td></tr>
</tbody></table>

<h2>3. 제안 요약</h2>
<p><em>(고객 과제와 본 견적이 해결하는 핵심 가치 1~2 문장)</em></p>

<h2>4. 견적 항목</h2>
<table><tbody>
<tr><th>No.</th><th>품목 / 작업</th><th>규격 / 산출물</th><th>단위</th><th>수량</th><th>단가</th><th>금액</th><th>비고</th></tr>
<tr><td>1</td><td>—</td><td>—</td><td>식</td><td>1</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>2</td><td>—</td><td>—</td><td>식</td><td>1</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>3</td><td>—</td><td>—</td><td>식</td><td>1</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>4</td><td>—</td><td>—</td><td>식</td><td>1</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>5</td><td>—</td><td>—</td><td>식</td><td>1</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>5. 추가 비용</h2>
<table><tbody>
<tr><th>항목</th><th>내역</th><th>금액</th></tr>
<tr><td>출장비</td><td>지방 출장 1회당 — 발생 시 별도 청구</td><td>실비</td></tr>
<tr><td>외주 / 라이선스</td><td>—</td><td>실비</td></tr>
<tr><td>예비비 (Contingency)</td><td>총액의 10% 이내</td><td>—</td></tr>
</tbody></table>

<h2>6. 금액 합계</h2>
<table><tbody>
<tr><th>공급가액 (Subtotal)</th><td>—</td></tr>
<tr><th>할인</th><td>—</td></tr>
<tr><th>부가세 (VAT 10%)</th><td>—</td></tr>
<tr><th>총 견적 금액</th><td><strong>—</strong></td></tr>
</tbody></table>
<p style="color:#64748B;font-size:12px;">※ 부가가치세 별도 표기 시 위 금액에 10% 추가됩니다.</p>

<h2>7. 결제 조건</h2>
<table><tbody>
<tr><th>구분</th><th>비율</th><th>지급 시점</th><th>금액</th></tr>
<tr><td>선금</td><td>30%</td><td>계약 체결 시</td><td>—</td></tr>
<tr><td>중도금</td><td>40%</td><td>중간 검수 통과 시</td><td>—</td></tr>
<tr><td>잔금</td><td>30%</td><td>최종 검수 후 14일 이내</td><td>—</td></tr>
</tbody></table>
<p>입금 계좌: {{business.bank_account}} (예금주: {{business.name}})</p>

<h2>8. 납기 / 인도 조건</h2>
<table><tbody>
<tr><th>착수일</th><td>계약 체결 후 7영업일 이내</td></tr>
<tr><th>완료일</th><td>—</td></tr>
<tr><th>인도 방법</th><td>온라인 자료 전달 / 운영 환경 배포 / 현장 설치 (택1)</td></tr>
<tr><th>무상 A/S 기간</th><td>최종 검수일로부터 3개월</td></tr>
</tbody></table>

<h2>9. 가정 / 제외 사항</h2>
<ul>
<li><strong>포함</strong>: 본 견적 항목에 명시된 산출물, 1회 통합 검수, 무상 A/S 기간 내 버그 수정.</li>
<li><strong>제외</strong>: 추가 기능 개발, 디자인 전면 개편, 외부 시스템 연동 (별도 견적), 운영 단계 인프라 비용.</li>
<li>고객 자료 / 의사결정 지연으로 인한 일정 변동은 별도 협의.</li>
<li>본 견적은 위 조건에 한해 유효하며, 범위 변경 시 재견적 발행.</li>
</ul>

<h2>10. 서명</h2>
<table><tbody>
<tr><th></th><th>공급자</th><th>공급받는 자</th></tr>
<tr><td>회사명</td><td>{{business.name}}</td><td>{{client.name}}</td></tr>
<tr><td>대표자</td><td>{{business.ceo}}</td><td>—</td></tr>
<tr><td>서명 / 날인</td><td>—</td><td>—</td></tr>
<tr><td>일자</td><td>{{issued_at}}</td><td>—</td></tr>
</tbody></table>`;

// ════════════════════════════════════════════════════════════════
// 2. 청구서 — 참조 + 세금계산서 발행정보 + 결제(국내/SWIFT) + 연체이자
// ════════════════════════════════════════════════════════════════
const INVOICE_BODY = `<h1>청 구 서 (INVOICE)</h1>
<table><tbody>
<tr><th>청구번호</th><td>{{invoice_number}}</td><th>발행일</th><td>{{issued_at}}</td></tr>
<tr><th>결제 기한</th><td>{{due_date}}</td><th>통화</th><td>{{currency}}</td></tr>
</tbody></table>

<h2>1. 참조</h2>
<table><tbody>
<tr><th>견적번호</th><td>—</td><th>계약번호</th><td>—</td></tr>
<tr><th>고객 PO 번호</th><td>—</td><th>프로젝트명</th><td>—</td></tr>
</tbody></table>

<h2>2. 공급자</h2>
<table><tbody>
<tr><th>회사명</th><td>{{business.name}}</td><th>대표자</th><td>{{business.ceo}}</td></tr>
<tr><th>사업자등록번호</th><td>{{business.biz_number}}</td><th>업태 / 종목</th><td>—</td></tr>
<tr><th>주소</th><td colspan="3">{{business.address}}</td></tr>
<tr><th>전화</th><td>{{business.phone}}</td><th>이메일</th><td>{{business.email}}</td></tr>
</tbody></table>

<h2>3. 청구처</h2>
<table><tbody>
<tr><th>고객사</th><td>{{client.name}}</td><th>담당자</th><td>{{client.contact_name}}</td></tr>
<tr><th>사업자등록번호</th><td>—</td><th>대표자</th><td>—</td></tr>
<tr><th>이메일</th><td>{{client.email}}</td><th>전화</th><td>{{client.phone}}</td></tr>
<tr><th>주소</th><td colspan="3">{{client.address}}</td></tr>
</tbody></table>

<h2>4. 청구 항목</h2>
<table><tbody>
<tr><th>No.</th><th>내역</th><th>기간</th><th>수량</th><th>단가</th><th>금액</th></tr>
<tr><td>1</td><td>—</td><td>—</td><td>1</td><td>—</td><td>—</td></tr>
<tr><td>2</td><td>—</td><td>—</td><td>1</td><td>—</td><td>—</td></tr>
<tr><td>3</td><td>—</td><td>—</td><td>1</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>5. 금액 합계</h2>
<table><tbody>
<tr><th>공급가액 (Subtotal)</th><td>—</td></tr>
<tr><th>부가세 (VAT 10%)</th><td>—</td></tr>
<tr><th>총 청구액</th><td><strong>—</strong></td></tr>
</tbody></table>

<h2>6. 결제 정보 (국내)</h2>
<table><tbody>
<tr><th>결제 방법</th><td>계좌이체 / 카드 / 가상계좌</td></tr>
<tr><th>입금 계좌</th><td>{{business.bank_account}}</td></tr>
<tr><th>예금주</th><td>{{business.name}}</td></tr>
<tr><th>가상계좌</th><td>—</td></tr>
</tbody></table>

<h2>7. 해외 결제 정보 (Wire Transfer)</h2>
<table><tbody>
<tr><th>Beneficiary</th><td>{{business.name}}</td></tr>
<tr><th>Bank Name</th><td>—</td></tr>
<tr><th>Bank Address</th><td>—</td></tr>
<tr><th>SWIFT / BIC Code</th><td>—</td></tr>
<tr><th>Account No.</th><td>—</td></tr>
</tbody></table>

<h2>8. 세금계산서</h2>
<p>세금계산서가 필요하시면 다음 정보를 회신 메일로 보내주세요.</p>
<ul>
<li>사업자등록번호 · 회사명 · 대표자명</li>
<li>업태 / 종목</li>
<li>세금계산서 수신 이메일</li>
</ul>

<h2>9. 연체 / 지연 손해금</h2>
<p>결제 기한을 초과할 경우, 미납 금액의 <strong>연 12%</strong>에 해당하는 지연 손해금이 발생할 수 있으며, 30일 이상 미납 시 서비스 이용이 제한될 수 있습니다.</p>

<h2>10. 비고</h2>
<p>—</p>

<p style="background:#FFF7ED;padding:14px;border-radius:8px;color:#9A3412;margin-top:16px;">
<strong>안내</strong> · 결제 기한({{due_date}}) 내 입금 부탁드리며, 입금자명은 청구번호({{invoice_number}}) 또는 회사명으로 표기해 주세요. 문의: {{business.email}} / {{business.phone}}
</p>`;

// ════════════════════════════════════════════════════════════════
// 3. NDA — 비밀정보 분류표·반환·파기·존속·분쟁해결·서명
// ════════════════════════════════════════════════════════════════
const NDA_BODY = `<h1>비밀유지계약서 (Non-Disclosure Agreement)</h1>
<p><strong>{{party_a.name}}</strong>(이하 "갑")과 <strong>{{party_b.name}}</strong>(이하 "을")은 상호 협력 과정에서 알게 된 비밀 정보의 보호를 위하여 다음과 같이 비밀유지계약(이하 "본 계약")을 체결한다.</p>

<h2>제1조 (목적)</h2>
<p>본 계약은 양 당사자가 협력 과정에서 알게 된 비밀 정보의 유지·보호 및 사용 범위를 정함을 목적으로 한다.</p>

<h2>제2조 (비밀정보의 정의 및 분류)</h2>
<p>본 계약에서 "비밀정보"란 한 당사자가 다른 당사자에게 서면·구두·전자적 형태로 제공하거나 알게 된 모든 정보로서, 다음 각 호에 따라 등급별로 분류된다.</p>
<table><tbody>
<tr><th>등급</th><th>구분</th><th>예시</th><th>접근 권한</th></tr>
<tr><td>1급 (극비)</td><td>기술 / 영업</td><td>소스코드 · 알고리즘 · 고객 명단 · 가격 정책 · 재무 데이터</td><td>합의된 핵심 인력만</td></tr>
<tr><td>2급 (대외비)</td><td>인사 / 운영</td><td>조직도 · 인력 정책 · 급여 · 사내 매뉴얼 · 협력사 정보</td><td>업무 수행 인력</td></tr>
<tr><td>3급 (내부)</td><td>기타</td><td>합리적으로 비밀로 분류될 수 있는 정보</td><td>임직원 일반</td></tr>
</tbody></table>

<h2>제3조 (유효 기간)</h2>
<p>본 계약은 <strong>{{effective_date}}</strong>부터 <strong>{{duration_months}}개월</strong>간 유효하며, 계약 만료 후에도 비밀유지의무는 종료일로부터 추가 <strong>3년간</strong> 존속한다.</p>

<h2>제4조 (의무)</h2>
<ul>
<li>비밀정보를 본 계약의 목적 외 사용하지 않는다.</li>
<li>사전 서면 동의 없이 제3자에게 공개·제공·복제하지 않는다.</li>
<li>비밀정보를 취급하는 임직원에 대하여 동등한 비밀유지의무를 부과하고, 명단을 상대방에게 통보할 수 있다.</li>
<li>비밀정보가 담긴 매체(문서·파일·디바이스)는 합리적 보안 조치(잠금·암호화·접근 제한)를 적용한다.</li>
</ul>

<h2>제5조 (예외)</h2>
<p>다음 정보는 본 계약의 비밀정보에서 제외된다.</p>
<ul>
<li>이미 공지된 사실</li>
<li>정당한 경로로 이미 알고 있던 정보 (서면 입증 가능)</li>
<li>법령·법원의 명령에 의한 공개 (이 경우 즉시 상대방에게 통지)</li>
<li>상대방의 서면 동의에 의한 공개</li>
</ul>

<h2>제6조 (반환 및 파기)</h2>
<p>계약 종료 또는 상대방의 요청 시 14일 이내에 다음과 같이 처리한다.</p>
<ul>
<li>물리적 자료: 반환 또는 파기 (파쇄·소각)</li>
<li>전자 자료: 영구 삭제 (백업 포함) 또는 암호화 보관 후 접근 차단</li>
<li>처리 결과를 서면(이메일 가능)으로 상대방에게 확인</li>
</ul>

<h2>제7조 (위반 시 책임)</h2>
<p>본 계약을 위반한 당사자는 상대방에게 발생한 손해를 배상하며, 영업비밀의 침해가 인정될 경우 「부정경쟁방지 및 영업비밀보호에 관한 법률」 및 관련 법령에 따른 형사·민사적 책임을 진다.</p>

<h2>제8조 (분쟁 해결)</h2>
<p>본 계약과 관련된 분쟁은 우선 양 당사자 간 협의를 통해 해결한다. 협의가 이루어지지 않을 경우, 갑의 주된 사무소 소재지를 관할하는 법원을 제1심 관할법원으로 하며, 양 당사자가 합의하는 경우 대한상사중재원의 중재로 해결할 수 있다.</p>

<h2>제9조 (효력 및 수정)</h2>
<p>본 계약은 위 효력일부터 효력이 발생하며, 양 당사자의 서명·날인으로 그 성립을 증명한다. 본 계약의 수정은 양 당사자의 서면 합의로만 효력이 있다.</p>

<h2>제10조 (연락 담당자)</h2>
<table><tbody>
<tr><th>구분</th><th>이름</th><th>이메일</th><th>전화</th></tr>
<tr><td>갑 측</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>을 측</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>서명</h2>
<table><tbody>
<tr><th>구분</th><th>회사명</th><th>대표자</th><th>서명 / 날인</th><th>일자</th></tr>
<tr><td>갑</td><td>{{party_a.name}}</td><td>—</td><td>—</td><td>{{effective_date}}</td></tr>
<tr><td>을</td><td>{{party_b.name}}</td><td>—</td><td>—</td><td>{{effective_date}}</td></tr>
</tbody></table>`;

// ════════════════════════════════════════════════════════════════
// 4. 제안서 — Executive Summary + 회사 + 레퍼런스 + 팀 + 차별화 + 리스크 + SLA
// ════════════════════════════════════════════════════════════════
const PROPOSAL_BODY = `<h1>{{title}}</h1>
<p style="color:#64748B;">제안 대상: <strong>{{client.name}}</strong> · 작성: <strong>{{business.name}}</strong> · 작성일: {{issued_at}} · 유효기간: {{valid_until}}</p>

<h2>Executive Summary</h2>
<p style="background:#F0FDFA;padding:14px;border-radius:8px;color:#0F766E;border-left:4px solid #14B8A6;">
<em>(3~5줄로 본 제안의 핵심 가치·차별화·기대 효과를 요약. 의사결정자가 이 부분만 봐도 결정 가능하도록.)</em>
</p>

<h2>1. 회사 소개</h2>
<table><tbody>
<tr><th>회사명</th><td>{{business.name}}</td></tr>
<tr><th>설립일</th><td>—</td></tr>
<tr><th>대표자</th><td>{{business.ceo}}</td></tr>
<tr><th>주요 사업</th><td>—</td></tr>
<tr><th>인원 / 규모</th><td>—</td></tr>
<tr><th>인증 / 자격</th><td>ISO·CMMI·정보보호 인증 등</td></tr>
</tbody></table>

<h2>2. 제안 배경 (현황 분석)</h2>
<p><em>고객의 현재 상황과 해결하고자 하는 문제를 구체적으로 서술. 데이터·인터뷰·관찰 근거 포함.</em></p>
<ul>
<li>현황 1 — 데이터/관찰 근거</li>
<li>현황 2 — 데이터/관찰 근거</li>
<li>핵심 과제 (Problem Statement)</li>
</ul>

<h2>3. 솔루션 제안</h2>
<p><strong>핵심 가치:</strong> <em>(1줄로 표현)</em></p>
<table><tbody>
<tr><th>핵심 기능 / 컴포넌트</th><th>고객이 얻는 이익</th><th>우선순위</th><th>관련 산출물</th></tr>
<tr><td>—</td><td>—</td><td>높음</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>높음</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>중간</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>중간</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>낮음</td><td>—</td></tr>
</tbody></table>

<h2>4. 차별화 포인트</h2>
<table><tbody>
<tr><th>경쟁사 대비</th><th>우리의 강점</th><th>증명</th></tr>
<tr><td>—</td><td>—</td><td>레퍼런스·수치·인증</td></tr>
<tr><td>—</td><td>—</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>5. 일정 / 마일스톤</h2>
<table><tbody>
<tr><th>마일스톤</th><th>기간</th><th>산출물</th><th>검수 기준</th><th>고객 참여</th></tr>
<tr><td>킥오프 / 요구사항 정의</td><td>1주</td><td>요구사항 정의서 · 일정표</td><td>고객 서면 승인</td><td>워크숍 1회</td></tr>
<tr><td>설계 / 프로토타입</td><td>2주</td><td>UI 설계도 · 동작 가능 프로토타입</td><td>중간 검수 통과</td><td>리뷰 1회</td></tr>
<tr><td>개발 / 통합</td><td>4주</td><td>핵심 기능 완성 빌드</td><td>QA 통과 (테스트 90%+)</td><td>주간 리뷰</td></tr>
<tr><td>UAT / 최종 검수</td><td>1주</td><td>UAT 보고서 · 운영 매뉴얼</td><td>고객 최종 승인</td><td>UAT 진행</td></tr>
<tr><td>배포 / 인수인계</td><td>1주</td><td>운영 환경 배포 · 인수인계 자료</td><td>운영 안정성 확인</td><td>인수 회의</td></tr>
</tbody></table>

<h2>6. 팀 구성 및 핵심 인력</h2>
<table><tbody>
<tr><th>역할</th><th>인원</th><th>경력</th><th>주요 업무</th></tr>
<tr><td>PM (프로젝트 매니저)</td><td>1</td><td>—년</td><td>일정 관리 · 의사소통 · 리스크 관리</td></tr>
<tr><td>리드 개발자</td><td>1</td><td>—년</td><td>아키텍처 · 코드 리뷰 · 품질 관리</td></tr>
<tr><td>개발자</td><td>—</td><td>—년</td><td>기능 구현</td></tr>
<tr><td>디자이너</td><td>1</td><td>—년</td><td>UI/UX 설계</td></tr>
<tr><td>QA</td><td>1</td><td>—년</td><td>테스트 · 검수</td></tr>
</tbody></table>

<h2>7. 레퍼런스 / 유사 사례</h2>
<table><tbody>
<tr><th>고객사</th><th>프로젝트</th><th>기간</th><th>주요 성과</th></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>8. 리스크 및 완화 방안</h2>
<table><tbody>
<tr><th>리스크</th><th>가능성</th><th>영향</th><th>완화 방안</th></tr>
<tr><td>요구사항 변경</td><td>중</td><td>중</td><td>변경 관리 절차 · 주간 리뷰 · CR 양식</td></tr>
<tr><td>외부 시스템 연동 지연</td><td>저</td><td>고</td><td>API 검증 단계 분리 · 모의 환경 구축</td></tr>
<tr><td>핵심 인력 이탈</td><td>저</td><td>고</td><td>지식 공유 문서 · 페어 작업 · 백업 인력</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>9. 견적 요약</h2>
<table><tbody>
<tr><th>구분</th><th>내용</th><th>금액</th></tr>
<tr><td>기본 패키지</td><td>—</td><td>—</td></tr>
<tr><td>커스터마이징 / 추가 기능</td><td>—</td><td>—</td></tr>
<tr><td>운영 / 유지보수 (3개월)</td><td>—</td><td>—</td></tr>
<tr><th>합계 (부가세 별도)</th><th>—</th><th>—</th></tr>
</tbody></table>
<p style="color:#64748B;font-size:12px;">상세 견적은 별도 견적서로 발행됩니다.</p>

<h2>10. SLA / 유지보수</h2>
<table><tbody>
<tr><th>구분</th><th>내용</th></tr>
<tr><td>장애 대응 시간</td><td>치명 1시간 이내 · 일반 24시간 이내 (영업일 기준)</td></tr>
<tr><td>가용성 (Uptime)</td><td>월 99.5% 이상</td></tr>
<tr><td>지원 시간</td><td>평일 09:00–18:00 (KST)</td></tr>
<tr><td>지원 채널</td><td>이메일 · 전용 슬랙·디스코드 · 전화 (긴급)</td></tr>
<tr><td>유지보수 기간</td><td>최종 검수일로부터 3개월 무상 + 월 단위 갱신</td></tr>
</tbody></table>

<h2>11. 다음 단계</h2>
<ol>
<li>본 제안서 검토 후 의견 회신 (~{{valid_until}})</li>
<li>온라인 또는 대면 미팅으로 세부 사항 조율</li>
<li>합의된 내용으로 견적서 · NDA · 용역 계약서 발행</li>
<li>킥오프 미팅 후 작업 시작</li>
</ol>
<p style="background:#F0FDFA;padding:14px;border-radius:8px;color:#0F766E;margin-top:16px;">
검토 후 의견 주시면 반영하여 최종안을 드리겠습니다. <strong>회신 기한: {{valid_until}}</strong> · 문의: {{business.email}} / {{business.phone}}
</p>`;

// ════════════════════════════════════════════════════════════════
// 5. 회의록 — 참석/결석 + 이전 액션 점검 + 결정·액션·첨부 + 배포대상
// ════════════════════════════════════════════════════════════════
const MEETING_NOTE_BODY = `<h1>{{session.title}}</h1>
<table><tbody>
<tr><th>일시</th><td>{{session.created_at}}</td><th>장소</th><td>{{session.location}}</td></tr>
<tr><th>주관 / 회의록 작성</th><td>{{session.host}}</td><th>회의 시간</th><td>—</td></tr>
</tbody></table>

<h2>참석자</h2>
<table><tbody>
<tr><th>이름</th><th>소속</th><th>역할</th><th>이메일</th></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>결석자 / 사전 의견 전달</h2>
<table><tbody>
<tr><th>이름</th><th>사유</th><th>사전 의견</th></tr>
<tr><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>안건</h2>
<ol>
<li>안건 1 — <em>(시간: ~분)</em></li>
<li>안건 2 — <em>(시간: ~분)</em></li>
<li>안건 3 — <em>(시간: ~분)</em></li>
</ol>

<h2>이전 회의 액션 아이템 점검</h2>
<table><tbody>
<tr><th>담당</th><th>내용</th><th>약속 마감</th><th>진행 상태</th><th>비고</th></tr>
<tr><td>—</td><td>—</td><td>—</td><td>완료 / 진행중 / 보류 / 취소</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>핵심 발언 / 논점</h2>
<p><em>(Q note 가 회의 종료 시 화자별 핵심 발언을 자동으로 채웁니다)</em></p>
<ul>
<li>—</li>
<li>—</li>
<li>—</li>
</ul>

<h2>결정 사항</h2>
<table><tbody>
<tr><th>안건</th><th>결정</th><th>근거 / 비고</th><th>의사결정자</th></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>

<h2>액션 아이템</h2>
<table><tbody>
<tr><th>No.</th><th>담당</th><th>내용</th><th>마감</th><th>우선순위</th><th>상태</th></tr>
<tr><td>1</td><td>—</td><td>—</td><td>—</td><td>높음</td><td>대기</td></tr>
<tr><td>2</td><td>—</td><td>—</td><td>—</td><td>중간</td><td>대기</td></tr>
<tr><td>3</td><td>—</td><td>—</td><td>—</td><td>낮음</td><td>대기</td></tr>
</tbody></table>
<p style="color:#64748B;font-size:12px;">액션 아이템은 Q Task 로 변환할 수 있습니다.</p>

<h2>이슈 / 미해결 안건 (Parking Lot)</h2>
<ul>
<li>—</li>
<li>—</li>
</ul>

<h2>첨부 자료</h2>
<ul>
<li>회의 자료 (PPT · PDF · 링크)</li>
<li>관련 문서 / 견적서 / 제안서</li>
<li>녹음 / 트랜스크립트 (Q note)</li>
</ul>

<h2>다음 회의</h2>
<table><tbody>
<tr><th>일시</th><td>—</td></tr>
<tr><th>장소 / 채널</th><td>—</td></tr>
<tr><th>주요 안건</th><td>—</td></tr>
<tr><th>사전 준비</th><td>—</td></tr>
</tbody></table>

<h2>배포 대상</h2>
<p>참석자 전원 + <em>(추가 배포 대상 명시: 결석자, 관련 부서, 고객사 등)</em></p>`;

// ════════════════════════════════════════════════════════════════
// 6. 용역 계약서 — 신규
// ════════════════════════════════════════════════════════════════
const CONTRACT_BODY = `<h1>용역 계약서 (Service Agreement)</h1>
<p><strong>{{business.name}}</strong>(이하 "갑")과 <strong>{{client.name}}</strong>(이하 "을")은 다음과 같이 용역 계약(이하 "본 계약")을 체결한다.</p>

<h2>제1조 (계약의 목적)</h2>
<p>본 계약은 갑이 을에게 제공하는 용역의 범위·대가·기간·권리관계 등을 명확히 정함을 목적으로 한다.</p>

<h2>제2조 (당사자 정보)</h2>
<table><tbody>
<tr><th>구분</th><th>회사명</th><th>대표자</th><th>사업자등록번호</th><th>주소</th></tr>
<tr><td>갑 (수급인)</td><td>{{business.name}}</td><td>{{business.ceo}}</td><td>{{business.biz_number}}</td><td>{{business.address}}</td></tr>
<tr><td>을 (도급인)</td><td>{{client.name}}</td><td>—</td><td>—</td><td>{{client.address}}</td></tr>
</tbody></table>

<h2>제3조 (용역 범위)</h2>
<p>갑이 을에게 제공하는 용역은 다음과 같으며, 세부 내용은 별첨 [작업명세서(SOW)] 또는 [제안서]에 따른다.</p>
<ul>
<li>—</li>
<li>—</li>
<li>—</li>
</ul>

<h2>제4조 (계약 기간)</h2>
<table><tbody>
<tr><th>계약 발효일</th><td>{{effective_date}}</td></tr>
<tr><th>용역 착수일</th><td>—</td></tr>
<tr><th>용역 완료일</th><td>—</td></tr>
<tr><th>유지보수 기간</th><td>최종 검수일로부터 3개월 (필요 시 연장)</td></tr>
</tbody></table>

<h2>제5조 (계약 대금 및 지급 조건)</h2>
<p>본 계약의 총 대금은 <strong>금 — 원정 (₩ —)</strong>이며, 부가가치세는 별도로 한다. 지급은 다음 일정에 따른다.</p>
<table><tbody>
<tr><th>구분</th><th>비율</th><th>금액</th><th>지급 시점</th></tr>
<tr><td>선금</td><td>30%</td><td>—</td><td>본 계약 체결 후 7영업일 이내</td></tr>
<tr><td>중도금</td><td>40%</td><td>—</td><td>중간 검수 통과 후 7영업일 이내</td></tr>
<tr><td>잔금</td><td>30%</td><td>—</td><td>최종 검수 완료 후 14일 이내</td></tr>
</tbody></table>
<p>입금 계좌: {{business.bank_account}} (예금주: {{business.name}})</p>

<h2>제6조 (산출물 및 검수)</h2>
<ul>
<li>갑은 별첨 명세서에 따른 산출물을 약정 기일까지 을에게 제공한다.</li>
<li>을은 산출물 인도일로부터 <strong>10영업일 이내</strong> 검수를 완료하고 결과를 서면(이메일 가능)으로 통지한다.</li>
<li>검수 통지가 없는 경우 검수 완료로 간주한다.</li>
<li>검수 결과 시정이 필요한 경우, 갑은 5영업일 이내 시정안을 제공한다.</li>
</ul>

<h2>제7조 (지적재산권)</h2>
<ul>
<li>본 계약에 따라 산출되는 결과물의 지적재산권은 <strong>잔금 완납 시</strong> 을에게 귀속된다.</li>
<li>갑이 본 계약 이전부터 보유하고 있던 도구·라이브러리·노하우(Pre-existing IP)는 갑의 소유로 유지되며, 을에게 본 계약 목적의 비독점적 사용권을 부여한다.</li>
<li>오픈소스를 사용한 경우 라이선스 조건을 준수하며, 사용 내역을 을에게 통지한다.</li>
</ul>

<h2>제8조 (비밀유지)</h2>
<p>본 계약과 관련하여 알게 된 상호의 비밀정보(기술·영업·인사·재무 등)는 별도 체결한 NDA에 따라 보호하며, NDA가 없는 경우 본 계약 종료 후 3년간 비밀로 유지한다.</p>

<h2>제9조 (손해배상 및 면책)</h2>
<ul>
<li>당사자 일방의 귀책사유로 손해가 발생한 경우, 그 일방은 직접 손해를 배상한다.</li>
<li>천재지변, 정부의 명령, 통신·전력 장애 등 불가항력으로 인한 손해는 면책된다.</li>
<li>본 계약상 갑의 손해배상 한도는 본 계약 총액을 초과하지 않는다.</li>
</ul>

<h2>제10조 (계약의 해제·해지)</h2>
<ul>
<li>당사자 일방이 본 계약상의 의무를 중대하게 위반하고 14일 이내 시정하지 않을 경우, 상대방은 서면 통지로 계약을 해제할 수 있다.</li>
<li>계약 해제 시 기 수행된 부분에 대한 대금은 정산하며, 미수행 부분에 대한 선금은 반환한다.</li>
</ul>

<h2>제11조 (분쟁 해결)</h2>
<p>본 계약과 관련된 분쟁은 우선 양 당사자 간 협의로 해결한다. 협의가 이루어지지 않을 경우 갑의 주된 사무소 소재지를 관할하는 법원을 제1심 관할법원으로 한다.</p>

<h2>제12조 (기타)</h2>
<ul>
<li>본 계약에 명시되지 않은 사항은 일반 상관습 및 관련 법령에 따른다.</li>
<li>본 계약의 변경은 양 당사자의 서면 합의로만 효력이 있다.</li>
<li>본 계약은 정본 2통을 작성하여 갑·을이 각 1통씩 보관한다.</li>
</ul>

<h2>서명</h2>
<table><tbody>
<tr><th>구분</th><th>회사명</th><th>대표자</th><th>서명 / 날인</th><th>일자</th></tr>
<tr><td>갑</td><td>{{business.name}}</td><td>{{business.ceo}}</td><td>—</td><td>{{effective_date}}</td></tr>
<tr><td>을</td><td>{{client.name}}</td><td>—</td><td>—</td><td>{{effective_date}}</td></tr>
</tbody></table>`;

// ════════════════════════════════════════════════════════════════
// 7. 작업 명세서 (SOW) — 신규
// ════════════════════════════════════════════════════════════════
const SOW_BODY = `<h1>작업 명세서 (Statement of Work)</h1>
<table><tbody>
<tr><th>SOW 번호</th><td>—</td><th>버전</th><td>v1.0</td></tr>
<tr><th>작성일</th><td>{{issued_at}}</td><th>유효기간</th><td>{{valid_until}}</td></tr>
<tr><th>관련 계약</th><td colspan="3">— (계약번호 / 제안서 번호)</td></tr>
</tbody></table>

<h2>1. 프로젝트 개요</h2>
<table><tbody>
<tr><th>프로젝트명</th><td>{{title}}</td></tr>
<tr><th>발주사 (을)</th><td>{{client.name}}</td></tr>
<tr><th>수행사 (갑)</th><td>{{business.name}}</td></tr>
<tr><th>총 기간</th><td>—</td></tr>
<tr><th>총 견적 (부가세 별도)</th><td>—</td></tr>
</tbody></table>

<h2>2. 목적 및 목표</h2>
<p><strong>목적 (Why):</strong> <em>(고객이 이 프로젝트를 추진하는 비즈니스 이유)</em></p>
<p><strong>목표 (What):</strong></p>
<ul>
<li>측정 가능한 목표 1 — KPI/지표</li>
<li>측정 가능한 목표 2 — KPI/지표</li>
<li>측정 가능한 목표 3 — KPI/지표</li>
</ul>

<h2>3. 작업 범위 (Scope)</h2>
<table><tbody>
<tr><th>구분</th><th>내용</th></tr>
<tr><td>포함 (In-Scope)</td><td>—<br>—<br>—</td></tr>
<tr><td>제외 (Out-of-Scope)</td><td>—<br>—<br>—</td></tr>
</tbody></table>

<h2>4. 산출물 명세 (Deliverables)</h2>
<table><tbody>
<tr><th>No.</th><th>산출물</th><th>형태</th><th>제출 시점</th><th>책임자</th></tr>
<tr><td>1</td><td>요구사항 정의서</td><td>PDF</td><td>킥오프 +1주</td><td>PM</td></tr>
<tr><td>2</td><td>UI / UX 설계서</td><td>Figma · PDF</td><td>+3주</td><td>디자이너</td></tr>
<tr><td>3</td><td>아키텍처 문서</td><td>PDF · 다이어그램</td><td>+3주</td><td>리드 개발</td></tr>
<tr><td>4</td><td>소스코드 (Git Repo)</td><td>Git</td><td>+8주</td><td>개발팀</td></tr>
<tr><td>5</td><td>테스트 보고서</td><td>PDF</td><td>+9주</td><td>QA</td></tr>
<tr><td>6</td><td>운영 매뉴얼 · 인수인계서</td><td>PDF</td><td>최종</td><td>PM</td></tr>
</tbody></table>

<h2>5. 일정 / 마일스톤</h2>
<table><tbody>
<tr><th>주차</th><th>마일스톤</th><th>주요 작업</th><th>완료 기준</th></tr>
<tr><td>W1</td><td>킥오프</td><td>요구사항 인터뷰 · 정의서 작성</td><td>고객 서면 승인</td></tr>
<tr><td>W2–W3</td><td>설계</td><td>UI/UX · 아키텍처 · DB 스키마</td><td>중간 검수 통과</td></tr>
<tr><td>W4–W7</td><td>개발</td><td>핵심 기능 구현 · 통합</td><td>테스트 케이스 90%+</td></tr>
<tr><td>W8</td><td>QA / UAT</td><td>전체 테스트 · 고객 UAT</td><td>UAT 통과</td></tr>
<tr><td>W9</td><td>배포 / 인수인계</td><td>운영 환경 배포 · 매뉴얼 인계</td><td>운영 안정성 확인</td></tr>
</tbody></table>

<h2>6. 인력 / 리소스</h2>
<table><tbody>
<tr><th>역할</th><th>인원</th><th>투입률</th><th>주요 업무</th></tr>
<tr><td>PM</td><td>1</td><td>50%</td><td>일정 · 의사소통 · 리스크</td></tr>
<tr><td>리드 개발</td><td>1</td><td>100%</td><td>아키텍처 · 코드 리뷰</td></tr>
<tr><td>개발자</td><td>—</td><td>100%</td><td>기능 구현</td></tr>
<tr><td>디자이너</td><td>1</td><td>50%</td><td>UI/UX</td></tr>
<tr><td>QA</td><td>1</td><td>30%</td><td>테스트 · 검수</td></tr>
</tbody></table>

<h2>7. 가정 / 제약 사항</h2>
<ul>
<li><strong>고객 자료 제공</strong>: 요구사항 인터뷰 시 필요 자료를 5영업일 이내 제공.</li>
<li><strong>의사결정자</strong>: 단일 의사결정자 1명 지정 (변경 시 사전 통보).</li>
<li><strong>외부 시스템 연동</strong>: 고객사 IT 부서 협조 필수, API 문서 사전 제공.</li>
<li><strong>인프라</strong>: 운영 환경(서버·DB·도메인)은 고객사 비용으로 별도 준비.</li>
</ul>

<h2>8. 검수 기준 (Acceptance Criteria)</h2>
<table><tbody>
<tr><th>구분</th><th>기준</th></tr>
<tr><td>기능</td><td>요구사항 정의서의 모든 기능이 동작 (테스트 케이스 100% 통과)</td></tr>
<tr><td>성능</td><td>주요 화면 응답 시간 2초 이내 (95퍼센타일)</td></tr>
<tr><td>보안</td><td>OWASP Top 10 점검 통과 · HTTPS · 인증·인가 구현</td></tr>
<tr><td>품질</td><td>테스트 커버리지 70%+ · 코드 린트 통과</td></tr>
<tr><td>문서</td><td>운영 매뉴얼 · API 명세서 · 인수인계서 제출</td></tr>
</tbody></table>

<h2>9. 변경 관리 (Change Management)</h2>
<ul>
<li>범위·일정·견적에 영향이 있는 변경은 <strong>변경 요청서(CR)</strong>를 통해 관리.</li>
<li>CR 처리 절차: 요청 → 영향 분석 (3영업일) → 견적·일정 협의 → 양사 승인 → 반영.</li>
<li>경미한 변경(범위 5% 이내·일정 영향 없음)은 PM 합의로 즉시 처리.</li>
</ul>

<h2>10. 견적 요약</h2>
<table><tbody>
<tr><th>구분</th><th>금액</th></tr>
<tr><td>설계</td><td>—</td></tr>
<tr><td>개발</td><td>—</td></tr>
<tr><td>QA / UAT</td><td>—</td></tr>
<tr><td>배포 · 인수인계</td><td>—</td></tr>
<tr><th>합계 (부가세 별도)</th><th>—</th></tr>
</tbody></table>
<p style="color:#64748B;font-size:12px;">상세 견적은 별도 견적서로 발행됩니다.</p>

<h2>승인</h2>
<table><tbody>
<tr><th>구분</th><th>회사명</th><th>담당자</th><th>서명</th><th>일자</th></tr>
<tr><td>갑</td><td>{{business.name}}</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>을</td><td>{{client.name}}</td><td>—</td><td>—</td><td>—</td></tr>
</tbody></table>`;

const TEMPLATES = [
  {
    kind: 'quote',
    name: '표준 견적서 (KO)',
    description: '8 column 품목표 · 추가비용 · 결제분할(선금·중도금·잔금) · 인도/AS · 가정/제외 · 서명',
    mode: 'form',
    locale: 'ko',
    visibility: 'client_shareable',
    schema_json: {
      header: {
        issuer_logo: { source: 'business.logo_url' },
        issuer_info: { source: 'business', fields: ['name', 'biz_number', 'ceo', 'address', 'phone'] },
      },
      fields: [
        { key: 'client_id', type: 'client_picker', required: true, label: '고객' },
        { key: 'title', type: 'text', label: '제목', ai_hint: '프로젝트/작업 한 줄 요약' },
        { key: 'issued_at', type: 'date', default: 'today', label: '발행일' },
        { key: 'valid_until', type: 'date', default: '+30d', label: '만료일' },
        { key: 'currency', type: 'select', options: ['KRW', 'USD', 'EUR'], default: 'KRW' },
        { key: 'items', type: 'line_items', label: '품목', required: true,
          schema: {
            description: { type: 'text' },
            quantity: { type: 'number', default: 1, step: 0.5 },
            unit_price: { type: 'number', step: 1000 },
            subtotal: { type: 'computed', formula: 'quantity * unit_price' },
          } },
        { key: 'vat_rate', type: 'percent', default: 0.10, label: '부가세율' },
        { key: 'payment_terms', type: 'textarea', default: '발행 후 14일 이내 계좌이체' },
        { key: 'notes', type: 'textarea', label: '메모 (고객용)' },
      ],
      totals: [
        { key: 'subtotal', label: '공급가액', formula: 'sum(items.subtotal)' },
        { key: 'vat', label: '부가세', formula: 'subtotal * vat_rate' },
        { key: 'total', label: '합계', formula: 'subtotal + vat', highlight: true },
      ],
      footer: { signature_zone: true, qr_code: { type: 'share_link' } },
    },
    body_template: QUOTE_BODY,
    ai_prompt_template: '고객 [{{client.name}}] 의 [{{title}}] 견적서를 작성해줘. 항목 5개, description 은 결과물 기반 (완료 시점 명확). 사용자 요구: [{{user_input}}].',
  },
  {
    kind: 'invoice',
    name: '표준 청구서 (KO)',
    description: '참조번호 · 세금계산서 발행정보 · 국내+SWIFT 결제 · 연체이자 · 비고',
    mode: 'form',
    locale: 'ko',
    visibility: 'client_shareable',
    schema_json: {
      fields: [
        { key: 'client_id', type: 'client_picker', required: true },
        { key: 'invoice_number', type: 'text', label: '청구번호', auto: 'INV-{YYYY}-{seq}' },
        { key: 'issued_at', type: 'date', default: 'today' },
        { key: 'due_date', type: 'date', default: '+14d', label: '결제 기한' },
        { key: 'currency', type: 'select', options: ['KRW', 'USD', 'EUR'], default: 'KRW' },
        { key: 'items', type: 'line_items', required: true,
          schema: {
            description: { type: 'text' },
            quantity: { type: 'number', default: 1 },
            unit_price: { type: 'number' },
            subtotal: { type: 'computed', formula: 'quantity * unit_price' },
          } },
        { key: 'vat_rate', type: 'percent', default: 0.10 },
        { key: 'payment_terms', type: 'textarea' },
      ],
      totals: [
        { key: 'subtotal', formula: 'sum(items.subtotal)' },
        { key: 'vat_amount', formula: 'subtotal * vat_rate' },
        { key: 'grand_total', formula: 'subtotal + vat_amount', highlight: true },
      ],
    },
    body_template: INVOICE_BODY,
  },
  {
    kind: 'nda',
    name: '비밀유지계약서 (NDA)',
    description: '10조 · 비밀정보 분류표 · 반환/파기 · 분쟁해결(법원/중재) · 양사 서명',
    mode: 'hybrid',
    locale: 'ko',
    visibility: 'client_shareable',
    schema_json: {
      fields: [
        { key: 'party_a', type: 'business_picker', label: '갑(워크스페이스)' },
        { key: 'party_b', type: 'client_picker', required: true, label: '을(고객)' },
        { key: 'effective_date', type: 'date', default: 'today' },
        { key: 'duration_months', type: 'number', default: 24, label: '유효 기간(개월)' },
      ],
    },
    body_template: NDA_BODY,
  },
  {
    kind: 'proposal',
    name: '제안서 (B2B 표준)',
    description: 'Executive Summary · 회사·차별화·팀·레퍼런스·리스크·SLA 포함 11섹션',
    mode: 'editor',
    locale: 'ko',
    visibility: 'client_shareable',
    body_template: PROPOSAL_BODY,
    ai_prompt_template: '[{{client.name}}] 에게 보낼 [{{title}}] 제안서. 사용자 요구: [{{user_input}}]. Executive Summary + 회사 + 배경 + 솔루션 + 차별화 + 일정 + 팀 + 레퍼런스 + 리스크 + 견적 + SLA + 다음 단계.',
  },
  {
    kind: 'meeting_note',
    name: '회의록 (Q note 자동 변환)',
    description: '참석/결석 · 이전 액션 점검 · 결정·액션·미해결 · 첨부 · 배포대상',
    mode: 'editor',
    locale: 'ko',
    visibility: 'workspace_only',
    body_template: MEETING_NOTE_BODY,
    ai_prompt_template: '회의 트랜스크립트 기반 회의록. 결정사항·액션아이템·핵심논점·미해결안건 4섹션 정리.',
  },
  {
    kind: 'contract',
    name: '용역 계약서 (Service Agreement)',
    description: '12조 표준 · 대금 분할 · 지적재산권 · 비밀유지 · 손해배상 한도 · 분쟁해결 · 양사 서명',
    mode: 'editor',
    locale: 'ko',
    visibility: 'client_shareable',
    body_template: CONTRACT_BODY,
  },
  {
    kind: 'sow',
    name: '작업 명세서 (Statement of Work)',
    description: '범위(포함/제외) · 산출물 표 · 마일스톤 · 인력 · 검수기준 · 변경관리 · 견적 요약',
    mode: 'editor',
    locale: 'ko',
    visibility: 'client_shareable',
    body_template: SOW_BODY,
  },
];

(async () => {
  let inserted = 0, updated = 0;
  for (const tpl of TEMPLATES) {
    const where = { kind: tpl.kind, is_system: true, name: tpl.name };
    const existing = await DocumentTemplate.findOne({ where });
    if (existing) {
      await existing.update({ ...tpl, is_system: true, business_id: null });
      updated++;
    } else {
      await DocumentTemplate.create({ ...tpl, is_system: true, business_id: null });
      inserted++;
    }
  }
  console.log(`✓ Document templates seeded: ${inserted} inserted, ${updated} updated, total ${TEMPLATES.length}`);
  await sequelize.close();
})().catch(e => {
  console.error('Seed failed:', e);
  process.exit(1);
});
