"""
안전한 URL fetcher.

- HTTPS 강제
- hop 별 DNS 재해석 → private/loopback/link-local/reserved/multicast 차단
  (DNS rebinding 공격 대응: 리다이렉트를 follow_redirects=True 에 맡기지 않고 수동 추적)
- 스트리밍 다운로드 + 10MB 캡 (Content-Length 선검사 + 실시간 누적 검사)
- connect 5s / read 15s 타임아웃
- 최대 리다이렉트 3회
- Content-Type 화이트리스트 (HTML / XHTML / PDF / DOCX / TXT / Markdown)
"""
import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse, urljoin

import httpx


MAX_SIZE = 10 * 1024 * 1024        # 10MB
MAX_REDIRECTS = 3
CONNECT_TIMEOUT = 5.0
READ_TIMEOUT = 15.0
USER_AGENT = 'PlanQ-QNote/1.0 (+https://planq.kr)'

ALLOWED_CONTENT_TYPES = {
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
}


class FetchError(Exception):
  """URL fetch 실패. message 는 사용자 노출 가능한 간결한 사유."""


@dataclass
class FetchResult:
  final_url: str
  content_type: str
  body: bytes
  status_code: int


def _assert_public_host(hostname: Optional[str]) -> None:
  """hostname 을 해석해서 모든 IP 가 public 인지 확인. 하나라도 private 이면 차단."""
  if not hostname:
    raise FetchError('URL에 호스트명이 없습니다')
  try:
    addr_infos = socket.getaddrinfo(hostname, None)
  except socket.gaierror:
    raise FetchError('호스트명을 해석할 수 없습니다')
  if not addr_infos:
    raise FetchError('호스트명을 해석할 수 없습니다')
  for info in addr_infos:
    ip_str = info[4][0]
    try:
      ip = ipaddress.ip_address(ip_str)
    except ValueError:
      continue
    if (
      ip.is_private
      or ip.is_loopback
      or ip.is_link_local
      or ip.is_reserved
      or ip.is_multicast
      or ip.is_unspecified
    ):
      raise FetchError('내부 IP로 해석되는 URL은 차단됩니다')


def _assert_https(url: str) -> None:
  parsed = urlparse(url)
  if parsed.scheme != 'https':
    raise FetchError('HTTPS URL만 허용됩니다')
  _assert_public_host(parsed.hostname)


def _parse_content_type(header: str) -> str:
  if not header:
    return ''
  return header.split(';', 1)[0].strip().lower()


async def fetch_url(url: str) -> FetchResult:
  """
  안전한 HTTP GET. 성공 시 FetchResult, 실패 시 FetchError.

  리다이렉트는 수동으로 추적하며 매 hop 마다 HTTPS + public IP 를 재검증합니다.
  """
  _assert_https(url)

  timeout = httpx.Timeout(connect=CONNECT_TIMEOUT, read=READ_TIMEOUT, write=READ_TIMEOUT, pool=CONNECT_TIMEOUT)
  headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
    'Accept-Language': 'ko,en;q=0.8',
  }

  current = url
  async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, headers=headers) as client:
    for hop in range(MAX_REDIRECTS + 1):
      try:
        async with client.stream('GET', current) as resp:
          # 리다이렉트 처리
          if 300 <= resp.status_code < 400:
            location = resp.headers.get('location')
            if not location:
              raise FetchError(f'리다이렉트 응답({resp.status_code})에 Location 헤더가 없습니다')
            if hop >= MAX_REDIRECTS:
              raise FetchError('리다이렉트가 너무 많습니다')
            next_url = urljoin(current, location)
            _assert_https(next_url)  # hop 마다 재검증 (DNS rebinding 방어)
            current = next_url
            continue

          if resp.status_code >= 400:
            raise FetchError(f'HTTP {resp.status_code}')

          content_type = _parse_content_type(resp.headers.get('content-type', ''))
          if content_type not in ALLOWED_CONTENT_TYPES:
            raise FetchError(f'지원하지 않는 Content-Type: {content_type or "unknown"}')

          # Content-Length 선검사
          cl = resp.headers.get('content-length')
          if cl and cl.isdigit() and int(cl) > MAX_SIZE:
            raise FetchError(f'파일이 너무 큽니다 ({int(cl) // (1024*1024)}MB > {MAX_SIZE // (1024*1024)}MB)')

          # 스트리밍 다운로드 + 누적 크기 검사
          chunks = []
          total = 0
          async for chunk in resp.aiter_bytes():
            total += len(chunk)
            if total > MAX_SIZE:
              raise FetchError(f'파일이 너무 큽니다 (>{MAX_SIZE // (1024*1024)}MB)')
            chunks.append(chunk)

          return FetchResult(
            final_url=str(resp.url),
            content_type=content_type,
            body=b''.join(chunks),
            status_code=resp.status_code,
          )
      except httpx.TimeoutException:
        raise FetchError('요청 시간 초과')
      except httpx.RequestError as e:
        raise FetchError(f'네트워크 오류: {type(e).__name__}')

  raise FetchError('리다이렉트가 너무 많습니다')
