#!/usr/bin/env python3
"""마케팅 캡처용 Q Note 데모 세션 시드 (#146 랜딩 /features 스크린샷)

Q Note 는 FastAPI + SQLite 로 백엔드가 분리돼 있어 dev-backend 의 시드 스크립트가 닿지 않는다.
이 스크립트는 데모 캡처 계정(user_id)의 세션·발화·질문만 지우고 다시 만든다.

실행: python3 q-note/scripts/seed_demo_sessions.py --business-id 105 --user-id 1000202 --user-name 김서연
   (dev-backend/scripts/seed-demo-workspace.js 가 마지막 단계에서 자동 호출한다)

fail-closed: DB 경로가 /opt/planq/q-note 아래가 아니거나 user_id 가 없으면 아무것도 하지 않는다.
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime, timedelta

DB_PATH = '/opt/planq/q-note/data/qnote.db'
ALLOWED_DB_PREFIX = '/opt/planq/q-note/'


def ts(days_ago=0, hours_ago=0):
    return (datetime.now() - timedelta(days=days_ago, hours=hours_ago)).strftime('%Y-%m-%d %H:%M:%S')


# ─────────────────────────────────────────────
# 데모 콘텐츠 (Irene 검수 대상 — 화면에 그대로 노출)
# ─────────────────────────────────────────────
def build_sessions(user_name):
    return [
        {
            'title': '하늘커머스 브랜드 리뉴얼 킥오프',
            'days_ago': 3,
            'duration': 2520,  # 42분
            'participants': f'{user_name}, 이지민, 정민아(하늘커머스)',
            'keywords': '브랜드 리뉴얼, 로고 시안, 컬러 시스템, 임원 보고',
            'key_points': (
                '· 1차 로고 시안 3종은 금요일 오전까지 PDF 로 공유\n'
                '· 컬러 시스템 제안서를 임원 보고(다음 주 화요일) 전까지 함께 준비\n'
                '· 기존 로고 원본(AI) 파일은 고객이 자료실에 업로드\n'
                '· 경쟁사 비교 자료 1장을 보고 자료에 포함'
            ),
            'summary': (
                '하늘커머스 브랜드 리뉴얼 킥오프 회의. 고객사는 다음 주 화요일 임원 보고를 앞두고 있어 '
                '금요일 오전까지 로고 시안 3종과 컬러 시스템 제안서를 함께 받기를 요청했다. '
                '라온랩스는 기존 로고 원본 파일 전달을 요청했고, 고객사가 자료실 업로드로 처리했다. '
                '보고 설득력을 높이기 위해 경쟁사 포지셔닝 비교 자료 한 장을 추가하기로 합의했다.'
            ),
            'utterances': [
                ('김서연', '오늘은 브랜드 리뉴얼 킥오프로 전체 일정과 산출물부터 정리하겠습니다.', 0, 0.0),
                ('정민아', '저희 임원 보고가 다음 주 화요일이라 그 전에 시안을 보고 싶은데 가능할까요?', 1, 14.5),
                ('김서연', '금요일 오전까지 로고 시안 3종을 PDF 로 정리해서 공유드리겠습니다.', 0, 27.0),
                ('이지민', '컬러 시스템 제안서도 같이 준비하겠습니다. 기존 로고 원본 파일만 주시면 됩니다.', 0, 41.2),
                ('정민아', '원본 파일은 오늘 중으로 자료실에 올려두겠습니다.', 0, 58.9),
                ('정민아', '경쟁사와 비교한 자료도 한 장 넣어주실 수 있나요?', 1, 72.4),
                ('김서연', '네, 포지셔닝 비교표를 보고 자료 마지막에 넣겠습니다.', 0, 85.0),
            ],
            'questions': [
                ('저희 임원 보고가 다음 주 화요일이라 그 전에 시안을 보고 싶은데 가능할까요?',
                 '금요일 오전까지 로고 시안 3종 PDF 전달 예정입니다. 임원 보고 일정(화요일) 전 검토 시간이 확보됩니다.'),
                ('경쟁사와 비교한 자료도 한 장 넣어주실 수 있나요?',
                 '경쟁사 3곳 포지셔닝 비교표를 제안서 마지막 장에 포함합니다. 담당은 김서연, 마감은 목요일입니다.'),
            ],
        },
        {
            'title': '라온랩스 주간 팀 미팅',
            'days_ago': 1,
            'duration': 1680,  # 28분
            'participants': f'{user_name}, 이지민, 박준호',
            'keywords': '주간 우선순위, 시안 진행, 성능 점검, 청구서',
            'key_points': (
                '· 이번 주 최우선은 하늘커머스 시안 금요일 납품\n'
                '· 로고 시안 3종 중 2종 완료, 나머지 1종은 금일 마감\n'
                '· 브릭스터디 랜딩 성능 점검 결과는 내일 오전 공유\n'
                '· 그린테이블 청구서 금일 발송'
            ),
            'summary': (
                '주간 팀 미팅. 이번 주 최우선 과제는 하늘커머스 로고 시안 금요일 납품으로 확인했다. '
                '디자인은 3종 중 2종을 마쳤고 남은 1종은 당일 마감 예정이다. '
                '개발은 브릭스터디 랜딩 성능 점검을 진행 중이며 결과는 다음 날 오전 공유하기로 했다. '
                '그린테이블 청구서는 당일 발송하기로 정리했다.'
            ),
            'utterances': [
                ('김서연', '이번 주 우선순위부터 맞추겠습니다. 하늘커머스 시안 금요일 납품이 최우선입니다.', 0, 0.0),
                ('이지민', '로고 시안은 3종 중 2종 끝났고 남은 하나는 오늘 마무리하겠습니다.', 0, 18.7),
                ('박준호', '브릭스터디 랜딩 성능 점검은 측정까지 끝났고 개선안 정리만 남았습니다.', 0, 36.1),
                ('김서연', '결과는 언제쯤 공유 가능할까요?', 1, 49.5),
                ('박준호', '내일 오전에 리포트로 정리해서 올리겠습니다.', 0, 55.8),
                ('김서연', '그린테이블 청구서는 오늘 발송하겠습니다.', 0, 68.2),
            ],
            'questions': [
                ('결과는 언제쯤 공유 가능할까요?',
                 '브릭스터디 랜딩 성능 점검 리포트는 다음 날 오전 공유 예정입니다. 담당은 박준호입니다.'),
            ],
        },
        {
            'title': '브릭스터디 랜딩 리뉴얼 요구사항 정리',
            'days_ago': 5,
            'duration': 2100,  # 35분
            'participants': f'{user_name}, 박준호',
            'keywords': '랜딩 리뉴얼, 페이지 구성, 견적, 성능',
            'key_points': (
                '· 랜딩 구성은 Hero / Feature / Pricing / FAQ / CTA 5개 섹션\n'
                '· 견적은 5개 페이지 기준으로 산정\n'
                '· 현재 랜딩 Lighthouse 성능 62점 — 목표 90점\n'
                '· 이미지 최적화를 1순위 개선 과제로 설정'
            ),
            'summary': (
                '브릭스터디 앱 랜딩 리뉴얼 요구사항 정리 회의. 랜딩은 Hero, Feature, Pricing, FAQ, CTA '
                '5개 섹션 구성으로 확정했고 견적도 5개 페이지 기준으로 산정하기로 했다. '
                '현재 랜딩의 Lighthouse 성능 점수는 62점으로, 목표는 90점이며 이미지 최적화를 최우선 '
                '개선 과제로 잡았다.'
            ),
            'utterances': [
                ('김서연', '랜딩 섹션 구성부터 확정하겠습니다. Hero, Feature, Pricing, FAQ, CTA 다섯 개로 보고 있습니다.', 0, 0.0),
                ('박준호', '다섯 개면 견적도 페이지 5종 기준으로 잡으면 되겠습니다.', 0, 21.3),
                ('김서연', '현재 랜딩 성능은 어느 정도인가요?', 1, 40.0),
                ('박준호', 'Lighthouse 기준 62점입니다. 목표는 90점으로 잡았고 이미지 최적화가 가장 큽니다.', 0, 47.6),
                ('김서연', '그럼 이미지 최적화를 1순위 개선 과제로 넣겠습니다.', 0, 63.4),
            ],
            'questions': [
                ('현재 랜딩 성능은 어느 정도인가요?',
                 'Lighthouse 성능 점수 62점입니다. 목표는 90점이며 LCP 4.1s, CLS 0.18 로 이미지 최적화가 최우선 개선 과제입니다.'),
            ],
        },
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--business-id', type=int, required=True)
    ap.add_argument('--user-id', type=int, required=True)
    ap.add_argument('--user-name', default='김서연')
    args = ap.parse_args()

    if not DB_PATH.startswith(ALLOWED_DB_PREFIX) or not os.path.exists(DB_PATH):
        print(f'❌ 중단: Q Note DB 경로가 올바르지 않습니다 ({DB_PATH})', file=sys.stderr)
        sys.exit(1)
    if args.user_id <= 0 or args.business_id <= 0:
        print('❌ 중단: business_id / user_id 가 올바르지 않습니다', file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 정리 — 데모 계정의 세션만 (다른 사용자 세션은 절대 건드리지 않는다)
    old = [r['id'] for r in cur.execute('SELECT id FROM sessions WHERE user_id = ?', (args.user_id,))]
    if old:
        marks = ','.join('?' * len(old))
        for table in ('utterances', 'detected_questions', 'speakers', 'summaries'):
            cur.execute(f'DELETE FROM {table} WHERE session_id IN ({marks})', old)
        cur.execute(f'DELETE FROM sessions WHERE id IN ({marks})', old)
    print(f'  정리: 세션 {len(old)}개')

    created = 0
    for s in build_sessions(args.user_name):
        created_at = ts(days_ago=s['days_ago'])
        cur.execute(
            """INSERT INTO sessions
               (business_id, user_id, title, language, duration_seconds, utterance_count, status,
                created_at, updated_at, participants, keywords, capture_mode, user_name,
                visibility, input_type, summarized_at, summary_key_points, summary_full, category)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (args.business_id, args.user_id, s['title'], 'ko', s['duration'], len(s['utterances']),
             'completed', created_at, created_at, s['participants'], s['keywords'], 'microphone',
             args.user_name, 'L1', 'voice', created_at, s['key_points'], s['summary'], '회의'),
        )
        sid = cur.lastrowid
        for idx, (speaker, text, is_q, start) in enumerate(s['utterances']):
            cur.execute(
                """INSERT INTO utterances
                   (session_id, speaker, original_text, original_language, is_question, is_final,
                    start_time, end_time, confidence, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (sid, speaker, text, 'ko', is_q, 1, start, start + 6.0, 0.96, created_at),
            )
        for q, a in s['questions']:
            cur.execute(
                """INSERT INTO detected_questions
                   (session_id, question_text, answer_text, answered_at, created_at, answer_tier)
                   VALUES (?,?,?,?,?,?)""",
                (sid, q, a, created_at, created_at, 'rag'),
            )
        cur.execute(
            'INSERT INTO summaries (session_id, key_points, full_summary, created_at) VALUES (?,?,?,?)',
            (sid, s['key_points'], s['summary'], created_at),
        )
        created += 1

    conn.commit()
    conn.close()
    print(f'  Q Note 세션 {created}개 생성')


if __name__ == '__main__':
    main()
