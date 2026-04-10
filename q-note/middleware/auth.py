import os
from fastapi import HTTPException, Depends, WebSocket, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

security = HTTPBearer()

JWT_SECRET = os.getenv('JWT_SECRET', '')
JWT_ALGORITHM = 'HS256'


def decode_token(token: str) -> dict:
  try:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    user_id = payload.get('userId') or payload.get('user_id')
    if not user_id:
      raise JWTError('Missing userId')
    return {
      'user_id': int(user_id),
      'email': payload.get('email'),
      'role': payload.get('role'),
      'business_id': payload.get('businessId') or payload.get('business_id'),
    }
  except JWTError as e:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail=f'Invalid token: {str(e)}'
    )


async def get_current_user(
  credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
  return decode_token(credentials.credentials)


async def ws_authenticate(websocket: WebSocket) -> dict:
  token = websocket.query_params.get('token')
  if not token:
    # Check subprotocol header
    for proto in (websocket.headers.get('sec-websocket-protocol') or '').split(','):
      proto = proto.strip()
      if proto and proto != 'websocket':
        token = proto
        break

  if not token:
    await websocket.close(code=4001, reason='Missing token')
    raise HTTPException(status_code=401, detail='Missing token')

  try:
    return decode_token(token)
  except HTTPException:
    await websocket.close(code=4001, reason='Invalid token')
    raise
