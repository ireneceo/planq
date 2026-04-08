import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';

const Container = styled.div`
  min-height: 100vh;
  background: linear-gradient(180deg, #F8FAFC 0%, #E2E8F0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
`;

const RegisterBox = styled.div`
  background: white;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 900px;
  display: flex;
  overflow: hidden;

  @media (max-width: 768px) {
    flex-direction: column;
    max-width: 440px;
  }
`;

const LeftSection = styled.div`
  flex: 1;
  background: linear-gradient(180deg, #0D9488 0%, #134E4A 100%);
  padding: 60px 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;

  @media (max-width: 768px) {
    padding: 40px 30px;
  }
`;

const BrandLogo = styled.div`
  font-size: 40px;
  font-weight: 800;
  color: #FFFFFF;
  letter-spacing: -1px;
  margin-bottom: 16px;

  span {
    color: #5EEAD4;
  }
`;

const BrandTagline = styled.p`
  color: #CCFBF1;
  font-size: 16px;
  line-height: 1.6;
  margin: 0;
  max-width: 280px;
`;

const FeatureList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 32px 0 0 0;
  text-align: left;
`;

const FeatureItem = styled.li`
  color: #CCFBF1;
  font-size: 14px;
  padding: 8px 0;
  display: flex;
  align-items: center;
  gap: 10px;

  svg {
    color: #5EEAD4;
    flex-shrink: 0;
  }
`;

const RightSection = styled.div`
  flex: 1;
  padding: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;

  @media (max-width: 768px) {
    padding: 40px 30px;
  }
`;

const FormTitle = styled.h2`
  font-size: 24px;
  font-weight: 700;
  color: #0F172A;
  margin: 0 0 8px 0;
`;

const FormSubtitle = styled.p`
  font-size: 14px;
  color: #475569;
  margin: 0 0 28px 0;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const Input = styled.input<{ $hasError?: boolean }>`
  padding: 12px 16px;
  border: 1px solid ${props => props.$hasError ? '#DC2626' : '#E2E8F0'};
  border-radius: 50px;
  font-size: 15px;
  transition: all 0.2s;
  width: 100%;
  box-sizing: border-box;
  background: ${props => props.$hasError ? '#FEF2F2' : '#F8FAFC'};
  color: #0F172A;

  &::placeholder {
    color: #94A3B8;
  }

  &:hover {
    border-color: ${props => props.$hasError ? '#DC2626' : '#CBD5E1'};
  }

  &:focus {
    outline: none;
    border-color: ${props => props.$hasError ? '#DC2626' : '#14B8A6'};
    box-shadow: 0 0 0 3px ${props => props.$hasError ? 'rgba(220, 38, 38, 0.1)' : 'rgba(20, 184, 166, 0.1)'};
    background: #FFFFFF;
  }
`;

const PasswordWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const PasswordToggle = styled.button`
  position: absolute;
  right: 14px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  transition: color 0.2s;

  &:hover { color: #475569; }
  svg { width: 20px; height: 20px; }
`;

const FieldError = styled.div`
  font-size: 12px;
  color: #DC2626;
  margin-top: 2px;
`;

const Button = styled.button`
  padding: 14px 24px;
  background: #0D9488;
  color: white;
  border: none;
  border-radius: 50px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 4px;

  &:hover {
    background: #0F766E;
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(13, 148, 136, 0.3);
  }

  &:active {
    transform: translateY(0);
    background: #115E59;
  }

  &:disabled {
    background: #99F6E4;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
`;

const ErrorMessage = styled.div`
  background: #FEF2F2;
  color: #DC2626;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  border: 1px solid #FEE2E2;
`;

const Divider = styled.div`
  width: 100%;
  height: 1px;
  background: #E2E8F0;
  margin: 20px 0;
`;

const BottomLinks = styled.div`
  text-align: center;
  font-size: 14px;
  color: #475569;

  a {
    color: #0D9488;
    text-decoration: none;
    font-weight: 500;
    &:hover { text-decoration: underline; color: #0F766E; }
  }
`;

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { register, isAuthenticated, isLoading: authLoading } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!name.trim()) errors.name = '이름을 입력하세요';
    if (!email.trim()) {
      errors.email = '이메일을 입력하세요';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = '올바른 이메일 형식이 아닙니다';
    }
    if (!password) {
      errors.password = '비밀번호를 입력하세요';
    } else if (password.length < 8) {
      errors.password = '8자 이상 입력하세요';
    } else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      errors.password = '영문과 숫자를 모두 포함해야 합니다';
    }
    if (!businessName.trim()) errors.businessName = '사업자명을 입력하세요';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    setIsLoading(true);
    try {
      const success = await register(name.trim(), email.trim(), password, businessName.trim());
      if (!success) {
        setError('Registration failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container>
      <RegisterBox>
        <LeftSection>
          <BrandLogo>Plan<span>Q</span></BrandLogo>
          <BrandTagline>
            업무 전용 고객 채팅 + 실행 구조 통합 OS
          </BrandTagline>
          <FeatureList>
            <FeatureItem><CheckIcon /> Q Talk — 고객과 실시간 대화</FeatureItem>
            <FeatureItem><CheckIcon /> Q Task — 대화에서 바로 할일 생성</FeatureItem>
            <FeatureItem><CheckIcon /> Q Note — 음성 회의록 AI 정리</FeatureItem>
            <FeatureItem><CheckIcon /> Q File — 고객별 자료 관리</FeatureItem>
            <FeatureItem><CheckIcon /> Q Bill — 간편 청구서 발송</FeatureItem>
          </FeatureList>
        </LeftSection>

        <RightSection>
          <FormTitle>회원가입</FormTitle>
          <FormSubtitle>무료로 시작하세요. 신용카드 불필요.</FormSubtitle>

          <Form onSubmit={handleSubmit}>
            <InputGroup>
              <Input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setFieldErrors(prev => ({ ...prev, name: '' })); }}
                placeholder="이름"
                $hasError={!!fieldErrors.name}
                autoComplete="name"
              />
              {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
            </InputGroup>

            <InputGroup>
              <Input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: '' })); }}
                placeholder="이메일"
                $hasError={!!fieldErrors.email}
                autoComplete="email"
              />
              {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
            </InputGroup>

            <InputGroup>
              <PasswordWrapper>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: '' })); }}
                  placeholder="비밀번호 (영문+숫자 8자 이상)"
                  $hasError={!!fieldErrors.password}
                  autoComplete="new-password"
                />
                <PasswordToggle type="button" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </PasswordToggle>
              </PasswordWrapper>
              {fieldErrors.password && <FieldError>{fieldErrors.password}</FieldError>}
            </InputGroup>

            <InputGroup>
              <Input
                type="text"
                value={businessName}
                onChange={(e) => { setBusinessName(e.target.value); setFieldErrors(prev => ({ ...prev, businessName: '' })); }}
                placeholder="사업자명"
                $hasError={!!fieldErrors.businessName}
                autoComplete="organization"
              />
              {fieldErrors.businessName && <FieldError>{fieldErrors.businessName}</FieldError>}
            </InputGroup>

            {error && <ErrorMessage>{error}</ErrorMessage>}

            <Button type="submit" disabled={isLoading}>
              {isLoading ? '가입 중...' : '무료로 시작하기'}
            </Button>
          </Form>

          <Divider />

          <BottomLinks>
            이미 계정이 있으신가요? <Link to="/login">로그인</Link>
          </BottomLinks>
        </RightSection>
      </RegisterBox>
    </Container>
  );
};

export default RegisterPage;
