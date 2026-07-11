# AI-네이티브 시대의 업무 OS 아키텍처 — 외부 리서치 (2026-07)

> 작성: 2026-07-11 · 방법: 웹 리서치 6개 축 병렬 조사(약 60회 검색, 40+ 1차 소스 열람) + 고위험 주장 6건 적대적 재검증
> 원칙: **출처 없는 단정 금지.** 검증 못 한 것은 `미확인`으로 표기. 벤더 자체 발표 수치는 그 사실을 명시.
> 이 문서는 PlanQ 를 옹호하지 않는다. PlanQ 가 틀렸을 가능성을 찾는 것이 목적이다.

---

## ① 핵심 발견 10

**F1. MCP 는 이제 "표준"이 됐다 — 그리고 벤더 중립화까지 끝났다.**
2025-12-09 Anthropic 이 MCP 를 Linux Foundation 산하 신설 **Agentic AI Foundation(AAIF)** 에 기증했다. 창립 기여 프로젝트는 MCP(Anthropic) + goose(Block) + AGENTS.md(OpenAI). 플래티넘 멤버에 AWS·Anthropic·Block·Bloomberg·Cloudflare·Google·Microsoft·OpenAI 가 모두 들어갔다.[^1][^2] 즉 "Anthropic 진영 규격"이라는 이유로 MCP 를 미룰 근거는 2026 년 기준 소멸했다.

**F2. 그런데 MCP 는 지금 "2.0급" 파괴적 개정 중이다 — 지금 붙이면 곧 다시 짜야 한다.**
확정 최신 리비전은 **2025-11-25**. 다음 리비전 **2026-07-28** 은 현재 RC(2026-05-21 잠금) 이며, 프로토콜 레벨 세션(`Mcp-Session-Id`)과 `initialize/initialized` 핸드셰이크를 **제거**해 코어를 stateless 로 바꾼다(SEP-2567, SEP-2575). Roots/Sampling/Logging 은 deprecated 로 표시된다(단 **최소 1년간 계속 동작** — 즉시 중단 아님).[^3] → **결론: MCP 서버는 붙이되, 얇게 붙여라.**

**F3. "툴을 직접 호출"에서 "툴을 호출하는 코드를 실행"으로 이동 중이다.**
Anthropic 은 2025-11-04 "Code execution with MCP" 에서 툴 정의 선로딩 + 중간결과 컨텍스트 통과가 토큰을 태운다고 지적하고, MCP 툴을 파일시스템의 코드 API 로 노출해 에이전트가 **코드를 써서 호출**하게 하는 패턴으로 150,000 → 2,000 토큰(98.7% 절감) 사례를 제시했다.[^4] Cloudflare 는 앞서 2025-09-26 "Code Mode" 에서 같은 주장을 했고(V8 isolate 샌드박스),[^5] 2026 년 후속 발표에서 2,500+ 엔드포인트 기준 ~117만 → ~1,000 토큰(자사 주장)이라고 밝혔다.[^6]

**F4. 병목은 모델 능력이 아니라 컨텍스트다 — 그리고 롱컨텍스트는 공짜가 아니다.**
Chroma 의 "Context Rot"(2025-07-14, 18개 모델 평가)은 광고된 컨텍스트 한도에 **한참 못 미쳐서부터** 성능이 불안정해진다는 것을 보였다. 심지어 haystack 이 논리적 흐름을 유지할 때 오히려 검색 정확도가 떨어졌다(셔플된 쪽이 나았다).[^7] Anthropic 의 "Effective context engineering"(2025-09-29)은 컨텍스트를 **"attention budget"** 으로 규정하고 compaction / structured note-taking / subagent 격리 3종을 처방한다.[^8]

**F5. 멀티에이전트는 종교전쟁이 아니라 워크로드 함수다.**
Anthropic 은 orchestrator-worker 멀티에이전트가 단일 Opus 4 대비 내부 리서치 eval 에서 **90.2% 우수**했다고 발표했지만, 동시에 멀티에이전트가 채팅 대비 **~15배 토큰**을 쓴다고 명시했다.[^9] 하루 차이로 Cognition 은 "Don't Build Multi-Agents"(2025-06-12)에서 정반대 결론 — 컨텍스트를 쪼개면 **암묵적 결정이 충돌**하니 단일 스레드 + 압축 모델을 쓰라 —— 를 냈다.[^10] 실무적 화해: **읽기 중심(리서치)=병렬 유리, 쓰기 중심(코드·상태변경)=단일 스레드 유리.**

**F6. 에이전트 신뢰성의 정답은 "더 똑똑한 프롬프트"가 아니라 durable execution(체크포인트/저널 리플레이)이다.**
LangGraph 는 superstep 마다 체크포인터로 상태를 영속화해 크래시 복구·타임트래블·`interrupt()` HITL 을 제공한다(단, 재개 시 interrupt 이전 노드 코드가 **재실행**될 수 있어 부작용 배치 주의).[^11] Temporal 은 AI 에이전트를 공식 포지셔닝하고 OpenAI Agents SDK 통합을 제공하며 Replit 코딩 에이전트 이전 사례를 인용한다.[^12] DBOS(Postgres 내장), Inngest, Restate 등 대안군이 2025 년 일제히 "durable execution for agents" 로 포지셔닝했다.[^13]

**F7. 벤더들은 이미 "에이전트를 시스템 안의 1급 시민"으로 넣었다 — 그리고 신원(identity)이 그 관문이다.**
Microsoft **Entra Agent ID**(Build 2025 발표)는 에이전트에 디렉터리 신원을 부여하고, **Agent 365**(2025-11-18 발표 → **2026-05-01 GA, $15/user/월**)가 레지스트리·shadow agent 탐지·접근제어·감사의 컨트롤 플레인이 됐다.[^14][^15][^16] Linear 는 에이전트를 OAuth `actor=app` 의 워크스페이스 멤버로 만들고 **좌석 과금하지 않는다**.[^17]

**F8. 과금 모델은 좌석에서 "좌석 + 소비량 하이브리드"로 이동 중이다 — "좌석의 죽음"은 과장.**
Salesforce Flex Credits: **$500 / 100,000 크레딧**, 액션당 20 크레딧 = **$0.10/action**.[^18] Intercom Fin: **$0.99/resolution**.[^19] Zendesk 는 2024-08 "CX 업계 최초 outcome-based" 선언.[^20] 그러나 ICONIQ 실측은 **하이브리드가 최다(38%)**, outcome-based 는 2%→18% 로 올라온 소수파다.[^21] 반대로 Atlassian Rovo·Google Workspace Gemini 는 **AI 를 좌석 요금에 흡수**해버렸다.[^22][^23]

**F9. "AI 로 사내 도구 만들어 SaaS 안 산다" 는 — 롱테일에선 진짜, 코어에선 아직 0건이다.**
Klarna 는 Salesforce/Workday 해지로 이 서사의 상징이 됐지만, **CEO 본인이 2025-03 정정**했다: "우리는 SaaS 를 LLM 으로 대체하지 않았다"(실제로는 Neo4j 등으로 내부 데이터 스택 구축), 그리고 **"Salesforce 의 종말이 아니라, 소수 SaaS 로의 통합이 더 가능성 높다"**.[^24][^25] 고객서비스 AI 는 "비용이 지배 요소였고 품질이 낮아졌다"며 2025-05 사람 재채용으로 부분 철회.[^26] 반면 Retool 2026 설문(n=817, **강한 선택편향**)은 35% 가 이미 최소 1개 SaaS 를 자체 구축물로 대체했다고 답했다.[^27] **구매한 코어 엔터프라이즈 SaaS 를 vibe coding 으로 통째 대체한 검증된 대기업 사례는 이번 조사에서 0건이다(미확인 아님 — 부재).**

**F10. 인컴번트는 죽는 게 아니라 사들이고 있다.**
2026-06-15 **Salesforce 가 Fin(구 Intercom)을 약 $3.6B 에 인수하는 확정 계약**을 체결했다(클로징은 FY2027 Q4 예정, 아직 미완료).[^28] "SaaS 붕괴"가 아니라 outcome-pricing AI 벤더를 인컴번트가 흡수하는 **통합(consolidation)** 이 실제로 관측되는 방향이다. Gartner 는 2026 년 소프트웨어 지출을 **$1.44T(+15.1%)** 로 상향했다 — 붕괴 신호 없음.[^29]

---

## ② MCP · 에이전트 표준 현황

### 2.1 스펙 타임라인

| 리비전 | 핵심 변경 |
|---|---|
| 2025-03-26 | Streamable HTTP transport 도입 (HTTP+SSE 대체) |
| 2025-06-18 | JSON-RPC batching 제거 · **structured tool output** · **elicitation**(서버→사용자 추가입력 요청) · resource links · MCP 서버를 **OAuth Resource Server** 로 규정 + RFC 8707 Resource Indicators 필수 · Security Best Practices 페이지 신설[^30] |
| **2025-11-25 (현재 확정판)** | OIDC Discovery 기반 AS 탐색 · 아이콘 메타데이터 · WWW-Authenticate 통한 **incremental scope consent** · URL mode elicitation · **sampling 중 tool calling** · **OAuth Client ID Metadata Documents(CIMD)** · 실험적 **tasks**(장기실행 폴링)[^31] |
| 2026-07-28 (RC, 2026-05-21 잠금) | **세션·핸드셰이크 제거 → stateless core** · reverse-DNS extensions 프레임워크 · **MCP Apps**(샌드박스 iframe 서버 렌더 UI) · Tasks extension · 공식 deprecation 정책(최소 12개월) · Roots/Sampling/Logging deprecated(동작은 유지)[^3] |

**프리미티브:** 서버측 tools / resources / prompts, 클라이언트측 sampling / elicitation / roots.

### 2.2 채택

- **OpenAI**: 2025-03-26 공식 채택. Agents SDK 가 stdio / SSE(레거시) / Streamable HTTP / Hosted MCP(Responses API 가 대신 호출) 4방식 + static·dynamic tool filtering + approval 정책 지원.[^32][^33] ChatGPT **Apps SDK 는 MCP 서버를 필수 백본**으로 쓴다.[^34]
- **Google**: 2025-04-09 Gemini/SDK MCP 지원 발표(Hassabis).[^35] ADK 정식 지원, Google 서비스용 공식 MCP 엔드포인트.[^36]
- **Microsoft**: Copilot Studio MCP **2025-05-29 GA**.[^37] Windows 11 에 MCP 를 OS 계층으로(프록시 중재 + 중앙 정책·감사 + Windows MCP 레지스트리) 발표.[^38]
- **레지스트리**: 공식 MCP Registry 2025-09-08 preview.[^39] (2026-07 현재 GA 여부 **미확인**)

### 2.3 비판 축 — 반드시 알아야 할 2가지

1. **토큰 비대**: 툴 정의 선로딩 + 중간결과 통과. → 해법이 F3 의 "code execution".
2. **Tool poisoning / 간접 prompt injection**: 툴 설명·메타데이터·**런타임 응답**에 숨긴 지시. OWASP 가 공격 유형으로 등재.[^40] 근본 원인은 **연결 시점에만 툴 설명을 검토하고 런타임 응답은 무검증으로 LLM 컨텍스트에 넣는 신뢰 격차**다. 스펙 자체가 2025-06-18 부터 token passthrough / confused deputy / session hijacking 대응을 공식 문서화했다.[^30]

### 2.4 엔터프라이즈 MCP 게이트웨이 패턴 (수렴된 형태)

```
Agent ──▶ [MCP Gateway] ──▶ 내부 MCP 서버들 / REST / Lambda
             │
             ├ inbound auth  : OAuth/JWT (IdP 위임)
             ├ outbound auth : OAuth / IAM / API key (credential vault)
             ├ tool allowlist: virtual server 별 최소권한 노출
             ├ rate limit / quota
             └ audit / OpenTelemetry
```
- **AWS Bedrock AgentCore Gateway**: Lambda/REST/기존 MCP 를 MCP 툴로 노출, inbound JWT(Cognito/Okta/Auth0) + outbound OAuth/IAM 이중 인증. 단 **per-tool·per-user rate limit 은 기본 미제공** → interceptor Lambda 직접 구현 필요(2차 출처, 신뢰도 중).[^41]
- **Cloudflare**: remote MCP 서버 + `workers-oauth-provider` 로 OAuth 내장,[^42] Cloudflare One 의 **MCP server portals** 로 중앙 통제.[^43]
- **IBM ContextForge(mcp-context-forge)**: MCP/A2A/REST 연합 레지스트리+프록시, JWT, rate limit, OTel, virtual server 기반 최소권한 노출 (베타 — 프로덕션 전 보안검토 권고).[^44]

### 2.5 에이전트 프레임워크 — 실제 아키텍처

- **Claude Code / Agent SDK**: 루프 = **gather context → take action → verify work → repeat**. 자동 compaction + subagent(컨텍스트 격리, 1,000~2,000 토큰 요약만 반환). 검증 3종: rules-based(린터) / visual(스크린샷) / LLM-as-judge.[^45] **임베딩·벡터 인덱스를 쓰지 않고** grep/glob/파일읽기의 **agentic search** 를 쓴다 — 초기엔 로컬 벡터 DB RAG 였으나 agentic search 가 "압도적으로" 나았다는 게 제작자 진술.[^46][^47] 샌드박싱은 OS 프리미티브(bubblewrap/seatbelt) + UDS 프록시 네트워크 격리로, 권한 프롬프트를 **84% 감소**시켰다고 보고.[^48]
- **Cognition/Devin**: 단일 스레드 + 컨텍스트 압축 모델. "**전체 trace 를 공유하라, 메시지만 공유하지 말라**", "행동은 암묵적 결정을 담고, 충돌하는 결정은 나쁜 결과를 낳는다".[^10] 참고: Answer.AI 의 독립 평가(2025-01)는 Devin 20개 과제 중 성공 3 / 실패 14 (~15%) 였고 **어떤 과제가 성공할지 예측할 패턴이 없었다** — 자율성이 오히려 부채가 됐다(Devin 2.0 이전 시점).[^49]
- **OpenHands**: **event stream 아키텍처** — 타입드 Action/Observation 의 시간순 pub/sub 스트림이 UI·에이전트·Docker 샌드박스 런타임을 연결.[^50] ← 업무 OS 관점에서 가장 직접적으로 베낄 만한 구조.
- **Microsoft Agent Framework**: AutoGen + Semantic Kernel 통합(2025-10 프리뷰, 2026-04 1.0 GA), AutoGen 은 유지보수 모드. 그래프 워크플로 + OTel + MCP/A2A.[^51]
- **평가(evals)**: 통과율 높은 capability eval 은 **회귀 스위트로 승격해 CI 에서 매 변경·매 모델 업그레이드마다 실행**하라. trajectory 보다 outcome 채점, LLM judge 는 전문가와 주기적 캘리브레이션.[^52]

---

## ③ 벤더별 에이전트 통합 방식 비교표

| 벤더 | 에이전트 신원 | 권한 스코프 | 감사 | 과금 | 1급 시민? |
|---|---|---|---|---|---|
| **Microsoft** (M365 Copilot / Copilot Studio / Agent 365) | **Entra Agent ID** — 디렉터리 신원, blueprint→instance 부모-자식 관계[^53] | Conditional Access(에이전트 신원/blueprint 단위), RBAC, 최소권한 정책 템플릿 | Agent 365 통합 감사·e-discovery, **shadow agent 탐지·격리**[^15] | Copilot Credits(~$0.01/credit, $200/25k pack). M365 Copilot 좌석 보유자는 상당 부분 zero-rated. Agent 365 **$15/user/월**(2026-05-01 GA)[^54][^16] | ★★★ 디렉터리급 |
| **Linear** | OAuth `actor=app` **앱 유저** = 워크스페이스 멤버(이름·아바타)[^17] | `app:assignable`, `app:mentionable` 등 세분 스코프. **admin 스코프 요청 불가**. Permission-changes webhook 으로 취소 | Agent Sessions(10초 내 "thought" 발화 규약) | **에이전트는 과금 좌석 아님** | ★★★ (단 **정정**: 이슈 배정은 `assignee` 가 아니라 **`delegate`** — "human assignee 가 여전히 책임진다") |
| **Salesforce** (Agentforce 360) | 전용 **agent user** + permission set[^55] | 표준 Salesforce RBAC/FLS | Shield Event Monitoring, Audit Trail | **Flex Credits $0.10/action** 또는 **$2/conversation** (혼용 불가) | ★★☆ org user 급 |
| **ServiceNow** | AI Control Tower 가 human/machine/**AI agent** 신원 매핑(Veza 연계)[^56] | Now Assist 스코프 + Action Fabric(MCP Server) 경유 외부 에이전트 통제 | Control Tower 실시간 행동 관측, 30+ 통합 디스커버리 | 공개 정가 없음. Pro Plus/Enterprise Plus 에 포함 + consumption(정확한 미터 **미확인**) | ★★☆ 거버넌스 계층 신원 |
| **Notion** (3.0 / Custom Agents) | 이름·프로필 있는 에이전트, "human teammate 처럼" 권한[^57] | 사람 접근제어와 동형, 생성 권한 admin 제한 | **모든 agent run 로깅** | 좌석 + **크레딧 애드온**(2026-05-04 부터, Business/Enterprise) | ★★☆ 제품 내 멤버 |
| **Atlassian Rovo** | 별도 신원 없음(플랫폼 기능) | 기존 Jira/Confluence 권한 상속 | 조직 admin 사용량 대시보드(80%/100% 알림) | **좌석 요금에 흡수**(2025-04 Premium/Enterprise 무료 번들) + Rovo 크레딧 미터[^22] | ★☆☆ 기능 |
| **Google** (Workspace Gemini / Gemini Enterprise) | 별도 신원 없음. 거버넌스 프레임워크로 "모든 에이전트를 한 곳에서 가시화·보안·감사"[^58] | 호출 사용자 권한 상속 | Gemini Enterprise 중앙 거버넌스 | **사람 좌석 과금**(~$21/$30 per user, 2차 출처) | ★☆☆ 기능 |
| **SAP Joule** | 별도 신원 없음. "Access to Joule" 역할을 **사람**에게 부여[^59] | 사용자/business context 내에서 동작 | SAP 표준 | **AI Units**(소비 통화), Joule Studio 스텝당 미터 | ★☆☆ 기능 |
| **Slack** (agentic OS) | 대화 참여자로 등장. 신원은 Salesforce/Agentforce 계층에 위임 | 채널 권한 | — | Agentforce 과금에 종속 | ★★☆ (공식 **Slack MCP 서버** + Real-Time Search API 제공)[^60] |
| **Asana** | "AI Teammates" — 지속 메모리, 자율 액션 | 플랜 티어 부착 | 세부 **미확인** | AI 티어(Basic/Plus/Pro) | ★★☆ (브랜딩 우위, 세부 미확인) |

**읽는 법:** 신원 깊이 순위는 **Microsoft(디렉터리급) > Linear(제품 멤버급) ≈ Salesforce(org user) > ServiceNow > Notion > SAP/Google/Atlassian(기능)**. 과금 스펙트럼은 **순수 소비량(Salesforce·SAP·Microsoft Credits) → outcome($2/conversation, $0.99/resolution) → 좌석 흡수(Rovo·Workspace Gemini) → 무료(Linear)** 로 흩어져 있고, **아직 승자가 없다.**

---

## ④ 에이전트 신원 · 권한 패턴

### 4.1 세 가지 접근 패턴 (Microsoft Entra 의 분류가 가장 명료)[^61]

| 패턴 | 토큰 subject | Conditional Access 대상 | 감사 귀속 | 언제 쓰나 |
|---|---|---|---|---|
| **(a) On-behalf-of (위임)** | **사용자** | 사용자 (에이전트 아님) | "사용자가 했다" — 에이전트 구분 어려움 | 사용자가 명시 요청한 액션 |
| **(b) Agent-as-application** (client credentials) | **에이전트 신원** | 에이전트 신원 | "에이전트가 했다" — 사람 principal 소실 | 백그라운드 자율 작업 |
| **(c) Agent's user account** (디지털 워커 계정, 메일박스·라이선스 보유) | 에이전트의 사용자 계정 | 그 계정 | 사람 계정처럼 취급 | "직원처럼" 동작해야 할 때 |

**문서화된 함정 (그대로 인용할 가치 있음):**
- "all users" 대상 CA 정책은 **에이전트의 user account 를 포함하지 않는다**.
- 에이전트 user account 는 **그룹 멤버십 기반 스코핑 미지원**.
- **API key 로 인증하는 에이전트는 Entra 토큰 발급을 우회 → Conditional Access 를 통째로 빠져나간다.**[^61]

### 4.2 표준 진행 상황

- **RFC 8693 Token Exchange 의 `act`(actor) 클레임** 이 사실상 정답으로 수렴 중: 토큰에 user + client + agent 를 동시에 담아 리소스 서버가 **"Agent X 가 User Z 를 위해 Client W 를 통해 Y 를 했다"** 를 로깅할 수 있게 한다. 서비스 계정 패턴은 사람 principal 을 잃고, 공유 크레덴셜 패턴은 에이전트 단위 귀속 자체가 불가능하다.[^62]
- **draft-ietf-oauth-identity-chaining**(rev-16, 2026-06-26, IESG 제출/Proposed Standard): RFC 8693(도메인 내) + RFC 7523(도메인 간) 결합으로 신뢰 도메인을 넘어 컨텍스트 보존.[^63]
- **ID-JAG / Cross App Access(XAA)**: Okta 가 2025-06-23 발표.[^64] **MCP 의 "Enterprise-Managed Authorization" 확장으로 편입**되어 TS/Java SDK 에 반영(Python 진행 중) — 신뢰도 중(Okta 뉴스룸 기반).[^65]
- **draft-oauth-ai-agents-on-behalf-of-user**(WSO2, 2025-05): authorization code grant 에 `requested_actor`(동의 시점에 에이전트를 지목) + `actor_token` 추가. **WG 미채택**(2026-04 기준).[^66]
- **MCP Authorization (2025-11-25)**: OAuth 2.1 기반, MCP 서버는 **엄격히 resource server**. RFC 9728 Protected Resource Metadata **MUST**, RFC 8707 Resource Indicators **MUST**(auth+token 요청 양쪽), audience 검증 **MUST**, **업스트림 토큰 passthrough 금지 MUST NOT**, PKCE S256 **MUST**. DCR(RFC 7591)은 **MAY 로 강등**되고 **CIMD**(client_id = HTTPS URL)가 SHOULD 로 승격 — 엔터프라이즈에서 DCR 이 무한 자기등록·관리 불가 문제를 일으켰기 때문.[^67][^68]

### 4.3 벤더 제품

- **Auth0 "Auth for GenAI"**(2025-04-08 dev preview): **Token Vault**(서드파티 API 토큰을 Auth0 가 보관·갱신 → 에이전트가 raw credential 을 절대 보지 않음, 30+ 앱 사전통합), **Async Authorization**(CIBA+PAR 로 human-in-the-loop 승인, 에이전트는 대기 중 계속 작업), **FGA for RAG**(문서 단위 인가).[^69]
- **Descope Agentic Identity Hub**: Inbound Apps(어떤 앱이든 에이전트용 OAuth IdP 로) / Outbound Apps(50+ 툴 크레덴셜 볼트) / MCP Auth SDK.[^70]
- **CSA** 는 OAuth 2.1 스코프가 자율 에이전트에겐 **너무 coarse-grained** 하다고 보고, 에이전트 인스턴스별 DID + Verifiable Credentials, **ephemeral JIT task-scoped credential**, 감사 레코드에 DID·제시된 VC·요청 컨텍스트 해시·서명 포함(멀티에이전트 협업 체인 전체)을 권고한다.[^71]
- **NIST** 는 AI Agent Standards Initiative 를 출범했고 NCCoE 컨셉 페이퍼 의견수렴이 2026-04-02 마감됐다.[^72]

---

## ⑤ 반복되는 아키텍처 패턴 (6개 축에서 독립적으로 재등장한 것만)

**P1. Agent-as-identity.** 에이전트는 "기능"이 아니라 **신원을 가진 행위자**다. 신원이 있어야 권한·감사·취소·과금이 붙는다. Microsoft(Entra) · Linear(app user) · Salesforce(agent user) 가 각자 독립적으로 도달했다.

**P2. Delegation, not impersonation.** 에이전트가 사람을 사칭(공유 크레덴셜/서비스 계정)하면 감사가 죽는다. 정답은 **토큰에 actor 를 남기는 위임**(`act` 클레임 / identity chaining). Linear 가 `assignee` 가 아니라 **`delegate`** 를 쓰고 "human assignee 가 여전히 책임진다"고 못 박은 게 이 원칙의 제품화다.[^17]

**P3. Event log as substrate.** OpenHands 의 event stream,[^50] Temporal/LangGraph 의 저널 리플레이,[^11][^12] Confluent 의 "immutable Agent Decision Record".[^73] 공통점: **append-only 이력이 있으면 재생·디버그·감사·재개가 전부 파생된다.** (주의: event-log-as-agent-substrate 담론은 현재 Confluent 라는 벤더가 주도해 독립 검증원이 얇다.)

**P4. Durable execution + HITL 을 1급 프리미티브로.** 승인 대기는 예외 처리가 아니라 **일시정지 가능한 워크플로 상태**여야 한다(LangGraph `interrupt()`, Auth0 Async Authorization/CIBA, Temporal 승인 게이트).

**P5. Context 는 예산이다.** JIT 검색(경로/식별자만 들고 있다가 필요할 때 읽기) + compaction + 외부 노트 + subagent 격리. 사전 로딩은 죄악.[^8]

**P6. Verification loop.** 에이전트 출력은 **기계가 검증 가능한 형태**로 되돌려야 한다(린터·테스트·스크린샷·LLM judge). 그리고 통과한 eval 은 **CI 회귀 스위트로 승격**.[^45][^52]

**P7. Gateway/Control plane.** 툴 노출은 게이트웨이 뒤에서 allowlist·rate limit·감사와 함께. 그리고 **shadow agent 탐지**가 새 요구사항으로 등장했다(Agent 365).[^15]

**P8. Code execution over tool-call fan-out.** 툴이 많아지면 정의를 다 넣지 말고, 툴을 **코드 API 로 노출하고 샌드박스에서 코드를 실행**시켜라.[^4][^5]

---

## ⑥ 16개 질문에 대한 답

### Q1. AI-네이티브 세계에서 전통 그룹웨어는 살아남는가?
**부분적으로 그렇다 — 단 "화면 모음"으로서가 아니라 "권한 있는 기록 시스템(system of record)"으로서.**
증거: (a) Gartner 는 2026 소프트웨어 지출을 **$1.44T(+15.1%)** 로 **상향** 했다 — 붕괴 신호 없음.[^29] (b) Klarna CEO 는 "소수 SaaS 로의 통합이 더 가능성 높다"고 했다.[^25] (c) Salesforce 는 Fin 을 $3.6B 에 **사들이고** 있다.[^28]
죽는 것은 **"사람이 폼을 채워 넣는 UI 레이어"** 다. Nadella 의 실제 발언은 "SaaS is dead" 가 아니라 **"비즈니스 애플리케이션은 결국 비즈니스 로직이 얹힌 CRUD 데이터베이스이고, 에이전트 시대에 그 계층이 붕괴할 것"** 이다.[^74] 즉 **CRUD+로직 = 붕괴 대상, 데이터+권한+감사 = 생존 자산**.

### Q2. 무엇이 그것을 대체하는가?
"에이전트 하나"가 아니라 **4층 스택**이 대체한다:
1. **기록 계층** (권한·감사 붙은 정규 데이터) — 여전히 필요, 오히려 가치 상승[^75]
2. **툴 계층** (MCP/API 로 노출된 능력)
3. **오케스트레이션 계층** (durable execution + HITL 게이트)
4. **인터페이스 계층** (채팅 + 생성 UI + 기존 화면 — **셋 다 공존**)
전통 그룹웨어는 1·2 를 갖고 있는데 3·4 가 없다. AI 네이티브 신생은 3·4 를 갖고 있는데 1 이 없다. **1 을 가진 쪽이 3·4 를 붙이는 게 그 반대보다 쉽다는 게 인컴번트가 인수로 답하고 있는 이유다.**

### Q3. 기업은 SaaS 를 사는 대신 AI 로 사내 도구를 만들게 되는가?
**롱테일: 그렇다. 코어: 아직 증거 없다.**
- 찬성 증거: Retool 설문 35% 가 최소 1개 SaaS 대체(**단, Retool 고객 대상 — 강한 선택편향**),[^27] Klarna 는 **소규모 SaaS 약 1,200개**를 끊었다고 밝혔다(회사 발언).[^76] Lovable $400M ARR / 146명,[^77] Replit ~$253M ARR(Sacra 추정).[^78]
- 반대 증거: **구매한 코어 SaaS(CRM/ERP/HR)를 AI 생성 도구로 대체한 검증 가능한 대기업 사례를 이번 조사에서 하나도 찾지 못했다.** Klarna 조차 LLM 이 아니라 Neo4j 로 데이터를 통합한 것이었고 CEO 가 직접 일반화를 부정했다.[^24] IBM CEO 설문(n=2,000): AI 프로젝트 중 **기대 ROI 달성 25%**, 전사 확산 16%.[^79]
- **핵심 프레임: "cheap to build ≠ cheap to trust."** 생성된 도구도 보안 패치·컴플라이언스 문서·유지보수·소유권이 필요하고, 벤더가 흡수하던 운영 책임이 고객사로 이전될 뿐이다.[^80]
**PlanQ 시사점:** PlanQ 의 진짜 경쟁자는 "AI" 가 아니라 **"고객사가 Lovable 로 30분 만에 만든 대시보드"** 다. 방어선은 **UI 가 아니라 (a) 규제·증빙(세금계산서/현금영수증/부가세법 §70), (b) 멀티테넌트 격리·감사, (c) 외부 당사자(고객)와의 공유 경계** 다. 이 3개는 사내 vibe coding 이 재현하기 가장 비싼 것들이다.

### Q4. 그래도 한 플랫폼에 중앙화할 가치가 있는 부분은?
**"틀렸을 때 사람이 법적/금전적으로 책임지는 것" 전부.**
- 정규 데이터 + 권한 + **감사 이력**(누가·언제·무엇을·왜) — Jamin Ball 의 "Long Live Systems of Record" 논지: 에이전트의 실패 모드는 **잘못된 시스템에서 잘못된 정의를 끌어오는 것**이라, 정규 진실원의 가치는 오히려 오른다.[^75]
- 증빙/청구/계약 (되돌릴 수 없는 것)
- 신원·권한 경계(멀티테넌트, 고객 vs 내부)
- **에이전트 액션 원장** (아래 Q6)
반대로 중앙화 가치가 **낮은** 것: 화면 레이아웃, 필터 조합, 보고서 서식, 대시보드 — 이건 생성·폐기 가능해야 한다.

### Q5. 반대로 AI 가 동적으로 생성해야 하는 부분은?
**"뷰"와 "일회성 절차".**
Google 은 2025-11-18 Gemini 3 와 함께 **Generative UI** 를 출시했다 — 모델이 프롬프트마다 커스텀 인터랙티브 인터페이스를 설계·코딩하며, 인간 평가자가 표준 LLM 출력보다 이를 강하게 선호했다(생성 속도를 무시할 때).[^81] Vercel AI SDK 는 툴 콜에서 RSC 를 스트리밍하는 Generative UI 를 이미 제공한다.[^82]
→ **생성 대상: 보고서·대시보드·필터·요약 뷰·1회성 워크플로.** **비생성 대상: 청구서 발행 화면, 권한 설정, 증빙 마킹** (되돌릴 수 없고 규제 대상이라 결정론적 UI 가 필요).

### Q6. AI 에이전트가 "직원"이 될 때 권한 체계는 어떻게 진화해야 하는가?
증거 기반 처방 5가지:
1. **에이전트에게 고유 신원을 준다** (사람 계정 공유 절대 금지). Microsoft·Linear·Salesforce 가 전부 도달한 결론.[^53][^17][^55]
2. **위임(delegation)으로 행동한다** — 토큰에 `act` 를 남겨 "에이전트 X 가 사용자 Z 를 위해" 를 로깅.[^62]
3. **책임은 사람에게 남긴다.** Linear 의 설계가 정답에 가깝다: 에이전트에 이슈를 넘겨도 **assignee 가 아니라 delegate** 이고 **"human assignee 가 여전히 책임진다"**.[^17]
4. **에이전트 권한 ≤ 위임자 권한** + JIT·task-scoped·단명 크레덴셜.[^71]
5. **비동기 승인(HITL)을 1급 프리미티브로** — Auth0 Async Authorization(CIBA) 패턴.[^69]
**함정 경고:** API key 로 붙은 에이전트는 IdP 정책을 통째로 우회한다(Entra 문서가 명시).[^61] 그리고 **shadow agent**(승인 안 된 에이전트) 탐지가 이미 제품 요구사항이다.[^15]

### Q7. AI 가 다 요약할 수 있으면 알림은 어떻게 진화해야 하는가?
**"이벤트 전달"에서 "행동 요구(action-required) 큐"로.**
직접적 1차 근거는 얇다(**부분 미확인**). 그러나 인접 증거는 강하다: (a) Anthropic 은 컨텍스트를 **attention budget** 으로 규정하며 신호 밀도가 낮은 토큰이 성능을 갉아먹는다고 한다[^8] — **사람의 주의도 같은 예산이다.** (b) 벤더들의 실제 제품 방향은 "알림 개수 줄이기"가 아니라 **에이전트가 처리하고 사람에겐 승인만 요청**(Async Authorization, HITL interrupt)이다.[^69][^11]
→ 처방: 알림을 **① 승인/결정 요구(중단 가능한 워크플로 상태) ② 에이전트가 이미 처리함(이력만) ③ 참고(요약·배치)** 3등급으로 분리. **개수가 아니라 "당신의 결정이 필요한 것"만 인터럽트하라.**

### Q8. 태스크 관리가 존재해야 하는가, AI 가 자동 생성해야 하는가?
**둘 다 — 그러나 태스크의 정체가 바뀐다.**
태스크는 이제 **"사람에게 할당된 일"이 아니라 "책임이 부착된 durable 워크플로 인스턴스"** 다. Temporal/LangGraph 가 하는 일(체크포인트·재개·HITL 중단)을 태스크 테이블이 흡수해야 한다.[^11][^12] 그리고 Linear 가 보여주듯 **에이전트도 그 인스턴스의 실행자가 될 수 있지만 책임자(assignee)는 사람으로 남는다.**[^17]
AI 자동 생성은 이미 실증됨(Linear+Cursor/Devin/Claude Code 가 이슈를 받아 브랜치·PR 을 만들고 보고).[^83] **자동 생성 태스크는 "제안(candidate)" 상태로 시작해 사람이 승격시키는 게 검증된 패턴** — 그렇지 않으면 노이즈로 신뢰를 잃는다.

### Q9. 워크플로 엔진은 어떻게 바뀌어야 하는가?
**상태 기계(state machine)에서 durable execution 런타임으로.**
현재의 status ENUM + 전이 규칙은 "결정론적 전이"만 표현한다. AI 시대의 워크플로는 (a) **비결정적 스텝**(LLM 호출)을 포함하고, (b) **몇 시간~며칠 멈춰 있다가**(사람 승인 대기) 재개해야 하며, (c) **크래시 후 정확히 그 지점에서** 이어져야 하고, (d) **보상 트랜잭션**이 필요하다.
검증된 메커니즘: **저널 기반 리플레이** — 완료된 스텝 결과를 체크포인트하고, 크래시 시 저널된 결과를 즉시 반환하며 재실행. 이 때문에 LLM/툴 호출은 반드시 activity/step 으로 감싸야 한다(비결정적 코드가 워크플로에 벌거벗고 있으면 안 됨).[^13] LangGraph 는 재개 시 interrupt 이전 노드가 **재실행될 수 있다**고 경고한다 — **부작용(메일 발송·청구 생성)의 배치가 생사를 가른다.**[^11]

### Q10. UI 는 자연어에 종속되는가?
**아니다. 자연어는 "진입점"이 되지만 "표현"은 여전히 구조화 UI 다.**
- 반대 방향 증거: Google 의 Generative UI 는 **텍스트로 답하지 않고 UI 를 만들어 답한다** — 인간 평가자가 그걸 선호했다.[^81] 즉 트렌드는 "UI → 자연어"가 아니라 **"자연어 → UI 생성"** 이다.
- MCP 2026-07-28 RC 의 **MCP Apps**(서버가 샌드박스 iframe 에 UI 를 렌더)도 같은 방향이다 — 프로토콜이 UI 를 되살리고 있다.[^3]
→ **결론: 채팅은 커맨드 팔레트이지 최종 표현이 아니다.** 승인·비교·금액 확인처럼 **정밀도가 필요한 순간엔 결정론적 위젯이 이긴다.**

### Q11. 데이터가 화면보다 우선하는 제품이 되어야 하는가?
**그렇다 — 다만 "headless 로 가라"가 아니라 "화면을 데이터의 파생물로 만들라"다.**
Ink & Switch 의 "Malleable Software"(2025-06)는 앱이 **데이터 사일로**("each application manages its own data in a private silo")라는 것이 구조적 문제이며, **AI 코드 생성만으로는 해결되지 않는다 — 데이터 공유와 조합이 진짜 문제**라고 논증한다.[^84] 이건 PlanQ 같은 제품에 오히려 **유리한** 논지다: 여러 뷰가 같은 데이터에 붙는 구조를 이미 갖고 있다면.
경계: "UI 는 뷰, 데이터가 제품"이라는 **정확한 문구를 Benn Stancil 에게 귀속시키는 건 미확인** — 이번 조사에서 해당 문구의 글을 찾지 못했다. 인용 시 주의.

### Q12. 성공한 AI-네이티브 회사들은 내부 시스템을 어떻게 구성하는가?
**정직한 답: 이 질문에 대한 1차 정량 데이터를 찾지 못했다 (미확인).**
- 확인된 것: tiny team + 극단적 인당 매출(Lovable 146명/$400M ARR ≈ $2.7M/인 — **회사 발표**),[^77] Dealroom 추정(Cursor $3.3M/인, Midjourney $2M/인, OpenAI $1.5M/인 — **2차 추정**).[^85]
- **확인 못 한 것: "AI-네이티브 스타트업이라서 SaaS 좌석을 덜 산다"는 인과 데이터는 어떤 소스에서도 나오지 않았다.** 인당 매출이 높은 건 제품 레버리지 때문이지 내부 툴을 자체 제작해서라는 증거가 없다.
- 반면 **구조적으로 확인되는 것**: 코딩 에이전트를 Linear/GitHub 같은 **기존 기록 시스템의 멤버로 꽂아 넣는 방식**(Cursor·Devin·Claude Code 가 Linear 이슈를 받아 PR 생성)이 실제 운영 패턴으로 자리잡았다.[^83] **즉 그들도 SaaS 를 버리지 않았다 — 에이전트를 SaaS 안에 넣었다.**

### Q13. 반복적으로 나타나는 아키텍처 패턴은?
→ **⑤ 섹션 P1~P8** 참조. 요약: agent-as-identity, delegation-not-impersonation, event log substrate, durable execution + HITL, context as budget, verification loop, gateway/control plane, code execution over tool fan-out.

### Q14. 레거시 SaaS 가 저지르는 실수는?
→ **⑧ 섹션** 참조.

### Q15. 놓치고 있는 기회는?
→ **⑧ 섹션** 참조.

### Q16. 오늘 제로에서 AI-네이티브 Business OS 를 만든다면?

```
┌─ 인터페이스 ──────────────────────────────────────────────┐
│  채팅(커맨드) + 생성 UI(뷰) + 결정론적 위젯(승인·금액·권한) │
│  ※ 3개 공존. 채팅은 진입점, 위젯은 되돌릴 수 없는 것 담당    │
└──────────────────────────────────────────────────────────┘
┌─ 오케스트레이션 ──────────────────────────────────────────┐
│  durable workflow runtime (저널 리플레이)                  │
│   · 모든 LLM/툴 호출 = activity (재실행 안전)              │
│   · HITL = interrupt (예외 아님, 상태)                     │
│   · 보상 트랜잭션 (청구 취소·증빙 정정)                    │
└──────────────────────────────────────────────────────────┘
┌─ 능력(툴) ────────────────────────────────────────────────┐
│  MCP 서버(얇게) + 내부 코드 API                            │
│   · 툴 정의 선로딩 금지 → 코드 실행 패턴                   │
│   · 게이트웨이: allowlist / rate limit / audit             │
└──────────────────────────────────────────────────────────┘
┌─ 신원·권한 ───────────────────────────────────────────────┐
│  사람 · 에이전트 · 워크스페이스가 모두 principal            │
│   · 에이전트 = 고유 신원, 위임(act) 로 행동                 │
│   · 책임(accountable)은 항상 사람. 실행(executor)만 위임    │
│   · JIT · task-scoped · 단명 토큰                          │
└──────────────────────────────────────────────────────────┘
┌─ 기록(진실원) ────────────────────────────────────────────┐
│  정규 엔티티 + **append-only 이벤트 로그** (동급 시민)      │
│   · 모든 상태 변화 = 이벤트 (사람/에이전트 동일 형식)       │
│   · 현재 상태 = 이벤트의 파생 (또는 최소한 이벤트로 재구성) │
│   · 감사·재생·되감기·에이전트 컨텍스트가 전부 여기서 파생   │
└──────────────────────────────────────────────────────────┘
```

**설계 결정 6가지 (근거와 함께):**
1. **이벤트 로그를 1급으로.** OpenHands(event stream), Temporal(저널), Confluent(Agent Decision Record)가 독립적으로 같은 곳에 도달했다.[^50][^12][^73] 감사로그를 "나중에 붙이는 부가기능"으로 두면 에이전트 시대에 못 쓴다.
2. **워크플로 엔진 = durable runtime.** status ENUM 전이표로는 "3일간 승인 대기 후 재개"를 표현 못 한다.
3. **에이전트는 사용자 테이블의 principal 이되, `accountable_user_id` 를 반드시 함께 기록.** Linear 의 delegate 모델.[^17]
4. **KB 는 워크로드별로.** 같은 Anthropic 이 **코드에는 grep(임베딩 없음)**,[^46] **문서 KB 에는 hybrid(contextual embedding + BM25 + rerank, top-20 실패율 5.7%→1.9%)** 를 권한다.[^86] 그리고 **~200K 토큰 미만 코퍼스는 RAG 자체를 건너뛰고 롱컨텍스트+프롬프트 캐싱**을 쓰라고 명시한다.[^86] → **작은 워크스페이스에 벡터 검색을 돌리는 건 과잉일 수 있다.**
5. **UI 는 두 종류로 명시 분리.** 생성 가능(뷰/보고서) vs 결정론적(돈·권한·증빙).
6. **eval 을 CI 게이트로.** 통과한 capability eval 은 회귀 스위트로 승격.[^52]

---

## ⑦ 2027 / 2030 / 2035 예측 + 확률

각 확률에는 한 줄 근거를 붙인다. 근거 없는 숫자는 쓰지 않는다.

### 2027 (18개월 후)

| # | 예측 | 확률 | 근거 |
|---|---|---|---|
| 1 | 주요 업무 SaaS 의 과반이 **에이전트에 별도 신원**을 부여(사람 계정 공유 아님) | **85%** | Microsoft(Entra Agent ID, 2026-05 GA)·Linear·Salesforce·ServiceNow 가 이미 출하 완료. 나머지는 따라가는 일만 남음[^16][^17][^55][^56] |
| 2 | MCP 가 사실상 유일한 툴 연동 표준으로 남는다(A2A 등은 보조) | **75%** | Linux Foundation 이관 + AWS/Google/MS/OpenAI 전원 플래티넘 멤버[^1] |
| 3 | **outcome-based 과금이 주류(>50%)** 가 된다 | **15%** | ICONIQ 실측 18%(2025말), 최다는 하이브리드 38%. 18개월에 50% 돌파는 추세선 밖[^21] |
| 4 | 좌석+소비량 **하이브리드**가 최다 모델로 유지 | **80%** | 같은 ICONIQ 데이터 + Rovo/Gemini 의 좌석 흡수 역행 사례[^21][^22] |
| 5 | 코어 엔터프라이즈 SaaS(CRM/ERP/HR)를 AI 생성 사내 도구로 대체한 **대기업 사례가 다수 검증됨** | **20%** | 현재까지 0건. Klarna 조차 정정. IBM 설문 ROI 달성 25%[^24][^79] |
| 6 | Gartner 소프트웨어 지출이 2027 에도 **두 자릿수 성장** | **70%** | 2026 +15.1% 상향, 감속 신호 부재[^29] |
| 7 | 인컴번트의 AI 벤더 인수가 **최소 3건 더**($1B+) | **70%** | Salesforce-Fin $3.6B 가 신호탄, 통합 논리(Klarna CEO)와 일치[^28][^25] |
| 8 | 생성 UI 가 **읽기 전용 뷰**(보고서/대시보드)에서 표준이 됨 | **60%** | Google 이 2025-11 출하했고 인간 선호 확인. 쓰기/금전 영역은 미도달[^81] |

### 2030 (4년 후)

| # | 예측 | 확률 | 근거 |
|---|---|---|---|
| 9 | 업무 OS 의 **기본 실행 계층이 durable workflow runtime** (status ENUM 전이표가 아니라) | **65%** | Temporal/LangGraph/DBOS/Inngest/Cloudflare Workflows 가 2025 에 일제히 수렴. 다만 마이그레이션 비용이 커서 100% 는 아님[^13] |
| 10 | **에이전트 액션이 인간 액션 수를 초과**(주요 업무 시스템 감사로그 기준) | **60%** | NHI 대 human 비율이 이미 40:1~144:1 로 보고됨(**단 벤더 설문, 수치 상호 불일치 — 방향성만**)[^87] |
| 11 | 전통 그룹웨어 카테고리(그룹웨어/협업)가 **독립 카테고리로 소멸** | **25%** | 기록 시스템의 가치는 오히려 상승 중이라는 반대 증거가 강함(Gartner, 인수 통합)[^29][^75] |
| 12 | 알림이 "이벤트 스트림"에서 **"결정 큐"** 로 재설계됨(주요 벤더 다수) | **55%** | 방향은 명확(HITL 승인 프리미티브)하나 직접 1차 근거는 얇음 — 추론 기반이라 확률을 낮춤 |
| 13 | 규제 산업에서 **"에이전트 행동 원장" 이 법적 요구사항**이 됨 | **50%** | NIST AI Agent Standards Initiative 진행 중, CSA 가 비부인(non-repudiation) 감사 권고. 입법 속도는 불확실[^72][^71] |
| 14 | 중소기업(SMB) 시장에서 **"AI 가 만든 사내 도구"가 SaaS 구매를 유의미하게 잠식** | **45%** | 롱테일에선 이미 진행(Klarna 1,200개 SaaS 해지, Retool 35%). SMB 는 컴플라이언스 부담이 낮아 대기업보다 빠를 것[^76][^27] |

### 2035 (9년 후)

| # | 예측 | 확률 | 근거 |
|---|---|---|---|
| 15 | 사람이 **화면을 직접 조작하는 시간이 절반 이하**로 줄고, 대부분 승인·예외처리·관계 | **50%** | 방향은 강하나 9년 예측은 본질적으로 코인플립. 과거 "노코드가 개발자를 없앤다" 예측의 실패율을 반영해 50% 이상 못 줌 |
| 16 | **정규 데이터 + 권한 + 감사** 를 가진 기록 시스템은 여전히 존재하고 돈을 번다 | **80%** | 회계·세무·계약은 법적 책임 주체가 필요하고, 이건 AI 로 없어지지 않음. 부가세법·증빙 요구는 기술 트렌드와 무관 |
| 17 | 오늘의 "채팅 UI" 가 주 인터페이스로 남는다 | **25%** | 이미 반대 방향(생성 UI)으로 가고 있음. 채팅은 커맨드 팔레트로 축소될 가능성이 높음[^81] |
| 18 | 하나의 벤더가 "AI 업무 OS" 를 독점 | **15%** | MCP 의 벤더중립 표준화 자체가 독점을 어렵게 만듦. 과거 이메일/캘린더도 독점 안 됨[^1] |

**메타 주의:** 위 확률은 2026-07 시점의 증거 기반 주관 추정이다. 특히 2030/2035 항목은 1차 증거가 아니라 추세 외삽이므로, **연 1회 재보정하지 않으면 무의미하다.**

---

## ⑧ 레거시 SaaS 의 실수 · 놓친 기회

### 8.1 실수 (증거 기반)

**M1. AI 를 "기능"으로 붙이고 신원을 안 줬다.**
SAP Joule, Google Workspace Gemini, Atlassian Rovo 는 에이전트가 **호출한 사람의 신원으로** 동작한다.[^59][^58][^22] 결과: 감사로그에 "사용자가 했다"만 남고 "에이전트가 자율적으로 했다"를 구분할 수 없다. 이 구분이 없으면 **규제 산업에서 못 쓴다.** 반대로 Microsoft·Linear 는 처음부터 신원을 줬다.

**M2. 컨텍스트를 "더 넣으면 좋다"고 착각했다.**
Chroma 의 context rot 은 광고 한도 훨씬 전에 성능이 무너진다는 것을,[^7] 심지어 **논리적으로 일관된 문서 뭉치가 오히려 검색 정확도를 떨어뜨린다**는 반직관적 결과를 보였다. "우리 제품 데이터를 전부 컨텍스트에 넣어드립니다"는 안티패턴이다.

**M3. RAG 를 종교로 삼았다.**
같은 Anthropic 이 **코드에는 임베딩을 안 쓰고**(agentic grep 이 "압도적으로" 나았다),[^46] **문서 KB 에는 hybrid 를 쓰고**,[^86] **200K 토큰 미만이면 RAG 자체를 건너뛰라**고 한다.[^86] 워크로드 무관하게 벡터 DB 를 깐 제품은 **비용만 태우고 있을 가능성**이 있다. (반론: Milvus 는 grep-only 가 토큰을 태운다며 시맨틱 검색이 40%+ 토큰을 절감한다고 반박 — **벤더 이해관계 있음**.[^88])

**M4. 워크플로를 status ENUM 으로 모델링했다.**
"3일간 승인 대기 → 재개", "크래시 후 정확한 지점 복구", "청구 취소 시 보상 트랜잭션" — 상태 전이표는 이걸 표현 못 한다. 그래서 2025 년에 **워크플로 엔진 업계 전체가 AI 에이전트 인프라로 재포지셔닝**했다.[^13]

**M5. 툴을 다 노출하고 토큰을 태웠다.**
MCP 서버를 붙이면서 툴 정의 수십 개를 선로딩. Anthropic 자체 벤치마크로 **150K → 2K 토큰(98.7%)** 개선 여지가 있다.[^4]

**M6. 알림을 늘렸다.**
AI 가 요약할 수 있게 된 세계에서 "알림 개수"는 제품 가치가 아니라 **부채**다. (직접 1차 근거 얇음 — **부분 미확인**, 추론)

**M7. DCR(동적 클라이언트 등록)을 그대로 켰다.**
MCP 스펙 자체가 2025-11-25 에 DCR 을 **MAY 로 강등**했다 — 엔터프라이즈에서 무한 자기등록·관리 불가·공개 등록 엔드포인트 남용 문제 때문.[^68]

### 8.2 놓친 기회

**O1. 에이전트 액션 원장 = 신제품 카테고리.**
Microsoft 가 Agent 365 를 **$15/user/월** 짜리 별도 SKU 로 팔고 있다.[^16] "누가·어떤 에이전트가·무엇을·누구를 대신해 했는가" 를 기록·검색·감사하는 계층은 **그 자체로 유료 제품**이다. 대부분의 업무 SaaS 는 이미 audit_log 테이블을 갖고 있으면서 이 가치를 팔지 않는다.

**O2. Shadow agent 탐지.**
Agent 365 의 핵심 셀링포인트 중 하나가 **승인 안 된 에이전트 탐지**다.[^15] 워크스페이스에 어떤 외부 에이전트가 붙어 있는지 아는 제품이 거의 없다.

**O3. "에이전트가 위임받을 수 있는 태스크" 를 데이터 모델에 넣기.**
Linear 는 `app:assignable` 스코프 + delegate 관계로 이걸 제품화했고, 그 결과 Cursor·Devin·Claude Code 가 **알아서 Linear 에 붙었다**.[^83] 즉 **에이전트를 위한 API 표면이 유통 채널이 된다.** 이걸 안 만든 제품은 에이전트 생태계에서 보이지 않는다.

**O4. 생성 UI 를 읽기 전용 영역에 먼저 적용.**
Google 이 2025-11 에 출하했고 인간 선호가 확인됐다.[^81] 보고서·대시보드 같은 **잘못돼도 안 죽는 영역**부터 넣으면 리스크 없이 차별화된다.

**O5. Durable execution 을 승인 워크플로에.**
"승인 대기"를 예외가 아닌 **일시정지 상태**로 만들면, 그 위에 에이전트를 얹는 게 자연스러워진다. Auth0 의 Async Authorization(CIBA)이 정확히 이 패턴을 인증 계층에서 구현했다.[^69]

**O6. 200K 토큰 미만 워크스페이스에는 RAG 를 끄기.**
Anthropic 이 명시적으로 권고한다.[^86] 대부분의 중소 워크스페이스 KB 는 이 크기 미만이다 — **임베딩 비용·복잡도·stale index 문제를 통째로 없앨 수 있다.**

---

## 부록 A. PlanQ 에 대한 반증 가설 5 (검증 방법 포함)

> 이 문서의 목적은 PlanQ 가 옳음을 확인하는 게 아니라 **틀렸을 지점을 찾는 것**이다. 아래는 "높은 확률로 지금 구조적으로 잘못하고 있는 것" 가설이며, **각각 반증 가능하다.**

### H1. Cue 가 "AI User row" 로만 존재하고 **신원·위임·책임 분리가 없다** → 규제 산업 진입 불가
- **가설:** Cue 는 워크스페이스마다 User row 로 존재하지만, (a) 사람 계정과 구분되는 **agent principal 타입**, (b) **on-behalf-of 위임 기록**(누구의 권한으로 행동했나), (c) **accountable_user_id**(틀렸을 때 누가 책임지나)가 없을 가능성이 높다. 특히 Cue 가 태스크에 **assignee** 로 배정된다면 Linear 가 명시적으로 피한 설계(**"human assignee 가 여전히 책임진다"** → delegate)를 정면으로 밟은 것이다.[^17]
- **왜 치명적인가:** Q Bill(청구·증빙)이 붙어 있는 제품이다. "AI 가 청구서를 발행했다"에 사람 책임자가 없으면 부가세법 영역에서 못 쓴다. Entra 문서가 경고하는 **"API key 로 붙은 에이전트는 정책을 우회한다"** 와 같은 계열의 구멍.[^61]
- **검증 방법:**
  1. `audit_logs` 에서 Cue 가 수행한 액션 1건을 뽑아 **"어느 사람의 권한으로, 누구의 지시로 했는가"** 를 로그만 보고 재구성할 수 있는지 시도. 못 하면 가설 참.
  2. `tasks.assignee_id` 에 Cue 의 user_id 가 들어갈 수 있는지 코드/DB 확인. 들어간다면 **책임 주체가 AI 가 되는 row 가 실존**한다는 뜻.
  3. Cue 의 권한이 **위임자 권한을 초과**할 수 있는지 테스트: 권한 없는 멤버가 Cue 에게 시켜서 owner_only 라우트(invoice send)를 우회할 수 있는가? (권한 상승 경로)

### H2. 워크플로가 **status ENUM 전이표**라서, 에이전트가 참여하는 장기 실행 작업을 표현할 수 없다
- **가설:** `task_workflow` 의 status ENUM + `task_status_history` 는 **결정론적 사람 전이**만 모델링한다. LLM 호출(비결정적), 며칠짜리 승인 대기, 크래시 후 정확한 재개, 청구 취소 보상 트랜잭션 — 이걸 표현할 durable execution 계층이 없다면, Cue 가 실패했을 때 **"어디까지 했는지 모르는 상태"** 가 남는다.
- **왜 치명적인가:** 2025 년에 워크플로 엔진 업계 전체(Temporal/LangGraph/DBOS/Inngest/Cloudflare)가 이 문제 때문에 AI 인프라로 재포지셔닝했다.[^13] 그리고 LangGraph 문서는 **재개 시 노드 코드가 재실행될 수 있어 부작용 배치가 중요**하다고 경고한다[^11] — PlanQ 의 청구 생성·메일 발송이 재시도 안전(idempotent)한지 의심스럽다.
- **검증 방법:**
  1. Cue 가 다단계 작업(예: 태스크 자동추출 → 배정 → 알림) 도중 **프로세스를 강제 kill** 하고 PM2 재시작. 재개되는가, 아니면 반쯤 처리된 상태로 영구 정지하는가?
  2. 정기청구 cron 을 같은 입력으로 **2번 연속 실행**. 청구서가 2장 생기면 멱등성 없음 = 보상 트랜잭션 부재 확증.
  3. `services/*` 의 LLM 호출 지점에서 **재시도 시 side-effect 가 중복되는 경로**를 grep. (메일 발송 후 LLM 실패 → 전체 재시도 시 메일 2통?)

### H3. **KB(text-embedding-3-small + 하이브리드)가 워크로드에 비해 과잉**이고, 오히려 정확도를 깎고 있다
- **가설:** 워크스페이스별 KB 코퍼스가 **200K 토큰 미만**일 확률이 높은데, Anthropic 은 그 크기에선 **RAG 를 건너뛰고 롱컨텍스트+프롬프트 캐싱**을 쓰라고 명시한다.[^86] 게다가 임베딩 검색은 chunk 경계에서 맥락을 잃고, Chroma 의 실험은 **distractor 한 개만 들어가도 정확도가 떨어진다**고 했다.[^7]
- **왜 치명적인가:** 임베딩 파이프라인(kb_chunks, 재임베딩, stale index, cue_usage 과금)이 **없어도 되는 복잡도**일 수 있다. 그리고 정작 코드/파일 검색 영역에는 Claude Code 처럼 **agentic search(grep)가 더 나을 수 있다**.[^46]
- **검증 방법:**
  1. `SELECT business_id, SUM(LENGTH(content)) FROM kb_chunks GROUP BY business_id` — **대부분의 워크스페이스가 200K 토큰(≈ 800KB) 미만**이면 가설 참.
  2. 동일 질문 20개에 대해 **(A) 현재 하이브리드 KB 검색 vs (B) 전체 KB 를 컨텍스트에 넣고 프롬프트 캐싱** 으로 A/B. B 가 같거나 낫고 지연/비용이 허용 범위면 **KB 파이프라인 전체가 순 손실**이다.
  3. Q Note 답변 우선순위 6단계(priority>custom>reuse>generated>rag>general)에서 **rag 단계가 실제로 채택되는 비율**을 로깅. 5% 미만이면 유지비용 대비 무가치.

### H4. **MCP 를 안 붙였거나(또는 두껍게 붙였고), 그래서 에이전트 생태계에서 보이지 않는다**
- **가설:** PlanQ 는 Cue 라는 **내부 에이전트**는 만들었지만, **외부 에이전트(Claude Code, Cursor, ChatGPT, Copilot)가 PlanQ 에 붙을 수 있는 표면**을 만들지 않았을 가능성이 높다. Linear 는 정반대로 했고, 그 결과 Cursor·Devin·Claude Code 가 **알아서 붙었다**.[^83]
- **왜 치명적인가:** 2026 년에 **에이전트용 API 표면 = 유통 채널**이다. MCP 는 Linux Foundation 표준이 됐고 OpenAI/Google/Microsoft 가 전부 클라이언트다.[^1] PlanQ 가 MCP 서버를 제공하지 않으면, 고객의 에이전트가 PlanQ 데이터에 접근하는 유일한 방법은 **PlanQ 를 우회하는 것**이다. 그리고 만약 붙였다면, 툴 정의를 통째로 선로딩해 토큰을 태우고 있을 가능성이 높다(98.7% 절감 여지).[^4]
- **주의(이게 이 가설의 반쪽이다):** MCP 는 **2026-07-28 에 세션·핸드셰이크를 제거하는 파괴적 개정**을 앞두고 있다.[^3] 지금 두껍게 붙이면 재작업한다. **정답은 "얇게, 게이트웨이 뒤에, 코드실행 패턴으로".**
- **검증 방법:**
  1. 코드베이스에 MCP 서버 구현이 있는가? 없으면 가설 전반부 참.
  2. 있다면 툴 정의 총 토큰 수를 측정 — 10K 토큰 넘으면 code-execution 패턴으로 전환 대상.
  3. **가장 강한 검증:** Claude Code 에 PlanQ MCP 를 붙여 "이번 주 미수금 청구서 목록 뽑아줘"를 시켜본다. 안 되면 경쟁사 대비 유통 채널 하나가 통째로 비어 있는 것.

### H5. **감사 로그가 "부가 기능"이라 에이전트 시대의 진실원이 못 된다** (= 이벤트 로그가 1급이 아니다)
- **가설:** PlanQ 는 `audit_logs`(old_value/new_value JSON) + 도메인별 history 테이블(`task_status_history`, `project_status_history`, `invoice_status_history`)로 **파편화**돼 있다. 즉 **"이 워크스페이스에서 지금까지 일어난 모든 일"을 하나의 append-only 스트림으로 재생할 수 없다.** OpenHands(event stream)·Temporal(저널)·Confluent(Agent Decision Record)가 독립적으로 도달한 곳과 반대다.[^50][^12][^73]
- **왜 치명적인가:** (a) 에이전트에게 줄 컨텍스트를 만들 때 **여러 테이블을 JOIN 해서 재구성**해야 하고 — 이건 누락되기 쉽다, (b) "에이전트 행동 원장" 이라는 **판매 가능한 제품**(Agent 365 $15/user/월)[^16]을 만들 수 없다, (c) 규제 대응(비부인 감사)에서 CSA 가 요구하는 **요청 컨텍스트 해시·서명 체인**을 얹을 자리가 없다.[^71]
- **검증 방법:**
  1. "지난 30일간 워크스페이스 X 에서 일어난 모든 상태 변화를 시간순 단일 스트림으로" 쿼리를 짜 본다. 3개 이상 테이블 UNION 이 필요하면 가설 참.
  2. `audit_logs` 커버리지 측정: CUD 라우트 수 대비 실제 AuditLog 호출 라우트 수. CLAUDE.md 에 이미 "AuditLog 누락 5영역 채움"(사이클 N+18~21) 기록이 있다 — **누락이 반복 발생한다는 것 자체가 "부가 기능"이라는 증거**다.
  3. Cue 가 한 액션과 사람이 한 액션이 **같은 스키마로** 기록되는가? 다르다면 에이전트 원장을 나중에 못 만든다.

---

## 각주

[^1]: Linux Foundation, "Linux Foundation Announces the Formation of the Agentic AI Foundation" (2025-12-09). https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation — 적대적 검증: VERIFIED (TechCrunch 독립 확인). 단 Anthropic/Block/OpenAI 는 "설립 기여자"이지 법인 설립자는 아님.
[^2]: Anthropic, "Donating the Model Context Protocol and establishing the Agentic AI Foundation" (2025-12-09). https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation — 벤더 발표 수치(월 9,700만 SDK 다운로드, 공개 MCP 서버 10,000+)는 Anthropic 자체 집계.
[^3]: MCP Blog, "2026-07-28 Release Candidate" (2026-05-21). https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ — 적대적 검증: VERIFIED WITH CORRECTION. Roots/Sampling/Logging deprecation 은 **annotation-only** 이며 "이 릴리스와 이후 1년 내 발행되는 모든 스펙 버전에서 계속 동작한다".
[^4]: Anthropic Engineering, "Code execution with MCP" (2025-11-04). https://www.anthropic.com/engineering/code-execution-with-mcp
[^5]: Cloudflare, "Code Mode: the better way to use MCP" (2025-09-26). https://blog.cloudflare.com/code-mode/
[^6]: Cloudflare / InfoQ (2026-04). https://blog.cloudflare.com/code-mode-mcp/ — 수치는 Cloudflare 자체 주장, 독립 검증 없음.
[^7]: Chroma Research, "Context Rot: How Increasing Input Tokens Impacts LLM Performance" (Hong, Troynikov, Huber, 2025-07-14). https://www.trychroma.com/research/context-rot
[^8]: Anthropic Engineering, "Effective context engineering for AI agents" (2025-09-29). https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
[^9]: Anthropic Engineering, "How we built our multi-agent research system" (2025-06-13). https://www.anthropic.com/engineering/multi-agent-research-system — 90.2% 는 **내부 eval**, 벤더 자체 측정.
[^10]: Cognition, "Don't Build Multi-Agents" (Walden Yan, 2025-06-12). https://cognition.com/blog/dont-build-multi-agents
[^11]: LangChain Docs, "Durable execution". https://docs.langchain.com/oss/python/langgraph/durable-execution
[^12]: Temporal, "AI solutions" + OpenAI Agents SDK 통합 문서. https://temporal.io/solutions/ai · https://docs.temporal.io/ai-cookbook/openai-agents-sdk-python — Replit/OpenAI Codex 사례는 Temporal 측 출처.
[^13]: DBOS, "Postgres is all you need for durable execution" https://www.dbos.dev/blog/postgres-is-all-you-need-for-durable-execution · Inngest, "Durable execution: the key to harnessing AI agents" https://www.inngest.com/blog/durable-execution-key-to-harnessing-ai-agents (2025)
[^14]: Microsoft Entra Blog, "Announcing Microsoft Entra Agent ID" (Build 2025, 2025-05). https://techcommunity.microsoft.com/blog/microsoft-entra-blog/announcing-microsoft-entra-agent-id-secure-and-manage-your-ai-agents/3827392
[^15]: Microsoft 365 Blog, "Microsoft Agent 365: the control plane for AI agents" (2025-11-18). https://www.microsoft.com/en-us/microsoft-365/blog/2025/11/18/microsoft-agent-365-the-control-plane-for-ai-agents/ — Ignite 2025 Book of News 로 교차 확인.
[^16]: Microsoft Security Blog, "Microsoft Agent 365 now generally available" (2026-05-01). https://www.microsoft.com/en-us/security/blog/2026/05/01/microsoft-agent-365-now-generally-available-expands-capabilities-and-integrations/ — 적대적 검증: VERIFIED. **$15/user/월은 사용자당이지 에이전트당이 아니다.** 가격은 Microsoft 자체 발표(독립 1차 확인 없음).
[^17]: Linear, "Agents" 개발자 문서 + "Agents in Linear". https://linear.app/developers/agents · https://linear.app/docs/agents-in-linear — 적대적 검증: VERIFIED WITH CORRECTION. 이슈 배정은 **`assignee` 가 아니라 `delegate`**; "The human assignee remains responsible for the issue, even after delegation." assignable/mentionable 은 자동이 아니라 opt-in 스코프.
[^18]: Salesforce Help, "Agentforce Flex Credits" (article id 004811240). https://help.salesforce.com/s/articleView?id=004811240 — 적대적 검증: VERIFIED. 단 US 정가 기준이며, Voice 액션은 30 크레딧($0.15)이라는 2차 출처가 있어 "모든 액션 = 20 크레딧" 은 보편적으로 참이 아님.
[^19]: Intercom Fin pricing. https://fin.ai/help/en/articles/13975800-fin-pricing-outcomes · Bessemer, "AI pricing and monetization playbook" https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook
[^20]: Zendesk Newsroom, outcome-based pricing (2024-08-28). https://www.zendesk.de/newsroom/articles/zendesk-outcome-based-pricing/
[^21]: ICONIQ, "State of AI" (2026 bi-annual snapshot). https://www.iconiq.com/growth/reports/2026-state-of-ai-bi-annual-snapshot — outcome-based 2%(2025 Q2)→18%(2025말), consumption 19%→35%, 하이브리드 38% 최다.
[^22]: Atlassian, "Rovo licensing". https://www.atlassian.com/licensing/rovo — 2025-04 Premium/Enterprise 번들, Rovo 크레딧 미터. Rovo Dev $20/dev/월(2,000 크레딧, 초과 $0.01/credit).
[^23]: Google Workspace Gemini 번들(2025-01) — 2차 출처만 확인. https://www.googally.com/blog/is-gemini-included-in-google-workspace — **부분 미확인**.
[^24]: TechCrunch, "Klarna CEO doubts that other companies will replace Salesforce with AI" (2025-03-04). https://techcrunch.com/2025/03/04/klarna-ceo-doubts-that-other-companies-will-replace-salesforce-with-ai/ · diginomica https://diginomica.com/those-shutting-down-salesforce-and-workday-rumors-klarna-no-we-didnt-replace-saas-llm-admits-ceo
[^25]: 동일 TechCrunch 기사 — Siemiatkowski: "Salesforce 의 종말이라고 생각하지 않는다; 소수 SaaS 가 시장을 통합할 가능성이 더 크다".
[^26]: Fortune, "Klarna turns from AI to real-person customer service" (2025-05-09). https://fortune.com/2025/05/09/klarna-ai-humans-return-on-investment/ — **주의: 고객서비스 AI 철회이지 Salesforce/Workday 결정 철회가 아니다. 두 사안은 별개.** "Klarna 가 Salesforce 로 복귀했다"는 주장은 **증거 없음 — 미확인.**
[^27]: Retool, "AI Build vs Buy Report 2026" (n=817). https://retool.com/blog/ai-build-vs-buy-report-2026 — **응답자가 Retool 고객/빌더 → 강한 선택편향. 전체 시장 일반화 불가.**
[^28]: Salesforce Investor Relations (2026-06-15). https://investor.salesforce.com/news/news-details/2026/Salesforce-Signs-Definitive-Agreement-to-Acquire-Fin/default.aspx — 적대적 검증: VERIFIED. **"서명"이지 "완료"가 아니다** — 클로징은 Salesforce FY2027 Q4 예정, 규제 승인 조건부.
[^29]: Gartner IT 지출 전망 (2026-04-22 수정). https://www.gartner.com/en/newsroom/press-releases/2026-04-22-gartner-forecasts-worldwide-it-spending-to-grow-13-point-5-percent-in-2026-totaling-6-point-31-trillion-dollars — 2026 소프트웨어 $1.44T(+15.1%).
[^30]: MCP Specification 2025-06-18. https://modelcontextprotocol.io/specification/2025-06-18
[^31]: MCP Specification 2025-11-25 changelog. https://modelcontextprotocol.io/specification/2025-11-25/changelog
[^32]: TechCrunch, "OpenAI adopts rival Anthropic's standard" (2025-03-26). https://techcrunch.com/2025/03/26/openai-adopts-rival-anthropics-standard-for-connecting-ai-models-to-data/
[^33]: OpenAI Agents SDK, MCP. https://openai.github.io/openai-agents-python/mcp/
[^34]: OpenAI Apps SDK, "MCP server". https://developers.openai.com/apps-sdk/concepts/mcp-server
[^35]: Demis Hassabis (X, 2025-04-09). https://x.com/demishassabis/status/1910107859041271977
[^36]: Google Cloud Blog, official MCP support for Google services. https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services — 세부 날짜 **미확인**.
[^37]: Microsoft, "MCP is now generally available in Copilot Studio" (2025-05-29). https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio/
[^38]: Windows Blogs, "Securing the Model Context Protocol" (Build 2025, 2025-05-19). https://blogs.windows.com/windowsexperience/2025/05/19/securing-the-model-context-protocol-building-a-safer-agentic-future-on-windows/ — 원문 403, 2차 확인. developer preview 실제 출시 상태 **미확인**.
[^39]: MCP Blog, "MCP Registry preview" (2025-09-08). https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/ — GA 여부 **미확인**.
[^40]: OWASP, "MCP Tool Poisoning". https://owasp.org/www-community/attacks/MCP_Tool_Poisoning · Simon Willison (2025-04-09) https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/
[^41]: AWS, Bedrock AgentCore Gateway. https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html — rate limit 한계 서술은 **2차 출처, 신뢰도 중**.
[^42]: Cloudflare, remote MCP servers (2025-03). https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/
[^43]: Cloudflare One, MCP server portals. https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/ — **미fetch, 신뢰도 중**.
[^44]: IBM, mcp-context-forge. https://github.com/IBM/mcp-context-forge — 베타 상태 서술 신뢰도 중.
[^45]: Anthropic/Claude, "Building agents with the Claude Agent SDK" (2025-09-29). https://claude.com/blog/building-agents-with-the-claude-agent-sdk
[^46]: Boris Cherny (Claude Code) 인터뷰 요약 — 초기 로컬 벡터 DB RAG → agentic search 로 전환("outperformed everything. By a lot"). https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny · https://vadim.blog/claude-code-no-indexing/ — 팟캐스트 원문 미청취, **인용 정확도 신뢰도 중**.
[^47]: 상동.
[^48]: Anthropic Engineering, "Claude Code sandboxing" (2025-10-20). https://www.anthropic.com/engineering/claude-code-sandboxing — 84% 는 Anthropic **내부 사용** 기준.
[^49]: Answer.AI, "Thoughts on a month with Devin" (2025-01-08). https://www.answer.ai/posts/2025-01-08-devin.html — **Devin 2.0 이전 시점.** Cognition 의 반박 수치(2.0 에서 ACU 당 주니어 태스크 83% 증가)는 벤더 내부 주장 — **미확인**.
[^50]: OpenHands (arXiv:2407.16741, ICLR 2025). https://arxiv.org/abs/2407.16741
[^51]: Microsoft Agent Framework (AutoGen + Semantic Kernel 통합, 2025-10 프리뷰 / 2026-04 1.0 GA). https://learn.microsoft.com/en-us/agent-framework/overview/ — 1.0 정확한 날짜는 2차 출처.
[^52]: Anthropic Engineering, "Demystifying evals for AI agents" (2026-01-09). https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
[^53]: Microsoft Learn, "What is Microsoft Entra Agent ID" (2026-04-14). https://learn.microsoft.com/en-us/entra/agent-id/what-is-microsoft-entra-agent-id
[^54]: Microsoft Learn, Copilot Studio billing & licensing. https://learn.microsoft.com/en-us/microsoft-copilot-studio/billing-licensing — 2025-09-01 messages → Copilot Credits 전환.
[^55]: Salesforce Help, agent user permissions. https://help.salesforce.com/s/articleView?id=ai.agent_user.htm — 정확한 라이선스 명칭 **미확인**.
[^56]: ServiceNow Newsroom (2026-05-05). https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-turns-enterprise-AI-chaos-into-control-with-the-platform-for-governed-autonomous-work/default.aspx — AI Control Tower + Action Fabric(MCP Server GA) + Veza 연계 신원 거버넌스.
[^57]: Notion Releases (2026-02-24), Custom Agents GA. https://www.notion.com/releases/2026-02-24 · Notion 3.0 (2025-09-18) https://www.notion.com/blog/introducing-notion-3-0
[^58]: Google Cloud, "Introducing Gemini Enterprise" (2025-10). https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise — Agentspace 흡수, 중앙 거버넌스. 좌석 가격($21/$30)은 TechCrunch 등 2차 — **부분 미확인**.
[^59]: SAP News, "Joule: SAP uniquely delivers AI agents" (2025-02). https://news.sap.com/2025/02/joule-sap-uniquely-delivers-ai-agents/ · AI Units 과금 https://www.sap.com/products/artificial-intelligence/pricing.html — 스텝당 요율은 **2차 출처, 부분 미확인**.
[^60]: Slack Blog, Dreamforce 2025 native AI (2025-10). https://slack.com/blog/news/dreamforce-slack-native-ai — 공식 Slack MCP 서버 + Real-Time Search API.
[^61]: Microsoft Learn, "Conditional Access for agent identities" (2026-06-19). https://learn.microsoft.com/en-us/entra/identity/conditional-access/agent-id — **"all users" 정책이 에이전트 user account 를 포함하지 않음 / 그룹 스코핑 미지원 / API key 인증은 CA 우회** 를 명시.
[^62]: WorkOS, "OAuth on behalf of AI agents" (2026-04-28). https://workos.com/blog/oauth-on-behalf-of-ai-agents — RFC 8693 `act` 클레임 기반 귀속 패턴.
[^63]: IETF, draft-ietf-oauth-identity-chaining (rev-16, 2026-06-26). https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/
[^64]: Okta Newsroom, "Cross App Access" (2025-06-23). https://www.okta.com/newsroom/press-releases/okta-introduces-cross-app-access-to-help-secure-ai-agents-in-the/
[^65]: Okta Newsroom (2026-06), XAA → MCP "Enterprise-Managed Authorization" 확장 편입. https://www.okta.com/newsroom/articles/cross-app-access-extends-mcp-to-bring-enterprise-grade-security-to-ai-agents/ — **Okta 측 발표 기반, 신뢰도 중**.
[^66]: IETF, draft-oauth-ai-agents-on-behalf-of-user-01 (WSO2, 2025-05-08). https://www.ietf.org/archive/id/draft-oauth-ai-agents-on-behalf-of-user-01.html — **OAuth WG 미채택**(2026-04 기준).
[^67]: MCP Specification 2025-11-25, Authorization. https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
[^68]: Aaron Parecki, "MCP Authorization spec update" (2025-11-25). https://aaronparecki.com/2025/11/25/1/mcp-authorization-spec-update — DCR → CIMD 전환 배경(무한 자기등록·관리 불가).
[^69]: Auth0, "Introducing Auth0 for AI Agents" (2025-04-08). https://auth0.com/blog/introducing-auth0-for-ai-agents/ — Token Vault / Async Authorization(CIBA+PAR) / FGA for RAG. GA 정확 시점 **미확인**.
[^70]: Descope, Agentic Identity Hub. https://www.descope.com/press-release/agentic-identity-hub — 벤더 보도자료, 신뢰도 중.
[^71]: Cloud Security Alliance, "Agentic AI Identity and Access Management: A New Approach". https://cloudsecurityalliance.org/artifacts/agentic-ai-identity-and-access-management-a-new-approach — DID+VC, JIT task-scoped credential, 비부인 감사 체인 권고. 발행일 2025-08-18(페이지 표기) vs 블로그 2025-03-11 — **날짜 신뢰도 중**.
[^72]: NIST, AI Agent Standards Initiative. https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative — NCCoE 컨셉 페이퍼 의견수렴 2026-04-02 마감(1차 확인). 발행일·참조표준 목록은 2차 출처 — **미확인**.
[^73]: Confluent, "The Future of AI Agents is Event-Driven" (2025). https://www.confluent.io/blog/the-future-of-ai-agents-is-event-driven/ · "Compliant AI agents" (immutable Agent Decision Record) https://www.confluent.io/blog/compliant-ai-agents-stateful-stream-processing/ — **Confluent(벤더) 주도 담론. 독립 검증원 얇음.**
[^74]: Satya Nadella, BG2 팟캐스트 (2024-12): "The notion that business applications exist, that's probably where they'll all collapse in the agent era. Because if you think about it, they are essentially CRUD databases with a bunch of business logic." — **"SaaS is dead" 는 미디어 프레이밍이지 직접 발언이 아님.** https://www.windowscentral.com/microsoft/hey-why-do-i-need-excel-microsoft-ceo-satya-nadella-foresees-a-disruptive-agentic-ai-era-that-could-aggressively-collapse-saas-apps
[^75]: Jamin Ball (Altimeter), "Long Live Systems of Record" (Clouded Judgement, 2025-12-12). https://cloudedjudgement.substack.com/p/clouded-judgement-121225-long-live — **원문 미fetch, 신뢰도 중**.
[^76]: TechCrunch, "Klarna CEO says company will use humans to offer VIP customer service" (2025-06-04). https://techcrunch.com/2025/06/04/klarna-ceo-says-company-will-use-humans-to-offer-vip-customer-service/ — 1,200개 SaaS 해지는 **회사 발언 기반**.
[^77]: TechCrunch, "Lovable says it added $100M in revenue last month alone with just 146 employees" (2026-03-11). https://techcrunch.com/2026/03/11/lovable-says-it-added-100m-in-revenue-last-month-alone-with-just-146-employees/ — **회사 자체 발표 수치.** "Fortune 500 절반이 사용" 은 TechCrunch 도 "reportedly" 처리 — **미확인**.
[^78]: Sacra, "Replit at $253M ARR" (2025-10). https://sacra.com/research/replit-at-253m-arr-growing-2352-yoy/ — **추정치**.
[^79]: IBM CEO 설문(n=2,000, 2025-05): AI 프로젝트 기대 ROI 달성 25%, 전사 확산 16%. Fortune 경유. https://fortune.com/2025/05/09/klarna-ai-humans-return-on-investment/
[^80]: InformationWeek, "Why AI-built tools are threatening SaaS vendor renewals" (2026-07-07). https://www.informationweek.com/it-strategy/why-ai-built-tools-are-threatening-saas-vendor-renewals — "cheap to build ≠ cheap to trust". 정량 근거는 약함.
[^81]: Google Research, "Generative UI" (2025-11-18, Gemini 3 동시 출시). https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/ — 인간 평가자 선호(생성 속도 무시 시). research 원문 직접 fetch 미실시, 복수 출처 일치.
[^82]: Vercel, "AI SDK 3: Generative UI". https://vercel.com/blog/ai-sdk-3-generative-ui — 정확한 발표일 **미확인**.
[^83]: Linear Changelog, "Cursor agent" (2025-08-21). https://linear.app/changelog/2025-08-21-cursor-agent · https://linear.app/agents — Devin·Claude Code·Copilot 도 동일 방식으로 워크스페이스 멤버로 통합.
[^84]: Ink & Switch, "Malleable Software" (Litt, Horowitz, van Hardenberg, Matthews, 2025-06). https://www.inkandswitch.com/essay/malleable-software/ — "each application manages its own data in a private silo"; AI 코드 생성만으로는 malleability 가 해결되지 않는다는 논지.
[^85]: Dealroom (2025-04) 인당 매출 추정. https://x.com/dealroomco/status/1914264599505018989 — **2차 추정치. "AI-native 라서 SaaS 좌석을 덜 산다"는 인과 데이터는 어떤 소스에서도 확인 못 함 — 미확인.**
[^86]: Anthropic, "Introducing Contextual Retrieval" (2024-09-19). https://www.anthropic.com/news/contextual-retrieval — contextual embedding + contextual BM25 + rerank 로 top-20 검색 실패 5.7%→1.9%(67% 감소). **"~200K 토큰 미만 코퍼스는 RAG 를 건너뛰고 롱컨텍스트 + 프롬프트 캐싱을 쓰라"** 고 명시.
[^87]: NHI(비인간 신원) 비율 수치들(144:1, 92:1, 82:1, 45:1 등)은 **벤더 설문 기반이며 서로 불일치한다 — 방향성만 유효, 절대값 미확인.** https://thehackernews.com/expert-insights/2026/05/the-non-human-identity-crisis-why-your.html
[^88]: Milvus, "Why I'm against Claude Code's grep-only retrieval" (2025-08-25). https://milvus.io/blog/why-im-against-claude-codes-grep-only-retrieval-it-just-burns-too-many-tokens.md — 시맨틱 검색이 grep 대비 토큰 40%+ 절감 주장. **벡터 DB 벤더 — 이해관계 있음.**
