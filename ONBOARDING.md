# Welcome to Innogrid 워크샵 앱 팀

## How We Use Claude

Based on seunguk.kang's usage over the last 30 days (35 sessions):

Work Type Breakdown:
  Improve Quality  ██████████████████░░  91%   (변경분 보안 리뷰·코드 리뷰 세션)
  Build Feature    ██░░░░░░░░░░░░░░░░░░   9%   (Teams 연동, 설문 시스템, INNOGRID 리브랜딩·GW 로그인)

Top Skills & Commands:
  /compact  ████████████████████  4x/month
  /mcp      ██████████░░░░░░░░░░  2x/month
  /effort   ██████████░░░░░░░░░░  2x/month

Top MCP Servers:
  claude-in-chrome         ████████████████████  33 calls
  playwright               ████████░░░░░░░░░░░░  14 calls
  supabase                 ███████░░░░░░░░░░░░░  12 calls
  chrome-devtools (plugin) ███████░░░░░░░░░░░░░  12 calls
  microsoft-learn (plugin) █████░░░░░░░░░░░░░░░   8 calls
  Vercel (claude.ai)       █░░░░░░░░░░░░░░░░░░░   2 calls
  supabase (plugin)        █░░░░░░░░░░░░░░░░░░░   1 call

## Your Setup Checklist

### Codebases
- [ ] inje-playground — https://github.com/abraxas73/inje-playground (Next.js 16 프론트 + FastAPI nlm-service 모노레포. 시작 전 `CLAUDE.md`와 `docs/teams-integration.md`를 읽을 것)

### MCP Servers to Activate
- [ ] claude-in-chrome — 로그인된 실제 Chrome을 그대로 조작해 배포 결과·관리자 화면을 확인할 때 사용. Chrome에 "Claude in Chrome" 확장을 설치하고, **Claude Code와 같은 claude.ai 계정**으로 확장에 로그인해야 연결된다(계정이 다르면 "not connected").
- [ ] playwright — 로그인 없이 되는 E2E·스크린샷 검증(예: `/manual` 페이지 캡처). `.mcp.json`/플러그인으로 활성화.
- [ ] supabase — DB 스키마·RLS·데이터 확인(`https://mcp.supabase.com`, project_ref는 리포 `.mcp.json`에 있음). `/mcp`에서 OAuth 인증. 인증이 깨지면 Supabase 대시보드 SQL Editor에서 직접 실행하는 것이 폴백.
- [ ] chrome-devtools (plugin) — DOM/네트워크/콘솔 디버깅용 별도 Chrome. 주의: 이 브라우저는 자동화로 표시되어 claude.ai 등 Cloudflare 보호 사이트는 사람 확인에 걸린다 — 그런 사이트는 claude-in-chrome을 쓸 것.
- [ ] microsoft-learn (plugin) — Microsoft Graph·Entra·Power Automate·Teams 공식 문서 조회. 별도 인증 불필요.
- [ ] Vercel (claude.ai connector) — 배포·로그 조회. 실제 배포는 CLI(`vercel --prod --scope seunguk-kangs-projects`)로 한다.

### Skills to Know About
- /compact — 긴 세션에서 컨텍스트를 요약해 이어가기. 큰 작업 단위가 끝난 뒤 실행.
- /mcp — MCP 서버 연결 상태 확인·재인증(Supabase OAuth, claude-in-chrome 재연결).
- /effort — 작업 난이도에 맞게 추론 강도를 조정.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
