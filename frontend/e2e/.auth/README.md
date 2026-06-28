# Survey E2E 인증

설문 응답 E2E는 로그인 user 세션이 필요하다.
1. 로컬 dev 서버에서 user 계정으로 로그인 후, 브라우저 쿠키를 Playwright storageState JSON으로 저장한다.
2. 저장 경로를 환경변수로 지정해 실행한다:

    SURVEY_E2E_STORAGE_STATE=/absolute/path/to/storage-state.json \
    SURVEY_E2E_SLUG=claude-code-productivity \
    npm run test:e2e -- survey-respond

storageState 미지정 시 인증이 필요한 스펙은 test.skip 처리된다.
