import { describe, expect, it } from 'vitest';
import { emailLoginAllowed, generatePassword, isTestAccount, validateDisplayName, validateEmail, validatePassword, EMAIL_LOGIN_DENIED } from '@/lib/auth/test-account';

describe('이메일 로그인 거부 규칙', () => {
  it('이메일 공급자는 test_account === true만 허용', () => {
    expect(emailLoginAllowed({ app_metadata: { provider: 'email', test_account: true } })).toBe(true);
    expect(emailLoginAllowed({ app_metadata: { provider: 'email' } })).toBe(false);
    expect(emailLoginAllowed({ app_metadata: { provider: 'email', test_account: 'true' } })).toBe(false);
    expect(emailLoginAllowed({ app_metadata: { provider: 'email', test_account: false } })).toBe(false);
  });
  it('다른 공급자·세션 없음은 이 규칙과 무관', () => {
    expect(emailLoginAllowed({ app_metadata: { provider: 'azure' } })).toBe(true);
    expect(emailLoginAllowed({ app_metadata: {} })).toBe(true);
    expect(emailLoginAllowed(null)).toBe(true);
    expect(isTestAccount({ app_metadata: { provider: 'azure' } })).toBe(false);
  });
  it('거부 응답 계약', () => {
    expect(EMAIL_LOGIN_DENIED).toEqual({ error: '테스트 계정이 아닌 이메일 로그인은 허용되지 않습니다.', code: 'email_login_not_allowed' });
  });
});

describe('입력 검증', () => {
  it('이메일', () => {
    expect(validateEmail('review@innogrid.com')).toBeNull();
    expect(validateEmail('  ')).not.toBeNull();
    expect(validateEmail('no-at')).not.toBeNull();
    expect(validateEmail('a@b')).not.toBeNull();
    expect(validateEmail(`${'a'.repeat(250)}@b.co`)).not.toBeNull();
    expect(validateEmail(1)).not.toBeNull();
  });
  it('이름', () => {
    expect(validateDisplayName('Apple Review')).toBeNull();
    expect(validateDisplayName('')).not.toBeNull();
    expect(validateDisplayName('가'.repeat(101))).not.toBeNull();
  });
  it('비밀번호 12자 이상·72바이트 이하', () => {
    expect(validatePassword('a'.repeat(11))).not.toBeNull();
    expect(validatePassword('a'.repeat(12))).toBeNull();
    expect(validatePassword('a'.repeat(73))).not.toBeNull();
    expect(validatePassword('가'.repeat(25))).not.toBeNull(); // 75바이트
    expect(validatePassword(null)).not.toBeNull();
  });
});

describe('비밀번호 생성', () => {
  it('기본 20자, 네 문자군 모두 포함, 검증 통과, 매번 다름', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(20);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(p).not.toMatch(/[0O1lI]/);
      expect(validatePassword(p)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
    expect(generatePassword(32)).toHaveLength(32);
  });
});
