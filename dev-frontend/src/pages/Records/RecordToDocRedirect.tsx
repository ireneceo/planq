// /records/:id → /docs?post=:postId 리다이렉트.
// 기존 q_record id 로 연결된 post 를 찾아 그 post 상세로 이동.
import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';

const RecordToDocRedirect: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) { navigate('/docs', { replace: true }); return; }
    (async () => {
      try {
        // post 목록에서 q_record_id 매칭되는 것을 찾음 (간단)
        const r = await apiFetch(`/api/posts/by-record/${id}`);
        if (r.ok) {
          const j = await r.json();
          if (j?.data?.post_id) {
            navigate(`/docs?post=${j.data.post_id}`, { replace: true });
            return;
          }
        }
      } catch { /* skip */ }
      navigate('/docs', { replace: true });
    })();
  }, [id, navigate]);

  return null;
};

export default RecordToDocRedirect;
