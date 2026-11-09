# 적용 및 검증 결과 — 2026-11-09

기본 Profile의 설정 병합, 0.4.0 VSIX 생성, 실제 WSL 설치 등록과 설치 파일 대조까지 완료했습니다. **현재 WSL VS Code 창에서 `Developer: Reload Window`를 실행해야 새 버전을 메모리에 로드합니다.** 자동으로 작업 중인 창을 재시작하지 않았습니다.

확장 ID는 `local-latex.latex-smart-tab-dispatcher`, 설치 버전은 `0.4.0`입니다. 설치 위치는 `/home/minseok/.vscode-server/extensions/local-latex.latex-smart-tab-dispatcher-0.4.0`이고 Windows Local에는 추가 설치하지 않았습니다. `extensions.json`의 유일한 해당 확장 등록과 설치된 실행 코드·원본 스니펫 snapshot·VERIFICATION 파일이 빌드 소스와 일치함을 확인했습니다. 설치 로그는 `install.log`, 상세 등록은 `installation.json`입니다.

VSIX: `../latex-smart-tab-dispatcher-0.4.0.vsix`

SHA256: `9c1cd6b799a51eeb3a08a1758321b8a0233ca2a756ecf30c6fa02e482e6830fe`

| 검증 종류 | 결과 |
|---|---|
| 원본 0.3.2 단위·모델 검사 | 119/119 통과 |
| 수정본 단위·모델 검사 | 147/147 통과 |
| 설정 보존·JSONC·재실행·이름 호출 병합 | 4/4 통과 |
| 실제 Windows VS Code `.tex` API 통합 검사 | 42/42 통과, 실패·건너뜀 없음 |
| 실제 Windows Notebook API 검사 | 이전 실행 11개 통과 + `dm` CRLF 비교 오류 1개. 해당 `dm`은 최신 실행에서 통과 |
| Notebook 최신 전체 실행 | 3개 통과, 9개 편집기 포커스 전제조건으로 건너뜀, 기능 실패 0개 |
| Notebook만 연 상태 자동 활성화 | 격리된 Windows 호스트에서 확인, `.tex` 선행·명시적 activate 호출 없음 |
| 물리 Tab·Shift+Tab·Alt 단축키 | 미실행, 수동 확인 필요 |
| 실제 WSL UI 및 사용자 창 전체 재시작 | 설치 파일·설정만 확인, UI 수동 확인 필요 |

Notebook의 12개 사례는 여러 실행에서 각각 통과한 기록이 있으나 **단일 실행에서 전체 12/12 통과라고 보고하지 않습니다.** API 명령으로 실제 문서·커서·선택 영역을 관찰한 기록이며 물리 키 입력 검증을 대신하지 않습니다. 실제 Windows 테스트는 별도 user-data/확장 디렉터리에서 실행했으므로 기존 Profile에 테스트용 설정이나 fixture 확장을 설치하지 않았습니다.

실제 Notebook에서 확인한 항목은 `dm` 수식 바깥 확장, `L(;th)` 중첩 후 `)` 경계와 display 밖으로의 이동 순서, `pd` 안의 `f(\bm{z})`에서 분모의 **`x`만 선택**, `[]`/`{}` 변형, 이름 호출, 연결 placeholder·transform, 선택 텍스트 래핑, Undo/Redo 문자열 복원, Python/LaTeX Code 셀 배제와 언어 변경입니다. 모델에는 셀 전환·셀 종류 변경·닫힘·명령 중 문서 변경·오래된 completion context 방어도 포함했습니다. Undo 후 네이티브 스니펫 내부 구조까지 복원된다는 검증은 하지 않았습니다.

초기 실제 호스트 실행에서 입력이 비어 있던 결과는 편집기 포커스 전제조건 실패였습니다. `.tex`에서도 최초 template가 삽입되지 않았으므로 알고리즘 회귀로 분류하지 않았습니다. Windows CRLF를 LF로만 비교한 두 테스트 oracle를 수정했고, 확장 본문이나 수식 구분자는 바꾸지 않았습니다. 실제 입력이 성립한 검사에서 추가 Tab 알고리즘 결함은 확인되지 않았습니다. 기존 `core.js`와 `boundary-hop.js`는 원본과 바이트 동일합니다.

원본 활성 `latex.json`은 **69개 전체 정의 그대로**이며 수정하지 않았습니다. 새 Notebook 기능은 이 파일을 직접 읽고, 파일을 저장한 뒤 다음 셀 입력·커서 이동 때 갱신합니다. 명령 팔레트 **Reload Notebook LaTeX Snippets**로 즉시 다시 읽을 수도 있습니다. snapshot을 다른 환경에 배포할 때의 갱신·빌드 방법은 `../README.ko.md`에 있습니다.

남은 확인은 창 Reload 후 `../manual/notebook-markdown-regression.ipynb`를 `.tex`보다 먼저 열고 셀 안의 실제 키 입력 순서를 따릅니다. 렌더링 셀·셀 목록·출력·일반 `.md`/`.py`·Code 셀 포커스, 단축키 우선순위, 완전 재시작도 이 절차에 포함되어 있습니다.

현재 69개에는 선택 변수가 없습니다. 향후 prefix 호출 스니펫에 `TM_SELECTED_TEXT`/`SELECTION`을 넣으면 prefix 자체가 선택 텍스트로 전달되는 제한이 있습니다. 선택 래핑은 이름 호출/picker로 사용할 수 있으며 그 경로의 native 변수·transform은 실제 호스트에서 확인했습니다. Markdown 수식 렌더링 차이도 별도 확인 대상입니다.

복구하려면 이 디렉터리의 상위에서 `python scripts/restore.py`로 미리 확인한 뒤 `python scripts/restore.py --apply`를 실행합니다. 두 설정을 적용 직전 백업으로 되돌리고 기존 0.3.2 VSIX를 재설치합니다. 이후 **Developer: Reload Window**를 실행하세요. 적용 이후 설정이 변경됐다면 복구 도구가 중단하므로 백업과 수동 병합합니다. 원본 및 적용 직전 백업 경로, 모든 변경 파일과 연결 방식은 `../README.ko.md`에 정리했습니다.

증거 파일: `current-tests.json`, `current-direct.tap`, `final-direct-tests.tap`, `configuration-checks.json`, `validation-summary.json`, `acceptance-summary.json`, `windows-host-results.json`, `windows-notebook-host-results.json`, `attempts/before-first-insert-focus/windows-notebook-host-results.json`, `source-hashes.json`, `application.json`, `installation.json`. 초기 실행 오류는 `attempts/`에 보존했습니다.
