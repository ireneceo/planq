# 무료 업무체계 자가진단 — 설계안 (운영 신고 #426) · 2026-10-02 · [Opus] 초안

> Irene #426: *"플랜큐 신청할 때 업무설계 유료로 하는 거 있잖아. 그런데 무료로 기본 설문 하게 한 다음
> 맞춤피드백 주는 거 만들면 어때? 왜 플래큐를 써야 하는지 더 확실해지게. 그리고 우리도 케이스를 확인하고
> 고객데이터 쌓게. 잠재고객도 찾고"*

**상태: 설계안 — Irene 결정 4건 후 구현.** 공개(무인증) 표면이 새로 생기므로 구현 뒤 Fable 게이트 대상(R=1).

---

## 1. 무엇을 만드나 — 한 줄

`/service` 의 **「업무체계 진단 신청하기」** 앞에 **무료 자가진단(5분)** 을 둔다.
답하면 즉시 **6개 층 점수 + 약한 층에 맞춘 피드백**이 나오고, 거기서 ①PlanQ 무료로 시작 ②유료 진단 신청으로 이어진다.
결과를 받고 싶은 사람은 이메일을 남긴다 → 플랫폼 관리자에게 **잠재고객 + 응답 데이터**로 쌓인다.

## 2. 틀은 이미 있다 — 새로 만들지 않는다

| 쓰는 것 | 어디 |
|---|---|
| 6개 층(업무구조·업무흐름·정보흐름·의사결정·자동화·구현 플랫폼) | `landing.json servicePage.layers` — 진단 문항·결과가 **같은 층 이름**을 쓴다 |
| 공개 접수 + IP 제한(3/시간·10/일) + 관리자 목록 | `routes/inquiries.js` · `contact_inquiries` · 관리자 > 문의 |
| 랜딩 공개 페이지 등록 · SEO 본문 | `public/seo-pages.json` 한 줄 |
| 방문 집계 | `landing_visits` (이미 랜딩 전체에 붙어 있다) |

## 3. 화면

```
/service/diagnosis  (공개, 로그인 불필요)
┌──────────────────────────────────────────┐
│ 우리 회사 업무체계, 5분 자가진단            │
│ 12문항 · 무료 · 결과는 바로 화면에         │
│ ──────────────────────────────            │
│ [1/12] 고객 요청은 주로 어디로 들어오나요?    │
│   ○ 카톡·전화·메일 등 여기저기                │
│   ○ 한두 채널로 모이지만 정리는 사람이        │
│   ○ 한 곳에 모이고 담당자가 정해진다           │
│                          [이전] [다음]       │
└──────────────────────────────────────────┘
          ↓ 12문항 끝
┌──────────────────────────────────────────┐
│ 진단 결과                                 │
│ 업무흐름 ■■□□□  정보흐름 ■■■□□ ...  (6층)    │
│ 가장 먼저 손볼 곳: 업무흐름                   │
│  · 지금 상태 한 줄 (답에서 나온 문장)          │
│  · 이렇게 바꾸면 (2~3줄)                      │
│  · PlanQ 에서는: Q task 요청→확인→완료 단계    │
│ [PlanQ 무료로 시작] [전문가 진단 신청(유료)]   │
│ ── 결과를 메일로 받기 (선택) ──              │
│ 이메일 [          ] 회사명 [     ] □ 동의    │
└──────────────────────────────────────────┘
```

- 문항: 6층 × 2문항 = **12문항**, 3지선다(점수 0/1/2). 업종·인원은 **선택 문항**(맞춤 문장에만 쓴다).
- 결과 문장은 **규칙 기반**(층 × 점수 구간 × 업종) — ko/en 둘 다 미리 쓴 문구. **LLM 을 부르지 않는다**(무인증 표면에 LLM 을 붙이면 비용 폭탄 통로가 된다 — CLAUDE.md 운영 안정성 1).
- 폰·태블릿·데스크탑 3폭. 진행 중 답은 브라우저에만 보관(새로고침해도 이어서).

## 4. 데이터 — 새 표 하나

`diagnosis_responses` — `id` · `answers` JSON(문항 id→선택) · `scores` JSON(층→0~4) · `industry` · `team_size` ·
`email`(선택) · `company`(선택) · `consent_at` · `lang` · `source`(utm) · `inquiry_id`(이메일을 남겨 문의로 넘어간 경우) · `created_at`.

- **이메일이 없으면 개인정보가 없다** — 익명 응답만 쌓인다(케이스 통계용).
- 이메일을 남기면 `contact_inquiries` 에 `kind='diagnosis'` 로도 한 건 만든다 → 관리자 문의 목록·알림이 그대로 동작(ENUM 끝 append, 멱등 마이그레이션).
- 쿠키·IP·UA 저장 없음(랜딩 방문 집계와 같은 원칙). 제출은 IP 제한(문의와 같은 3/시간·10/일).

## 5. 관리자

플랫폼 관리자 > **자가진단** — 응답 수 · 층별 평균 · 업종별 분포 · 이메일 남긴 사람(잠재고객) 목록. 행을 누르면 그 응답과 결과.
(«케이스를 확인하고 고객데이터 쌓게» 의 자리.)

## 6. Irene 이 결정할 것

1. **문항 초안을 누가 쓰나** — 내가 6층 × 2문항 초안(ko/en)을 쓰고 Irene 이 고친다 **(추천)** / Irene 이 직접.
2. **결과 피드백 방식** — 규칙 기반 미리 쓴 문구 **(추천: 비용 0·즉시·남용 불가)** / AI 생성(맞춤도↑, 무인증 비용 위험 → 이메일 인증 뒤에만).
3. **결과를 보려면 이메일이 필요한가** — 아니오, 화면에 바로 · 메일 받기는 선택 **(추천: 완료율↑)** / 이메일 필수(리드↑·이탈↑).
4. **이메일 남긴 사람에게 자동 메일** — 결과 요약 1통만 **(추천)** / 안 보냄 / 후속 메일 시퀀스(마케팅 동의 별도 필요).

## 7. 구현 순서 (결정 후)

① 문항·결과 문구 ko/en(JSON) → ② `diagnosis_responses` + 멱등 마이그레이션 + `contact_inquiries.kind` append →
③ 공개 POST(IP 제한·입력 검증·화이트리스트 필드) → ④ `/service/diagnosis` 화면 3폭 + seo-pages 등록 →
⑤ 관리자 화면 → ⑥ 카나리(제출·결과·제한·관리자 노출 · 음성 대조군: 비관리자 403) → Fable 게이트(R=1 공개 표면).

---

## 부록 A. 문항 초안 (ko/en) — Irene 검토용 · 2026-10-02 [Opus]

점수: ① 0 · ② 1 · ③ 2. 층 점수 = 두 문항 합(0~4). 결과 구간: 0~1 «먼저 손볼 곳» · 2~3 «다듬을 곳» · 4 «잘 되고 있음».

### 업무구조 (Business Structure)
**S1.** 우리 회사가 돈을 버는 핵심 업무가 무엇인지, 팀원 모두가 같은 말로 설명할 수 있나요? / *Could everyone on the team describe your core revenue-generating work the same way?*
① 사람마다 다르게 말한다 / *Everyone says something different* ② 대표·팀장은 알지만 정리된 문서는 없다 / *Leaders know, but it isn't written down* ③ 정리돼 있고 모두 안다 / *It's documented and everyone knows*
**S2.** 일이 자주 막히는 지점(병목)을 알고 있나요? / *Do you know where work usually gets stuck?*
① 막히면 그때 안다 / *We find out when it happens* ② 감으로는 안다 / *We have a rough sense* ③ 어디서 막히는지 알고 관리한다 / *We know and manage it*

### 업무흐름 (Workflow)
**W1.** 고객 요청은 주로 어디로 들어오나요? / *Where do customer requests come in?*
① 카톡·전화·메일 등 여기저기 / *Everywhere — chat apps, calls, email* ② 한두 곳으로 모이지만 정리는 사람이 / *A couple of channels, sorted by hand* ③ 한 곳에 모이고 담당자가 정해진다 / *One place, with an owner assigned*
**W2.** 일을 넘기거나 확인받을 때(승인·검수) 어떻게 하나요? / *How do handoffs and approvals happen?*
① 말로·메신저로 그때그때 / *Ad hoc, by word or chat* ② 정해진 사람은 있지만 기록이 흩어진다 / *Set people, but records are scattered* ③ 단계가 정해져 있고 기록이 남는다 / *Defined steps, and it's recorded*

### 정보흐름 (Information)
**I1.** 지난 프로젝트의 자료·고객 대화를 찾는 데 얼마나 걸리나요? / *How long does it take to find past project files or customer conversations?*
① 사람에게 물어봐야 한다 / *We have to ask someone* ② 찾을 수는 있지만 여러 곳을 뒤진다 / *Findable, across several places* ③ 한 곳에서 바로 찾는다 / *Instantly, in one place*
**I2.** 담당자가 바뀌거나 쉬면 고객 이력을 이어받을 수 있나요? / *If someone is away, can others pick up the customer's history?*
① 그 사람만 안다 / *Only that person knows* ② 일부는 남아 있다 / *Partly* ③ 누구나 이어받는다 / *Anyone can pick it up*

### 의사결정 (Decision)
**D1.** 대표 확인 없이 팀원이 결정할 수 있는 범위가 정해져 있나요? / *Is it clear what team members can decide without the owner?*
① 거의 모든 것이 대표에게 온다 / *Almost everything goes to the owner* ② 암묵적으로는 있다 / *Implicitly* ③ 기준이 정해져 있다 / *There are clear rules*
**D2.** 결정한 내용과 이유가 남나요? / *Are decisions and their reasons recorded?*
① 남지 않는다 / *No* ② 메신저에 흩어져 있다 / *Scattered in chats* ③ 업무·문서에 남는다 / *Recorded with the work*

### 자동화 (Automation)
**A1.** 매주 반복되는 일(보고·청구·안내 메일 등)을 어떻게 처리하나요? / *How do you handle weekly repeat work (reports, invoices, notices)?*
① 매번 손으로 / *Manually every time* ② 템플릿은 있지만 손으로 / *Templates, but manual* ③ 일정 부분은 자동으로 돈다 / *Partly automated*
**A2.** AI 를 업무에 어떻게 쓰고 있나요? / *How do you use AI at work?*
① 거의 안 쓴다 / *Hardly* ② 각자 따로 쓴다 / *Each person on their own* ③ 팀 업무 흐름 안에서 쓴다 / *Within the team's workflow*

### 구현 플랫폼 (Platform)
**P1.** 업무에 쓰는 도구는 몇 개인가요? / *How many tools does your team use for work?*
① 5개 이상, 서로 연결 안 됨 / *5+, not connected* ② 2~4개, 일부 연결 / *2–4, partly connected* ③ 한두 개로 정리돼 있다 / *One or two, consolidated*
**P2.** 고객이 진행 상황·자료·청구를 직접 볼 수 있나요? / *Can customers see progress, files and invoices themselves?*
① 매번 우리가 보내 준다 / *We send it each time* ② 일부만 / *Some of it* ③ 링크 하나로 다 본다 / *All in one link*

### 선택 문항 (점수 없음 — 맞춤 문장에만)
- 업종 / *Industry*: 에이전시·디자인 / 컨설팅·교육 / IT·개발 / 제조·유통 / 기타
- 인원 / *Team size*: 1~5 / 6~20 / 21~50 / 50+

### 결과 문장 예시 (업무흐름 0~1점)
> **지금:** 요청이 여러 곳으로 들어와 누가 맡았는지가 흐려집니다.
> **이렇게 바꾸면:** 요청을 한 곳에 모으고, 들어오는 순간 담당자와 마감을 정하세요. 확인·승인은 정해진 단계로 남기세요.
> **PlanQ 에서는:** Q talk·Q mail 로 들어온 요청을 Q task 로 바로 넘기고, 요청 → 확인 → 완료 단계가 기록됩니다.
