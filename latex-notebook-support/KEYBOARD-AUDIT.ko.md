# Notebook Markdown LaTeX 단축키 조사

2026-11-09. 현재 설치된 Windows VS Code **1.145.2** (`c4453f8ea430795f941c1b2ff6c9321135a74a02`), WSL 사용자 확장, Windows 사용자 keybindings/settings, WSL 및 프로젝트 settings를 대조했다. 조사 대상은 Jupyter Notebook Markdown **셀 텍스트 편집 중**의 스니펫 호출·placeholder 이동·일반 수식 입력과, 편집 포커스를 잃은 뒤의 연쇄 동작이다.

설정과 설치 코드에 대한 정적 조사다. 사용자가 보고한 Alt 증상을 실제 키 입력으로 재현하거나 현재 창의 context key를 채집한 것은 아니다. 아래의 “확인”은 바인딩·설정·코드 경로의 확인을 뜻한다. 사용자 settings/keybindings, 원본 latex.json, 확장 구현은 변경하지 않았다.

## 결론과 변경 우선순위

Alt 단독 입력의 가장 유력한 원인은 **메뉴 바 포커스**다. 현재 사용자 설정에는 이를 끄는 항목이 없으며 설치된 코드의 기본값은 켜짐이다. Alt 단독에 연결된 Notebook 편집 종료 사용자 바인딩은 없다. 메뉴 포커스를 얻는 것과 Markdown 셀이 렌더링 상태로 바뀌는 것은 다른 동작이므로, 실제 현상까지 같은 것으로 단정하지 않는다.

| 우선순위 | 키 / 설정 | 확인한 개입 경로 | 권장 변경 |
|---|---|---|---|
| 1 — Alt 증상 대응 | Alt 단독 / `window.customMenuBarAltFocus` | 기본값 true. Alt를 눌렀다 놓으면 메뉴로 포커스를 옮길 수 있음 | Windows **User settings**에서 false |
| 1 — Alt 조합 보호 | Alt+메뉴 문자 / `window.enableMenuBarMnemonics` | 기본값 true. Alt+F/E/V 등의 메뉴 mnemonic 경로 | Windows **User settings**에서 false. 현재 숫자/마이너스 바인딩의 직접 충돌이 입증된 것은 아니며 Alt를 편집용으로 쓰기 위한 보호 설정 |
| 1 — 이전 placeholder 보호 | Shift+Tab | 기본 `jumpToPrevSnippetPlaceholder` 외에 자동완성의 `acceptAlternativeSelectedSuggestion`이 같은 키를 사용. 자동완성 창이 열리면 후자가 기본 snippet 이동보다 우선할 수 있음 | Notebook Markdown + `inSnippetMode && hasPrevTabstop`에서 이전 placeholder로 가는 사용자 바인딩 추가 |
| 2 — Tab 포커스 모드 예방 | Ctrl+M / `editor.action.toggleTabFocusMode` | Tab Moves Focus가 켜지면 Smart Tab의 `!editorTabMovesFocus` 조건이 실패 | 현재 모드는 상태 표시줄에서 확인 후 끔. 실수로 켜는 일이 있다면 Notebook Markdown 편집 중 Ctrl+M만 비활성화 |
| 2 — 셀 밖 이동 예방 | 위/아래 방향키 / `notebook.focusPreviousEditor`, `notebook.focusNextEditor` | 기본 `notebook.navigation.allowNavigateToSurroundingCells=true`. 셀 첫/마지막 줄의 커서 경계에서 인접 셀로 이동 가능 | 셀 안에서 커서를 유지하려면 해당 설정 false. 이는 Notebook 전체의 경계 탐색 동작을 바꿈 |
| 3 — 취향에 따라 | Esc / `notebook.cell.quitEdit` | 스니펫 취소와 제안 닫기 후에는 셀 편집 종료·렌더링 경로로 이어질 수 있음 | Esc를 반복해서 눌러도 편집을 유지하고 싶을 때만 **셀 편집 종료 바인딩**을 제한. `leaveSnippet`, 제안/hover 닫기는 유지 |
| 3 — 취향에 따라 | Shift+Enter / `notebook.cell.executeAndSelectBelow` | Markdown을 렌더링하고 다음 셀로 이동. 마지막 셀이면 새 셀 추가 가능 | 줄바꿈 용도로 쓴다면 Markdown 편집 범위에서 `type` + `{"text":"\n"}`로 덮어씀. 렌더링 용도로 쓰면 유지 |
| 3 — 취향에 따라 | Alt+Enter / `notebook.cell.executeAndInsertBelow` | Markdown을 렌더링하고 아래 셀 삽입·포커스 이동 | 수식 입력에 쓰려면 Markdown 편집 범위에서 다른 명령으로 덮어씀. 현재 스니펫 Alt 조합과 직접 중복되지는 않음 |
| 3 — 취향에 따라 | Ctrl+Alt+Enter / `notebook.cell.quitEdit` | **현재 Windows 빌드**의 Markdown 셀 편집 종료 바인딩 | 이 조합을 수식용으로 쓸 때만 변경 |
| 3 — 취향에 따라 | Ctrl+Shift+- / `notebook.cell.split` | 설치된 Jupyter Keymap이 편집 중 셀 분할로 등록. prefix/body 입력과 별개의 구조 변경 | 수식 입력 중 누르는 조합이라면 Notebook Markdown에서만 비활성화 또는 재할당 |

**최소 권장은 Alt 설정 두 개와 Shift+Tab 보호다.** Ctrl+M과 방향키 경계 이동 차단은 편집 포커스 유지에 도움이 된다. Enter 계열과 Esc는 Notebook의 정상 기능이므로 사용 습관에 따라 고른다.

## 바로 사용할 수 있는 설정 예시

Windows 사용자 설정 파일은 `C:\Users\p1072\AppData\Roaming\Code\User\settings.json`이다. `window.*` 두 항목은 application 범위이므로 WSL Remote settings나 `[markdown]` 안이 아닌 **Windows User settings 최상위**에 둔다.

```jsonc
"window.customMenuBarAltFocus": false,
"window.enableMenuBarMnemonics": false
```

현재 `window.menuBarVisibility`는 명시되지 않았고 설치 코드의 기본값은 `classic`이다. 따라서 지금은 메뉴 표시 설정 변경이 필요 없다. 나중에 `toggle`을 쓰면 주의해야 한다. 설치 코드의 `shouldAltKeyFocus`는 `!disableAltFocus || visibility === "toggle"`이므로 Alt focus만 꺼도 toggle의 Alt 경로가 남는다. 이때는 `classic` 또는 `hidden` 등으로 변경한다. 메뉴가 계속 보이게 하려면 `classic`을 사용한다.

아래는 현재 `keybindings.json` 배열 마지막에 추가하는 **Shift+Tab 보호 예시**다. 이전 placeholder가 있을 때만 적용하므로 첫 placeholder에서의 동작은 바꾸지 않는다.

```json
{
    "key": "shift+tab",
    "command": "jumpToPrevSnippetPlaceholder",
    "when": "editorTextFocus && notebookType == jupyter-notebook && notebookCellType == markup && editorLangId == markdown && notebookCellEditorFocused && !editorReadonly && !editorTabMovesFocus && !editorHasMultipleSelections && inSnippetMode && hasPrevTabstop"
}
```

방향키로 다른 셀에 넘어가는 동작까지 막으려면 다음을 사용자 또는 프로젝트 설정에 둔다. 이 설정은 Markdown만이 아니라 해당 설정을 적용받는 Notebook의 경계 탐색에도 영향을 준다.

```jsonc
"notebook.navigation.allowNavigateToSurroundingCells": false
```

Ctrl+M 오입력을 차단하려면 먼저 Tab Moves Focus를 끈 뒤 아래를 사용자 keybindings 배열에 추가한다. `command: ""`는 해당 조건에서 키를 소비하는 VS Code의 사용자 바인딩 방식이다.

```json
{
    "key": "ctrl+m",
    "command": "",
    "when": "editorTextFocus && notebookType == jupyter-notebook && notebookCellType == markup && editorLangId == markdown && notebookCellEditorFocused"
}
```

## 이미 보호되거나 변경할 필요가 없는 항목

| 키 / 기능 | 현재 상태와 판단 |
|---|---|
| Alt+1, Alt+2, Alt+3, Alt+- | 현재 사용자 파일에 Notebook Markdown 전용 `latexSmartTab.insertSnippetTemplate` 바인딩 4개가 있다. 각각 지수 입력, 제곱, 세제곱, 아래첨자다. 새로 추가할 필요가 없다. Alt를 누른 뒤 메뉴로 포커스가 먼저 넘어간 상태라면 이 바인딩의 편집기 포커스 조건이 성립하지 않을 수 있다. |
| Tab — 정확한 prefix | 사용자 `latexSmartTab.expandSnippet`이 우선한다. 자동완성의 기본 Tab 수락, native snippet tab completion, Emmet, TabOutX의 기본 바인딩을 일괄 삭제할 필요가 없다. 단일 선택·편집 포커스·Tab focus off 등 해당 바인딩 조건이 성립해야 한다. |
| Tab — snippet 이동 / 일반 괄호 탈출 | 현재 사용자 `navigateSnippet` / `navigatePlain`과 설치 확장 기본 바인딩이 연결되어 있다. 일반 IntelliSense Tab을 추가로 최상위에 재등록하면 오히려 이 경로를 덮을 수 있다. |
| Space | 사용자 `insertContinuationSpace`가 선택된 마지막 기본값을 보존하는 경로를 이미 제공한다. 일반 Space를 새로 비활성화할 필요가 없다. |
| Esc — `leaveSnippet` | native snippet 취소 동작을 유지해야 한다. 설치 코드상 snippet 취소 weight 130, 셀 편집 종료 weight 95여서 같은 편집 포커스에서는 snippet 취소가 먼저다. 제안 창은 별도 우선순위를 갖는다. |
| Shift+Tab — snippet choice | native snippet 선택지 모드에는 이전 placeholder 보호용 weight 191 규칙이 따로 있다. 일반 placeholder까지 항상 보호하는 것은 아니므로 위 사용자 바인딩을 권장한다. |
| Ctrl+Enter | Jupyter Keymap에는 `executeAndFocusContainer`가 있으나, 설치된 VS Code는 확장 keybinding의 `when`에 command precondition을 결합한다. 해당 명령의 precondition은 code 셀 조건이므로 Markdown에서 무조건 실행/이탈한다고 분류하면 부정확하다. 일반 편집기의 `editor.action.insertLineAfter` 경로가 남는다. 실제 Windows Markdown 종료 키는 위의 **Ctrl+Alt+Enter**다. |
| Enter | Markdown 편집 중 일반 줄바꿈 또는 열려 있는 IntelliSense 제안 수락 경로다. `[latex]`의 Enter 설정은 Markdown에 직접 적용되지 않는다. 제안 수락에 Enter를 쓰면 유지한다. |
| Ctrl+Space | 명시적으로 IntelliSense를 여는 키다. 현재 custom Notebook snippet 제안은 LaTeX `snippetSuggestions:none` 설정을 따라 목록에서 숨겨져 있지만 다른 공급자의 제안 창은 열릴 수 있다. 이 상태에서 Shift+Tab의 기본 충돌이 발생할 수 있다. |
| Inline suggestion / inline edit의 Tab·Shift+Tab | native inline 수락/이동 바인딩은 존재한다. 현재 Windows User settings에 `editor.inlineSuggest.enabled:false`가 있다. 다시 켜거나 별도 inline edit 기능을 사용하게 될 때 재점검 대상이며, 지금 일괄 제거할 근거는 없다. |
| Emmet Tab 확장 | `config.emmet.triggerExpansionOnTab`이 켜져야 적용된다. 현재 읽은 설정에는 활성화 항목이 없고 사용자 Smart Tab이 우선한다. `emmet.includeLanguages`로 Markdown을 HTML 등에 연결한 설정도 없다. |
| TabOutX 확장 | 등록된 0.4.1에 Tab/Shift+Tab 바인딩이 있지만 `!inSnippetMode` 조건이 있다. snippet 세션 안의 직접 경쟁자는 아니다. snippet 밖에서는 사용자 Smart Tab이 우선하며 Shift+Tab은 별도 동작이므로 필요할 때만 범위를 제한한다. |
| LaTeX Workshop Enter / Alt+Enter | 제공된 바인딩이 LaTeX 계열 language ID에만 적용된다. Markdown 셀에는 해당하지 않는다. |
| Markdown 미리보기 Ctrl+K V 등 | 설치된 Markdown 확장의 해당 바인딩은 `!notebookEditorFocused`를 포함한다. Notebook 안의 편집 종료 원인으로 분류할 수 없다. 새 Markdown 전용 custom editor 바인딩도 `activeCustomEditorId == vscode.markdown.editor` 조건이어서 Notebook 셀과 다르다. |
| Alt+Up/Down / Shift+Alt+Up/Down | Notebook의 셀 이동·복사 바인딩은 `!inputFocus`여서 텍스트 편집 중에는 적용되지 않는다. 편집 중에는 일반 줄 이동·복사 경로이며 현재 스니펫 호출 키와 중복되지 않는다. |
| PageUp/PageDown | Notebook이 별도 명령을 등록하지만 설치 구현은 같은 셀 편집기에 page cursor 명령을 위임한다. 이를 셀 이탈 단축키로 일괄 차단할 근거는 없다. |
| Ctrl+B | 기존 build 바인딩은 `.tex`에만 적용된다. Notebook에서는 일반 사이드바 토글이 남는 것이 현재 의도다. 수식 스니펫 키와 충돌하지 않는다. |

## 키 바인딩 이외에 같은 증상을 만들 수 있는 편집 상태

- **다중 커서:** Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+Up/Down 또는 Alt+클릭 등으로 여러 커서를 만들면 현재 Smart Tab의 `!editorHasMultipleSelections` 조건이 실패한다. 확장이 의도적으로 지원하지 않는 상태다. 이런 키를 전부 제거할 필요는 없으며 한 커서로 돌아와야 한다. 설치 버전에는 Notebook의 `notebook.multiCursor.enabled`에 따라 여러 셀에 걸쳐 선택하는 경로도 있다.
- **IntelliSense commit character:** Markdown에는 `[latex]`의 `editor.acceptSuggestionOnCommitCharacter:false`가 직접 적용되지 않는다. 다른 공급자의 제안이 열린 상태에서 구두점 입력으로 제안이 수락되는 현상이 있다면 `[markdown]`에 이 설정을 false로 추가한다. 이는 일반 `.md`에도 영향을 주므로 지금 실제로 발생한 충돌과 구분한다. Enter 수락을 유지하려면 `editor.acceptSuggestionOnEnter`를 끄지 않는다.
- **Markdown 기본 제안:** 설치된 Markdown 확장은 `[markdown]`의 `editor.quickSuggestions`를 comments/strings/other 모두 off로 제공한다. 따라서 다른 설정·공급자 없이 자동 제안이 항상 뜬다고 단정할 수 없다. Ctrl+Space 같은 명시적 호출은 별개다.
- **포커스 조건:** `activeTextEditor`가 Markdown 셀을 가리키는 것만으로는 충분하지 않다. 실제 텍스트 편집기에 포커스가 있어야 `editorTextFocus` 및 `notebookCellEditorFocused`가 성립한다. 메뉴, 셀 목록, 렌더링된 Markdown, 출력에 포커스가 있으면 현재 Notebook 전용 스니펫 바인딩은 적용되지 않는다.
- **팝업의 Esc:** IntelliSense, hover, parameter hints, rename, 검색, inline chat 등의 닫기 경로가 있다. 이들을 전부 비활성화하면 정상적인 닫기 동작도 사라지므로 편집 종료와 구분해야 한다.

## 셀 편집에서 빠진 뒤의 연쇄 동작

설치된 Jupyter Keymap 1.1.2는 `notebookEditorFocused && !inputFocus && !notebookOutputInputFocused` 상태에서 문자 키를 명령으로 사용한다. **텍스트 편집 중에는 활성화되지 않는다.**

| 키 | 셀 목록 / 명령 상태의 동작 |
|---|---|
| A / B | 위 / 아래 Code 셀 삽입 |
| D D | 셀 삭제 |
| J / K | 다음 / 이전 셀 선택 |
| C / X / V | 셀 복사 / 잘라내기 / 붙여넣기 |
| Z / S / F | 실행 취소 / 저장 / Notebook 검색 |
| M / Y | VS Code 기본 바인딩으로 Markdown / Code 셀 종류 변경 |
| Delete | VS Code 기본 셀 삭제 |

따라서 포커스를 잃은 뒤 prefix를 계속 입력하면 셀 명령이 실행될 수 있다. 문자 키 전체를 삭제하기보다 메뉴 포커스나 편집 종료 경로부터 해결하는 것이 맞다. 이 동작은 Alt 단독이 직접 셀을 삭제한다는 뜻이 아니다.

## 실제 키 입력으로 확인할 항목

1. `Developer: Toggle Keyboard Shortcuts Troubleshooting`을 실행하고 Markdown 셀의 텍스트 편집기로 돌아간다. Output 패널 자체에 포커스를 둔 채 검사하지 않는다.
2. Alt를 눌렀다 놓기, Alt+1/2/3/-, 정확한 prefix+Tab, snippet 안에서 Shift+Tab을 각각 확인한다.
3. `Developer: Inspect Context Keys`로 문제 전후의 `editorTextFocus`, `notebookCellEditorFocused`, `notebookCellMarkdownEditMode`, `inSnippetMode`, `editorTabMovesFocus`, `suggestWidgetVisible`, `editorHasMultipleSelections`를 확인한다.
4. Alt 조합은 `latexSmartTab.insertSnippetTemplate`, prefix Tab은 `latexSmartTab.expandSnippet`으로 해석되는지 본다. 메뉴의 Alt modifier 경로는 일반 명령 바인딩 로그만으로 모두 드러나지 않을 수 있으므로 메뉴 포커스도 함께 본다.
5. `ff` 등 placeholder가 여러 개인 스니펫에서 Ctrl+Space로 제안 창을 연 뒤 Shift+Tab을 확인한다. 보호 바인딩 적용 후 이전 placeholder로 이동해야 한다.
6. Esc는 제안 닫기 → snippet 취소 → 셀 편집 종료를 구분한다. 셀 위/아래 경계 방향키와 Shift/Alt/Ctrl+Alt+Enter도 별도로 확인한다.

## 근거

- 기계 판독용 근거: [`verification/keyboard-audit.json`](verification/keyboard-audit.json). 조사 당시 사용자 설정·바인딩, 파일 해시, 등록된 관련 확장 10개 manifest, 설치 workbench 코드 23개 경로 발췌를 포함한다. 설치 manifest는 현재 세션의 확장 활성화 상태나 실제 키 입력 검증을 대신하지 않는다.
- [VS Code 키 바인딩 규칙과 진단](https://code.visualstudio.com/docs/configure/keybindings): 사용자 규칙 우선, 배열 아래에서 위로 평가, 문제 해결 로그.
- [VS Code 메뉴 설정 공식 소스](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/workbench.contribution.ts): 두 Alt 설정의 의미. 실제 버전 기본값은 로컬 배포 코드와 대조했다.
- [Notebook 편집 종료 공식 소스](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/notebook/browser/controller/editActions.ts): Esc 및 Windows Ctrl+Alt+Enter. 실제 버전 바인딩은 로컬 배포 코드를 기준으로 판단했다.
- [VS Code 메뉴 표시 설명](https://code.visualstudio.com/docs/editing/getting-started/userinterface): `toggle`의 Alt 동작.
