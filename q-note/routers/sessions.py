import aiosqlite
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from middleware.auth import get_current_user
from services.database import DB_PATH

router = APIRouter(prefix='/api/sessions', tags=['sessions'])


class CreateSessionRequest(BaseModel):
  business_id: int
  title: Optional[str] = 'Untitled Session'
  language: Optional[str] = 'multi'


class UpdateSessionRequest(BaseModel):
  title: Optional[str] = None
  status: Optional[str] = None


def success(data=None, **kwargs):
  res = {'success': True}
  if data is not None:
    res['data'] = data
  res.update(kwargs)
  return res


@router.post('')
async def create_session(body: CreateSessionRequest, user: dict = Depends(get_current_user)):
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''INSERT INTO sessions (business_id, user_id, title, language)
         VALUES (?, ?, ?, ?)''',
      (body.business_id, user['user_id'], body.title, body.language)
    )
    await db.commit()
    session_id = cursor.lastrowid
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    return success(dict(row))


@router.get('')
async def list_sessions(
  business_id: int = Query(...),
  page: int = Query(1, ge=1),
  limit: int = Query(20, ge=1, le=100),
  user: dict = Depends(get_current_user)
):
  offset = (page - 1) * limit
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''SELECT * FROM sessions
         WHERE business_id = ? AND user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?''',
      (business_id, user['user_id'], limit, offset)
    )
    rows = await cursor.fetchall()
    cursor = await db.execute(
      'SELECT COUNT(*) as cnt FROM sessions WHERE business_id = ? AND user_id = ?',
      (business_id, user['user_id'])
    )
    total = (await cursor.fetchone())['cnt']
    return success(
      [dict(r) for r in rows],
      pagination={'page': page, 'limit': limit, 'total': total}
    )


@router.get('/{session_id}')
async def get_session(session_id: int, user: dict = Depends(get_current_user)):
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Session not found')
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='Forbidden')

    cursor = await db.execute(
      'SELECT * FROM utterances WHERE session_id = ? ORDER BY id ASC',
      (session_id,)
    )
    utterances = [dict(r) for r in await cursor.fetchall()]

    data = dict(row)
    data['utterances'] = utterances
    return success(data)


@router.put('/{session_id}')
async def update_session(
  session_id: int,
  body: UpdateSessionRequest,
  user: dict = Depends(get_current_user)
):
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT user_id FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Session not found')
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='Forbidden')

    fields = []
    values = []
    if body.title is not None:
      fields.append('title = ?')
      values.append(body.title)
    if body.status is not None:
      fields.append('status = ?')
      values.append(body.status)

    if fields:
      fields.append("updated_at = datetime('now')")
      values.append(session_id)
      await db.execute(
        f'UPDATE sessions SET {", ".join(fields)} WHERE id = ?',
        values
      )
      await db.commit()

    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    return success(dict(await cursor.fetchone()))


@router.delete('/{session_id}')
async def delete_session(session_id: int, user: dict = Depends(get_current_user)):
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT user_id FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Session not found')
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='Forbidden')

    await db.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
    await db.commit()
    return success({'id': session_id})
