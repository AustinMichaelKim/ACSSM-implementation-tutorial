# Jupyter Markdown LaTeX 스니펫 적용 기록

2026-11-09, Windows + WSL `Ubuntu-24.04`, VS Code 1.145.2 기준입니다. 이 디렉터리에 수정 소스, VSIX, 원본 백업, 설정 병합 도구와 검증 자료를 모았습니다. 최종 실행 결과는 `verification/RESULTS.ko.md`와 `extension/VERIFICATION.json`에 기록합니다.

## 기준 파일과 Profile 확인

| 구분 | 확인한 경로 / 값 |
|---|---|
| 현재 Profile | `__default__profile__` |
| 활성 `latex.json` | `/mnt/c/Users/p1072/AppData/Roaming/Code/User/snippets/latex.json` |
| 활성 `keybindings.json` | `/mnt/c/Users/p1072/AppData/Roaming/Code/User/keybindings.json` |
| Windows 사용자 설정 | `/mnt/c/Users/p1072/AppData/Roaming/Code/User/settings.json` |
| WSL Remote 설정 | `/home/minseok/.vscode-server/data/Machine/settings.json` |
| 프로젝트 설정 | `/home/minseok/paper_implementation/ACSSM_implementation/.vscode/settings.json` |
| 기준 확장 | `local-latex.latex-smart-tab-dispatcher@0.3.2` |
| 기준 설치 위치 | `/home/minseok/.vscode-server/extensions/local-latex.latex-smart-tab-dispatcher-0.3.2` |
| 기준 VSIX | `/home/minseok/math_note/latex-smart-tab-dispatcher-0.3.2.vsix` |
| 새 VSIX | `latex-smart-tab-dispatcher-0.4.0.vsix` |

현재 프로젝트 URI의 `globalStorage/storage.json` Profile 연결, 마지막 활성 창의 `remoteAuthority=wsl+Ubuntu-24.04`, WSL `extensions.json` 설치 등록을 함께 확인했습니다. 기본 경로에 있다는 이유만으로 선택하지 않았습니다. 별도 Profile 사용자 스니펫은 없으며, Agents 기본 Profile도 settings/keybindings/snippets/extensions를 기본 Profile에서 공유하도록 되어 있습니다. Windows Local에는 이 사용자 확장이 설치되어 있지 않습니다.

Windows/WSL 버전과 commit은 모두 `1.145.2`, `c4453f8ea430795f941c1b2ff6c9321135a74a02`입니다. `latex.json` 주석의 `0.2.6`은 실제 확장 버전과 달랐습니다. Downloads 사본의 스니펫은 51개여서 사용하지 않았습니다. 실제 원본의 69개 정의와 모든 prefix/body/description을 보존했습니다.

참고 저장소 `AustinMichaelKim/Vscode-Latex-Snippet-tutorial`의 확인한 main commit은 `02de4c8c30caafa8113595dfb535d073d395ee7d`입니다. 저장소에는 사용자 설정이나 수정 가능한 확장 프로젝트가 없고 0.3.1 VSIX가 있습니다. 설치된 0.3.2 VSIX에는 `extension.js`, `core.js`, `boundary-hop.js`, 테스트와 오프라인 패키징 스크립트가 포함되어 있어 이 JavaScript를 기준으로 수정했습니다. TypeScript 소스를 새로 가정하지 않았습니다. 자세한 차이와 해시는 `verification/environment.json`에 있습니다.

## 연결 방식과 수정 이유

- `extension/notebook-support.js`: `workspace.notebookDocuments`의 실제 셀 document URI를 대조합니다. Jupyter + `NotebookCellKind.Markup` + `languageId=markdown`만 허용합니다. Code 셀은 언어가 LaTeX여도 제외합니다.
- `extension/extension.js`: 기존 Tab, 내부 괄호 탈출, 연속 인수 이동 알고리즘을 재사용합니다. placeholder와 삽입 중 상태를 URI별로 분리하고 닫힘·셀 제거·언어 변경 때 정리합니다. 비동기 명령 도중 같은 문서/선택이 바뀌면 오래된 prefix 범위에 삽입하지 않습니다.
- `extension/package.json`: 같은 확장 ID로 0.4.0을 만들고 Notebook/Markdown 활성화 및 Notebook 전용 기본 Tab/Space/진단 바인딩을 추가했습니다. Notebook만 먼저 열어도 활성화할 수 있습니다.
- 실제 `keybindings.json`: 원래 17개 항목의 명령·인수·순서를 보존했습니다. LaTeX `when` 11곳에 Notebook 편집기 제외 조건을 추가하고 Notebook용 바인딩 9개를 추가했습니다. Alt 4개, Tab 일반/스니펫 이동, prefix 확장 두 상태, Space입니다. prefix 확장을 `inSnippetMode` 두 경우로 나눈 것은 오래된 completion context에서도 원래 이동 경로로 되돌아가기 위해서입니다.
- 실제 WSL 설정: `latexSmartTab.notebookSnippetSource` 한 항목만 추가했습니다. Windows settings, 프로젝트 settings와 원본 `latex.json`은 수정하지 않았습니다.

Notebook `when` 조건은 다음을 기존 포커스·읽기 전용·다중 선택·Tab 포커스 이동·snippet 조건과 **괄호로 묶어 결합**합니다.

```text
notebookType == jupyter-notebook && notebookCellType == markup
&& editorLangId == markdown && notebookCellEditorFocused
```

실제 1.145.2 workbench 코드에서 이 context key와 Markup 편집기 포커스의 의미를 확인했습니다. 일반 `.md`, `.py`, Notebook Code, 렌더링 셀, 셀 목록과 출력 포커스에는 이 조건이 성립하지 않습니다. 언어 연결이나 셀 언어를 바꾸지 않았습니다.

현재 버전의 사용자 snippets에는 `include/exclude` 파일 glob이 있지만 셀 종류·Notebook 종류·편집 포커스를 지정할 수 없어 요구 범위를 충분히 보장하지 못합니다. 따라서 원본 JSONC를 읽는 Notebook 전용 공급 기능을 사용합니다. Completion selector는 공식 [DocumentFilter API](https://code.visualstudio.com/api/references/vscode-api#DocumentFilter)의 `{ language: 'markdown', notebookType: 'jupyter-notebook' }`이며 `scheme/pattern`을 결합하지 않습니다. `markdown.json`이나 Markdown 전역 scope를 만들지 않았습니다.

스니펫 prefix 확장 → 기존 네이티브 `editor.action.insertSnippet` → 기존 tracking/Tab 알고리즘으로 연결됩니다. `TextEditor.insertSnippet`은 현재 구현에서 기존 세션을 취소하므로 사용하지 않습니다. `;th`, 중첩 `dm`, 연결 placeholder, `$0`, 기본값, 직접 선택 래핑·transform은 네이티브 엔진을 통해 처리합니다. `dm`은 수식 바깥에서도 호출할 수 있습니다.

현재 `[latex]`의 `snippetSuggestions:none`도 Notebook 공급 기능에서 따릅니다. 일반 IntelliSense의 Enter 수락은 해당 편집기 설정을 유지합니다. 기존 prefix 우선 → 내부 닫는 토큰 → 다음 placeholder → 일반 Tab 경로를 공유하며, Shift+Tab·Undo/Redo를 새 알고리즘으로 대체하지 않습니다.

`ctrl+b`의 `latex-workshop.build` 두 항목과 전체 TeX 문서를 만드는 `ctrl+d ctrl+s`는 Notebook에서 같은 의미가 없어 TeX 전용으로 유지했습니다. 기존 중복 build 바인딩도 임의로 삭제하지 않았습니다.

## 원본 갱신과 다시 빌드

현재 WSL 설정은 실제 Windows Profile `latex.json`을 직접 가리킵니다. 이 파일을 저장하면 다음 셀 입력·커서 변경·prefix 확인 때 변경 내용을 읽습니다. 확실히 새로 읽으려면 명령 팔레트에서 **LaTeX Smart Tab: Reload Notebook LaTeX Snippets**를 실행합니다. 보통 새 VSIX가 필요하지 않습니다. 잘못된 명시적 경로는 오류를 표시하며 오래된 snapshot으로 조용히 대체하지 않습니다.

이름 호출은 `latexSmartTab.insertSnippetTemplate` 또는 `latexSmartTab.insertNotebookSnippet`에 `{"name":"Bold vector","langId":"latex"}`를 전달합니다. 명령 팔레트의 **Insert LaTeX Snippet in Notebook Markdown**는 선택한 텍스트가 있는 상태에서도 사용할 수 있습니다.

다른 컴퓨터에 배포할 snapshot을 갱신하려면 이 디렉터리에서 실행합니다.

```bash
python scripts/sync-snippets.py --source '/mnt/c/Users/p1072/AppData/Roaming/Code/User/snippets/latex.json'
python extension/scripts/package.py --output "$PWD/latex-smart-tab-dispatcher-0.4.0.vsix"
```

snapshot은 원본 69개 정의를 주석·수식 구분자까지 바이트 그대로 복사합니다. `\[...\]`를 `$$...$$`로 바꾸지 않았습니다. Markdown/MathJax의 명령·패키지·구분자 렌더링 차이는 편집/Tab 기능과 별도로 확인해야 합니다.

현재 원본에는 변수/transform/선택 변수가 없습니다. 직접 삽입하는 래핑과 transform은 네이티브로 처리하지만, **향후 prefix 스니펫에 `TM_SELECTED_TEXT` 또는 `SELECTION`을 추가하면 prefix 문자열이 선택 텍스트로 전달되는 제한**이 있습니다. 선택 래핑은 이름 호출이나 picker로 사용하세요. 없는 기능을 현재 69개 정의의 검증 결과로 일반화하지 않았습니다.

## 적용, 검증과 복구

실제 적용·설치 결과와 재시작 절차는 `verification/RESULTS.ko.md`에 있습니다. 설정 병합 도구는 JSONC 주석·무관한 설정을 유지하며 재실행해도 추가 중복이 없습니다. 검증용 출력은 `prepared/`, 실제 적용 기록은 `verification/application.json`입니다.

자동/모델 테스트 147개와 설정 병합 테스트 4개를 실행했습니다. 모델과 실제 Extension Host 및 물리 키 입력은 서로 다른 검증입니다. 실제 실행 여부와 실패·제한은 결과 파일에 별도로 기록했습니다. 수동 확인은 `manual/notebook-markdown-regression.ipynb`를 먼저 열고 셀 안의 순서를 따릅니다. 비교용 `manual/baseline.tex`, 제외 범위 확인용 `manual/excluded.md`/`.py`도 있습니다. Inspect Context Keys와 **Developer: Toggle Keyboard Shortcuts Troubleshooting**으로 실제 Tab의 적용 binding을 확인할 수 있습니다.

원본은 `backups/2026-11-09/`와 적용 직전 `backups/apply-20261109T011330Z/`에 있습니다. 원래 설치 폴더 전체와 0.3.2 VSIX도 보존했습니다. 복구를 미리 확인한 뒤 실행합니다.

```bash
python scripts/restore.py
python scripts/restore.py --apply
```

복구 도구는 실제 변경한 두 설정 파일을 적용 직전 백업으로 되돌리고 WSL에 0.3.2 VSIX를 재설치합니다. 적용 후 사용자가 설정을 더 수정했다면 해시 검사로 중단하므로 해당 백업과 수동 병합하면 됩니다. `latex.json`은 수정하지 않았으므로 복원할 필요가 없습니다. 마지막으로 **Developer: Reload Window**를 실행합니다. 기존 Python 소스나 사용자가 수정 중인 프로젝트 Notebook은 편집하지 않았습니다.
