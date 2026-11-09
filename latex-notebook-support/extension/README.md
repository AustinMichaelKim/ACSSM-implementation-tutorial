# LaTeX Smart Tab Dispatcher 0.4.0 — Jupyter Markdown

Extends the installed 0.3.2 JavaScript implementation to Jupyter Notebook Markdown cell editing. Cell language stays `markdown`. Ordinary Markdown files, notebook Code cells, rendered cells, cell lists and outputs retain their existing bindings.

Target documents are resolved against `workspace.notebookDocuments[].getCells()` by document URI. Only `jupyter-notebook` + `NotebookCellKind.Markup` + `markdown` qualifies. Completion filtering uses `{ language: 'markdown', notebookType: 'jupyter-notebook' }` without a scheme or pattern. No global Markdown snippets are contributed.

Set `latexSmartTab.notebookSnippetSource` to the active Profile's JSONC `latex.json` path as readable by the extension host. In WSL, a Windows Profile source uses `/mnt/c/Users/.../snippets/latex.json`. Changes are loaded automatically on the next text/selection/prefix check. A blank setting uses packaged `snippets/latex.json`; an unreadable explicit source reports an error instead of substituting an older snapshot.

Exact prefix + Tab works outside math too. Bodies and delimiters are preserved. The original `editor.action.insertSnippet` command preserves nested sessions; `TextEditor.insertSnippet` would cancel them. The original core and boundary-hop algorithms are reused. Placeholder and insertion ownership state is keyed by document URI, with close/removal/language-change cleanup. Native Shift+Tab, mirrors and transforms use VS Code's snippet engine.

- `latexSmartTab.insertNotebookSnippet`: pick a source definition, including when text is selected; also accepts `{ "name": "Bold vector" }`.
- `latexSmartTab.reloadNotebookSnippets`: explicitly reload the live source.
- Existing diagnostics start/mark/export commands also support target Markdown cells.

Notebook completion suggestions follow the effective LaTeX `editor.snippetSuggestions` preference. The current Profile sets `none`, so snippets expand on Tab while other IntelliSense uses its existing editor settings. User shortcuts are merged separately; the VSIX contributes default Tab, Space and diagnostic bindings.

Prefix replacement selects the prefix before invoking the native command. A future prefix snippet using `TM_SELECTED_TEXT` or `SELECTION` consequently receives the prefix as selected text. The 69 current definitions contain neither variable. Use the named command or picker for selected-text wrappers. The original snippet text is preserved; the extension does not replace the native snippet parser.

Run `npm test` or each `node test/unit/<file>.test.js`; these model tests do not establish physical key behavior. `VERIFICATION.json` describes this build. The complete delivery includes current reports and a manual reproduction notebook. `AUDIT.ko.md`, `function-inventory.json` and the old `verification/` directory below are historical 0.3.2 records.

Build offline: `python3 scripts/package.py --output /absolute/path/latex-smart-tab-dispatcher-0.4.0.vsix`. In the complete delivery, refresh the portable snapshot with `python3 ../scripts/sync-snippets.py --source /absolute/path/latex.json`, then rebuild. Live-source edits require no rebuild.

---

The following README is the preserved historical 0.3.2 documentation; its installation version and verification claims do not describe 0.4.0.

# LaTeX Smart Tab Dispatcher 0.3.2 — 검증 후보

**현재 상태:** 수정 구현 및 로컬 119개 검사 통과. 실제 VS Code Extension Host와 사용자의 물리 Tab 검증은 아직 실행되지 않았다. `VERIFICATION.json`을 확인한다. 런타임에서 실패 가능성이 없는 정식 검증본이라고 주장하지 않는다.

## 설치

확장 화면의 `…` → **Install from VSIX…**에서 `latex-smart-tab-dispatcher-0.3.2.vsix`를 선택하고 **Developer: Reload Window**를 실행한다. 기존 ID `local-latex.latex-smart-tab-dispatcher`와 publisher를 유지하므로 같은 확장의 새 버전이다. WSL/원격 창이면 LaTeX 편집 창이 사용하는 host의 활성 확장 버전을 확인한다.

사용자의 latex.json, settings.json, keybindings.json은 자동 변경하지 않는다. 기본 Tab route를 추가했지만 기존 사용자 keybinding이 우선할 수 있다. 사용자 route만 사용할 때는 `latexSmartTab.enableDefaultTabKeybindings=false`로 새 기본값을 끌 수 있다. 원래 0.3.1 VSIX는 source ZIP에 보존되어 있어 다시 설치해 되돌릴 수 있다.

## 수정한 동작

`|`는 커서다.

```text
L(\theta{}|)  -- Tab -->  L(\theta{})|
```

이 Tab에서 dm 밖으로 나가면 실패다. 다음 Tab에서만 바깥 이동으로 진행한다.

```text
\frac{\partial f(\bm{z|})}{\partial x}
Tab 1 → \frac{\partial f(\bm{z}|)}{\partial x}
Tab 2 → \frac{\partial f(\bm{z})|}{\partial x}
Tab 3 → 분모의 x만 선택 (\partial는 선택하지 않음)
```

typed closer 이동은 다음 native field를 미리 선택하지 않는다. 문서 텍스트를 유지하는 한 번의 insert/delete transaction으로 native marker 경계를 옮긴다. 자세한 동작, 위험 및 지원 범위는 `AUDIT.ko.md`에 있다.

## 설치한 VS Code에서 검사

Command Palette → **LaTeX Smart Tab: Run Regression Checks**. 새 untitled 문서를 이용하며 기존 파일 본문과 사용자 설정을 덮어쓰지 않는다. 검사 중 다른 editor로 focus를 바꾸면 중단될 수 있다. 마지막 JSON에서 actualExtensionHost, physicalTabTest, failed, skipped, aborted를 함께 본다.

사용자 설정·정적 ff 및 ;th 스니펫·자동 괄호가 fixture와 다르면 관련 case가 실패하거나 미실행될 수 있다. 이를 구현 성공으로 해석하지 않는다. API 검사를 통과해도 평소 ;th/Tab 및 pd/bv/Tab의 실제 키 입력 경로는 별도로 확인해야 한다.

## 소스에서 재실행

런타임 외부 npm 의존성은 없다. Node로 로컬 검사를, Python 표준 라이브러리로 패키징을 수행한다.

```sh
npm test
python3 scripts/package.py --output ../latex-smart-tab-dispatcher-0.3.2.vsix
```

실제 isolated Extension Host 검사는 별도 runner와 VS Code 실행 프로그램이 필요하다.

```sh
npm install --no-save @vscode/test-electron
npm run test:host
```

Linux headless에서는 `xvfb-run -a node scripts/run-host-tests.js`를 사용할 수 있다. `VSCODE_EXECUTABLE` 환경변수로 이미 설치한 실행 파일을 지정할 수 있다. `SMART_TAB_PHYSICAL=1`은 Linux xdotool이 있을 때만 물리 Tab 검사 경로를 켠다. 이번 첨부 결과는 이 경로를 실행한 결과가 아니다.

## 진단

**LaTeX Smart Tab Diagnostics: Start Recording** → 짧은 재현 → **Ctrl+Alt+F12**로 context 표시 → **Export Recording**. 진단은 문서 전체 텍스트를 포함하며 자동 외부 전송은 하지 않는다. 민감한 노트에서는 녹화하지 않는다.

## 알려진 한계

지원 선언 engines `^1.99.0`의 모든 버전을 실제 실행한 것은 아니다. 다른 extension이나 사용자 동작으로 native session이 이미 종료된 plain 모드에서는 원래 placeholder 범위를 정확히 복원할 수 없다. 일반적인 balanced argument fallback은 계속 남아 있다. matcher는 완전한 TeX parser가 아니므로 verbatim/catcode와 임의의 복잡한 delimiter 의미를 모두 처리하지 않는다. 텍스트 불변 edit도 문서 버전/dirty/undo에 영향을 줄 수 있으므로 실제 host 검사 전 Candidate 표기를 유지한다.

전체 코드 해설: `AUDIT.ko.md`. 결과: `VERIFICATION.json`. 원본 대조: source ZIP의 original-0.3.1/와 patch/.
