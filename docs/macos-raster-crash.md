# macOS 렌더러 충돌 우회 (2026-10-12)

## 확인한 내용

- INNOGRID 1.6.5(41), macOS 27.0.1 ARM64, 약 12시간 실행 후 백그라운드에서 `io.flutter.raster`의 null 접근으로 종료.
- Flutter 3.47.7, engine `deb287481e3ce9468f3434937ced4240a70539ca`.
- 설치된 엔진과 SDK release dSYM의 ARM64 UUID가 모두 `4C4C442C-5555-3144-A1DE-DBEB934EB311`로 일치.
- 심볼 해석: `Canvas::SetupRenderPass (canvas.cc:1615)` → `Canvas::Canvas` → `RenderToTarget` → `EmbedderExternalViewEmbedder::SubmitFlutterView` → `Rasterizer::DrawToSurfaceUnsafe`.
- [Flutter #192522](https://github.com/flutter/flutter/pull/192522)의 잘못된 크기 backing-store texture로 인한 Impeller null 접근과 호출 경로가 일치한다. 이번 실행에서 버퍼 크기 불일치가 실제 발생했는지는 로그에 없어 확정하지 않는다. Dooray API 오류나 메모리 부족으로 단정할 근거도 없다.

## 적용 범위

`mobile/macos/Runner/Info.plist`의 `FLTEnableImpeller=false`로 macOS만 Skia Metal을 사용한다. SDK의 `FlutterDartProject.mm`과 `FlutterEngine.mm`에서 해당 옵션 지원을 확인했다. WebView·로그인·데이터 수집과 다른 플랫폼의 렌더러는 변경하지 않는다.

`RunnerTests`는 빌드된 앱 번들의 옵션을 확인한다. 엔진 수정이 포함된 SDK로 교체한 뒤 창 크기 변경·전체 화면 전환·숨김/복귀·모니터 변경·장시간 잠자기 복귀를 검증하고 이 옵션과 해당 테스트를 제거한다. 이 우회는 모든 종류의 macOS 충돌을 해결한다는 의미가 아니며 렌더링 성능·색 표현이 달라질 수 있다.

## 재검증

```sh
xcodebuild test -workspace macos/Runner.xcworkspace -scheme Runner \
  -configuration Debug -destination 'platform=macOS' -only-testing:RunnerTests
```

`mobile/`에서 실행한다. release 빌드의 `Contents/Info.plist`에서도 옵션을 확인하고 실행 로그에서 `Using the Skia rendering backend (Metal).`을 확인한다. 장시간 재발 여부는 별도 관찰이 필요하다.
