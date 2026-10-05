import sys, asyncio, soundfile as sf
sys.path.insert(0, '/opt/planq/q-note')
from services.voice_fingerprint import embed_pcm16, embedding_to_blob
from services.database import connect
from services.voice_profile import VOICE_CONSENT_VERSION
F = '/opt/planq/scripts/e2e/fixtures/voice/'
async def main():
  cmd = sys.argv[1]
  async with connect() as db:
    if cmd == 'set':
      uid, wav = int(sys.argv[2]), sys.argv[3]
      y, sr = sf.read(F + wav, dtype='int16')
      emb = await embed_pcm16(y.tobytes())
      await db.execute('''INSERT INTO voice_fingerprints (user_id, language, embedding, sample_seconds, consent_version, consent_at, last_matched_at)
        VALUES (?, 'en', ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, language) DO UPDATE SET embedding=excluded.embedding, consent_version=excluded.consent_version, match_enabled=1, last_matched_at=datetime('now'), expiry_notified_at=NULL''',
        (uid, embedding_to_blob(emb), len(y)/sr, VOICE_CONSENT_VERSION))
    elif cmd == 'del':
      await db.execute('DELETE FROM voice_fingerprints WHERE user_id = ?', (int(sys.argv[2]),))
    elif cmd == 'sql':
      cur = await db.execute(sys.argv[2], tuple(sys.argv[3:]))
      rows = await cur.fetchall()
      print([tuple(r) for r in rows])
    await db.commit()
asyncio.run(main())
