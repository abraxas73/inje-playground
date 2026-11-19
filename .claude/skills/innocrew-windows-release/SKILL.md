---
name: innocrew-windows-release
description: 이노크루 Windows 데스크톱 앱을 (주) 이노그리드 코드 서명(Azure Artifact Signing)으로 빌드·게시한다 — 운영자 Mac az 토큰을 GitHub 비밀값에 잠깐 넣고 "Windows app" sign=true, 끝나면 비밀값 삭제, 검증 후 desktop-releases 게시. "빌드/릴리즈"·"Windows 배포"·"서명 배포" 등 Windows 설치 파일을 게시하는 모든 경우에 사용. 서명 없는 Windows 설치 파일은 게시하지 않는다.
---

# 이노크루 Windows 서명 릴리스

런북: `docs/windows-signing.md` (서명 정보·CI 단계·함정·이력). 이 스킬은 실행 순서만.

## 언제

릴리스에서 Windows를 낼 때는 **항상** 이 절차. 예전 방식(`gh workflow run "Windows app"` 기본값 → 서명 없는 산출물 게시)은 쓰지 않는다 — 스마트 앱 컨트롤이 켜진 PC에서 설치(Error 4551)·실행(잘못된 이미지)이 막힌다.

## 순서

1. **버전**: `mobile/pubspec.yaml`을 올려 커밋·push(main). iOS·Android 릴리스(`release-mobile.sh`)가 돌고 있으면 끝난 뒤에 올린다. 같은 버전은 재게시 불가.
2. **로그인 확인**: `az account show`. 안 되면 사용자에게 `! az login`(회사 계정 seunguk.kang, 구독 "이노그리드")을 부탁한다.
3. **실행**(백그라운드, 약 20~40분 — 토큰 대기 포함):
   ```bash
   mobile/scripts/release-windows-signed.sh > "$SCRATCH/winNNN.log" 2>&1; echo "exit $?"
   ```
   스크립트가 토큰 남은 시간 확인·대기 → 비밀값 설정 → 서명 빌드 → **비밀값 삭제(실패해도)** → ISCC SignTool 로그·sha256·osslsigncode 검증 → 게시 → settings 확인까지 한다.
4. **확인·보고**: 로그 끝의 `게시 확인: [{"v":"<ver>","s":"<sha>"}]`, `gh secret list`에 `AZURE_SIGNING_TOKEN`이 없는지. 보고에 버전·sha256 앞 8자·"(주) 이노그리드 서명·검증 ok"를 넣는다.

## 실패하면

- `gh run view <run> --log-failed`(토큰 줄은 출력하지 말 것 — `grep -v -i storepass`)로 원인을 보고, 고친 뒤 다시. 실패한 빌드는 게시되지 않고 비밀값은 지워진다.
- 토큰 만료로 서명 단계가 401이면 그냥 다시 실행(스크립트가 새 토큰을 기다림).
- 디스크가 꽉 차면(맥) 로컬 Flutter가 멈춘다 — `df -h`로 확인, 지워도 되는 것은 메모리 no-delete-paths 참고.

## 하지 말 것

- 다 만든 설치 파일의 바깥 exe에만 jsign으로 나중에 서명해서 게시(Error 4551 재발).
- 토큰·`az` 출력·`.env.local` 값 출력, 비밀값을 남겨 두기.
- 사용자 지시 없이 경로 A(관리자 OIDC)로 전환하거나 Azure 리소스·역할 변경.
