# PlanQ AI 검색(GEO) 점검 — 2026-10-04

대상: https://planq.kr (랜딩·인사이트·도움말 공개 페이지) · 점검만, 수정 없음 · [Opus] 실측
핵심 질문: ChatGPT·Perplexity·Claude 에게 «업무관리 툴 추천», «PlanQ 가 뭐야» 를 물었을 때 **PlanQ = planq.kr** 로 인식·인용되는가.

## GEO 준비도: 48 / 100

| 축 | 점수 | 한 줄 |
|---|---|---|
| 기술 접근성 (20) | 18 | 검색 크롤러 전부 허용 · 본문 서버 렌더(프리렌더) · sitemap 110 · rss · llms.txt |
| 구조 가독성 (20) | 13 | H1 있음 · 요금제 FAQPage · 머리말 문구 중복 · 질문형 소제목 거의 없음 |
| 인용 가능성 (25) | 10 | «PlanQ 는 ~이다» 정의가 **두 가지로 갈린다** · 수치·근거 문장 적음 |
| 권위·브랜드 (20) | 2 | **외부 언급 사실상 0** · 운영사·사업자 정보 비노출 · sameAs 없음 |
| 멀티모달 (15) | 5 | 스크린샷·영상 메타 약함 |

플랫폼별(추정): Google AIO 45 · ChatGPT 검색 30 · Perplexity 25 — ChatGPT·Perplexity 는 외부 언급(위키·레딧·유튜브) 비중이 커서 지금은 낮다.

## 1. 가장 큰 문제 — 이름이 겹치고, 우리를 가리키는 외부 근거가 없다

검색 실측(US 엔진):
- `"planq.kr"` 정확 검색 → **planq.kr 자체가 결과에 0건.** 대신 암호화폐 Planq(PLQ, CoinGecko·Kraken) · 크몽 «PlanQ» 기획·디자인 구독.
- `PlanQ app software` → 노션 템플릿 PlanQ(AlternativeTo) · 암호화폐 · 크몽.
- `PlanQ 의뢰형 비즈니스 고객 업무 플랫폼 Q talk Q task` → 크몽 PlanQ + planHQ(다른 제품). **우리 서비스 설명을 그대로 넣어도 안 나온다.**

→ 지금 ChatGPT 에 물으면 **다른 PlanQ 를 우리로 착각하거나, 우리를 아예 모른다.**
(검색 엔진이 우리 페이지를 아직 색인하지 않았거나 순위가 아주 낮다는 뜻 — Bing 색인 여부 확인 필요. ChatGPT 검색은 Bing 색인 의존도가 높다.)

## 2. AI 크롤러 접근 (각자 다른 능력 — 따로 적는다)

| 크롤러 | 담당 | / · /features · /pricing · /insights · /guide | 판정 |
|---|---|---|---|
| Googlebot | Google 검색·AI 개요 | 허용 | ✅ |
| Bingbot | Bing·Copilot·(ChatGPT 검색 색인원) | 허용 | ✅ |
| OAI-SearchBot | **ChatGPT 검색 인용** | 허용 | ✅ |
| Claude-SearchBot | **Claude 검색 인용** | 허용 | ✅ |
| PerplexityBot | Perplexity | 허용 | ✅ |
| Yeti | 네이버 | 허용 | ✅ |
| GPTBot · ClaudeBot · Google-Extended | 학습용 | 공개 페이지 허용 · 공유 문서(/public·/sign·/g) 차단 | ✅ 의도대로 |
| CCBot | Common Crawl 학습 | 전체 차단 | 의도(학습 차단) — 검색엔 무관 |

## 3. llms.txt — 있음
`/llms.txt` 200 · 한/영 정의·주요 페이지. Google 은 효과 없다고 명시, 다른 AI 에는 참고용. **가중치는 두지 않는다.**

## 4. 서버 렌더 — 통과
OAI-SearchBot 로 받은 HTML 안에 본문(`#seo-prerender`)이 있다: 홈 2,856자 · 기능 5,490 · 서비스 3,792 · 소개 2,742 · 인사이트 7,030 · 요금제 1,369. canonical 정상. **hreflang 0 — 영어 본문이 별도 URL 로 없다**(영어 질문에서 불리).

## 5. 구조화 데이터 — 있지만 너무 얇다
- Organization: `name·url·logo` 뿐. **legalName·alternateName·description·sameAs·address·contactPoint·foundingDate 없음** — «어느 PlanQ 인지» 가를 근거가 0.
- SoftwareApplication: 카테고리·OS·무료 체험은 있음. **publisher(운영사)·sameAs(앱스토어)·featureList·inLanguage·screenshot 없음.**
- WebSite: inLanguage ko.
- 운영사·사업자·연락처(help@)·앱스토어 링크가 크롤러가 읽는 HTML 에 **없다**(«대표» 한 단어만 걸림).

## 6. 인용 가능성 — 정의가 두 개다
홈 첫 80단어에 정의가 둘이다:
① «의뢰형 비즈니스를 위한 고객 업무 플랫폼 — 고객 요청부터 청구까지 한 화면에서»
② «업무, 프로젝트, 일정 등 기업의 업무 운영을 하나의 공간에서 관리하는 비즈니스 업무관리 및 협업 플랫폼»(Google OAuth 심사용 — 지우면 안 됨)
AI 는 한 문장으로 요약해 인용한다 — 정의가 둘이면 어느 쪽도 힘을 못 받는다. 머리말 문구도 두 번 반복된다(프리렌더 중복).

## 7. 상위 5개 조치 (효과 큰 순)

1. **Bing 웹마스터 등록 + 사이트맵 제출 + IndexNow** — ChatGPT 검색의 색인원. 지금 우리 페이지가 검색에 0건이다. (Irene: Bing 계정으로 소유 확인 — 네이버 때처럼 meta 태그 한 줄)
2. **Organization·SoftwareApplication 스키마 보강** — `legalName`(운영사), `alternateName`(«플랜큐», «PlanQ 업무관리»), `description`(한 문장 정의), `sameAs`(App Store·Google Play·LinkedIn·YouTube·네이버 블로그 등 실제 있는 것만), `contactPoint`, `publisher`. «이 PlanQ 는 한국의 B2B 고객 업무 SaaS» 를 기계가 읽게.
3. **정의 한 문장 통일** — 홈·llms.txt·스키마·앱스토어·외부 등록에 **같은 문장**(예: «PlanQ(플랜큐)는 의뢰형 비즈니스를 위한 고객 업무 플랫폼으로, 고객 대화·업무·문서·서명·청구를 한 화면에서 처리합니다»). OAuth 심사 문장은 둘째 문단으로.
4. **외부 언급 만들기** — 앱스토어 페이지 설명에 planq.kr · Capterra/G2/AlternativeTo 등록(«PlanQ by ○○, Korea») · 네이버 블로그/브런치 · LinkedIn 회사 페이지 · YouTube 짧은 소개 영상. **AI 인용은 외부 언급 상관도가 백링크의 3배.**
5. **영어 공개 페이지(최소 홈·기능·요금제) + hreflang** — 영어 질문에서 노션 템플릿·암호화폐에 밀리지 않게.

## 8. 바로 쓸 수 있는 스키마 초안 (값은 Irene 확인 필요 — 추정 금지)

```json
{
  "@type": "Organization",
  "name": "PlanQ",
  "alternateName": ["플랜큐", "PlanQ 업무관리"],
  "legalName": "<운영사 법인명 — 확인 필요>",
  "url": "https://planq.kr",
  "logo": "https://planq.kr/icon-512.png",
  "description": "<통일한 한 문장 정의>",
  "email": "<공식 문의 메일 — 확인 필요>",
  "address": { "@type": "PostalAddress", "addressCountry": "KR" },
  "sameAs": ["<App Store URL>", "<Google Play URL>", "<LinkedIn>", "<YouTube>", "<네이버 블로그>"]
}
```

## 9. 정기 확인 (측정 없이 고쳤다고 하지 않는다)
월 1회 같은 질문을 ChatGPT·Perplexity·Claude 에 묻고 기록: «한국 B2B 업무관리 툴 추천», «의뢰형 비즈니스 고객 관리 툴», «PlanQ 업무관리 뭐야», «planq.kr». 지표 = 우리가 나오는가 · 다른 PlanQ 와 섞이는가 · 인용 URL.

## 출처
- https://alternativeto.net/software/planq/ (노션 템플릿 PlanQ)
- https://kmong.com/gig/710266 (크몽 PlanQ 기획 구독)
- https://www.coingecko.com/en/coins/planq (암호화폐 Planq)
- 실측: `curl -A OAI-SearchBot https://planq.kr/{,features/,pricing/,service/,about/,insights/}` · robots.txt 파서 판정 · sitemap.xml(110) · rss.xml 200 · llms.txt 200
