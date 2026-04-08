import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styled from 'styled-components';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: string[];
}

const LoadingContainer = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F8FAFC;
`;

const LoadingSpinner = styled.div`
  width: 40px;
  height: 40px;
  border: 4px solid #E2E8F0;
  border-top: 4px solid #14B8A6;
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const AccessDeniedContainer = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F8FAFC;
`;

const AccessDeniedBox = styled.div`
  background: white;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
`;

const Title = styled.h2`
  font-size: 24px;
  color: #0F172A;
  margin-bottom: 12px;
`;

const Message = styled.p`
  color: #475569;
  margin-bottom: 24px;
`;

const BackButton = styled.button`
  padding: 10px 20px;
  background: #14B8A6;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #0D9488;
  }
`;

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { isAuthenticated, isLoading, hasRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <LoadingContainer>
        <LoadingSpinner />
      </LoadingContainer>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && !hasRole(...requiredRole)) {
    return (
      <AccessDeniedContainer>
        <AccessDeniedBox>
          <Title>접근 권한 없음</Title>
          <Message>이 페이지에 접근할 권한이 없습니다.</Message>
          <BackButton onClick={() => window.history.back()}>뒤로 가기</BackButton>
        </AccessDeniedBox>
      </AccessDeniedContainer>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
