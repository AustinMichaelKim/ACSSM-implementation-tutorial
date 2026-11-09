# LaTeX Smart Tab Dispatcher 0.3.1 → 0.3.2 코드 감사 및 수정 보고서

작성 기준: 2026-09-28. 대상은 `AustinMichaelKim/Vscode-Latex-Snippet-tutorial`의 `main` 커밋 `02de4c8c30caafa8113595dfb535d073d395ee7d`에 있는 실제 배포 VSIX다.

**판정: 0.3.2는 수정 구현과 로컬 검사를 마친 검증 후보(Candidate)다. 실제 VS Code Extension Host 및 사용자의 물리 Tab 환경에서 통과한 정식 검증본이라고 주장하지 않는다.** 로컬 119개 검사와 실제 host용 42개 fixture를 구분하며, 후자의 42개는 이번 환경에서는 행동 모델에서 smoke 실행한 결과다.

## 1. 추출 대상과 무결성

원본 `latex-smart-tab-dispatcher-0.3.1.vsix` 크기는 24,092 bytes다. Git blob SHA-1은 `3e9befeca417ce177d9ae3d77d4ab9afa94bb6c7`이다. 단순 파일 SHA-1이 아니라 `blob <size>\0` 헤더를 포함한 Git object hash를 다시 계산해 원격 값과 일치시켰다. ZIP CRC 검사도 통과했다.

VSIX는 ZIP 컨테이너이며 내부의 `extension.js`와 `core.js`는 읽을 수 있는 CommonJS 원문이다. 디컴파일하거나 코드를 추정하여 새로 작성한 것이 아니라 실제 배포된 원문을 추출했다. 아래 모든 원본 파일은 source bundle의 `original-0.3.1/`에 있고, 전체 텍스트와 줄 번호는 `ORIGINAL-SOURCE-NUMBERED.md`에도 담았다.

| 파일 | 원본 줄 수 | 역할 |
|---|---:|---|
| extension.js | 1,670 | VS Code API, 상태 추적, Tab/Space 처리, 진단, 검사 명령 |
| core.js | 299 | offset 변환, token 탐색, 긴 줄 prefix 탐색, block 판정 |
| package.json | 219 | 확장 식별자, 활성화, 명령, 설정, keybindings |
| test/host-regression.js | 146 | 실제 host에서 실행하도록 만들어진 기존 검사 |
| README.md | 47 | 0.3.1 설치 및 당시 검증 정책 |
| CHANGELOG.md | 17 | 0.3.0/0.3.1 변경 기록 |
| LICENSE.txt | 21 | 원래 MIT 라이선스, 2026 local-latex |
| extension.vsixmanifest | XML | 설치 패키지 메타데이터와 assets |
| [Content_Types].xml | XML | 패키지 파일 형식 선언 |

## 2. 증상을 만든 정확한 코드 경로

### 2.1 `L(\theta{}|)`가 dm 밖으로 나가는 경로

원본 `navigateSnippet`, 1447–1542행의 `isOuterTypedCloser` 분기는 가장 가까운 `)`를 이미 인식한 상태에서도 `jumpToNextDistinctPlaceholder(editor)`를 실행했다. `dm`의 내부 `${1}`에 기호 스니펫이 중첩되어 있고 다음 native stop이 `\]` 바깥의 `$0`이면, 괄호는 무시되고 그곳으로 이동한다.

따라서 “괄호가 closingTokens에 빠져 있다”가 이 사례의 직접 원인이 아니다. 토큰은 잡혔지만 **토큰 뒤라는 목적지와 다음 native field라는 목적지를 같은 것으로 처리했다.** 원본 README에는 `)`를 넘기는 Tab에서 바로 `x`가 선택돼도 된다고 쓰여 있다. 즉 0.3.1의 구현과 당시 허용한 테스트 정책이 모두 사용자가 원한 “한 단계씩 탈출”을 놓쳤다.

### 2.2 직접 커서 이동으로 되돌리면 왜 pd가 다시 깨지는가

VS Code의 nested snippet merge는 outer placeholder decoration을 제거하고 nested placeholder들로 교체한다. 화면에서 보면 분자 안에 있어도, native 관점에서는 현재 child field의 범위 바깥일 수 있다. 그 상태에서 `editor.selection = ...`으로 `)` 뒤에 놓으면 native controller가 selection이 field 밖이라고 판단해 세션을 취소할 수 있다.

원본 `escapeInnerTokenAndSynchronize`, 1106–1122행에는 next/prev로 동기화를 시도한 뒤 직접 커서를 옮기는 경로도 남아 있었다. next가 root `$0`에 닿은 순간 취소된 세션은 prev로 되살릴 수 없다. 그러므로 “먼저 native next를 눌러 보고 다시 돌아오기”도 안전한 탐색 연산이 아니다.

### 2.3 왜 x가 아니라 `\partial x` 전체가 선택됐는가

원본 `advanceSequentialArgument`, 753–777행은 native 이동이 다음 인수 안의 field를 찾지 못하면 `selectFollowingArgument`를 호출한다. `findFollowingBracedArgument`가 찾는 것은 `{\partial x}`라는 **구문상의 인수 전체**다. 이것은 `${2:x}`의 native 범위와 다르다. 따라서 native 세션 손실을 구문 전체 선택으로 가리면서 `\partial x`가 선택된다.

관련된 별도 오류로, 원본 `selectionIsInsideArgument`는 인수가 비어 있지 않을 때 빈 selection을 실패로 간주했다. `{prefix ${2} suffix}`의 빈 native field도 정상적인 필드다. 이 경우 역시 전체 인수 fallback을 유발할 수 있었다.

## 3. 실행 구조와 상태의 의미

입력은 keybinding → 확장 command → native snippet 명령 또는 delimiter 이동 → 문서/선택 이벤트 → 추적 상태 갱신 순으로 이어진다. 확장은 새로운 snippet 엔진을 구현하지 않고 VS Code의 필드 이동을 이용한다. native topology와 문서 문자 위치는 별도의 정보다.

### 상태 변수별 해석

- `trackedPlaceholder`: 가장 최근 캡처한 selection의 추정 범위, URI, 버전, 편집 여부. 실제 native 객체가 아니다.
- `typedClosersByDocument`: 일반 입력·자동 pair·붙여넣기 등에서 생성된 닫는 토큰. typed라는 이름을 “물리 키로 직접 입력”으로 좁게 해석하면 안 된다.
- `snippetClosersByDocument`: 추적 삽입 경로를 통해 스니펫이 만든 닫는 토큰. `\frac`의 인수 경계와 `\right)` 등을 typed 괄호와 구별한다.
- `snippetRangesByDocument`: 삽입된 스니펫 전체 span. Space에서 terminal default를 판별하는 보조 증거다.
- `snippetInsertionDepth`: 삽입 명령 중 발생한 contentChanges의 생성 경로를 분류하는 카운터다.
- `__events`, `__enabled`, `__documentUri`: opt-in 진단 상태. 진단은 자동 외부 전송을 하지 않지만, export에는 문서 전체 텍스트가 들어간다.
- 0.3.2의 `boundaryTransactions`: 텍스트가 변하지 않는 경계 이동 transaction을 식별한다. 자체 token marker를 잘못 삭제·재생성하지 않기 위한 장치다.
- 0.3.2의 `transientProbesByDocument`: 긴 줄 prefix 복구 중 넣은 공백 한 글자만 추적한다. 다른 텍스트를 되돌리지 않고 정리한다.
- 0.3.2의 `commandQueue`, `operationEditor`: 편집 명령을 직렬화하고 요청 당시 editor를 고정한다. 모든 외부 편집을 잠그는 전역 transaction은 아니다.

원본의 marker 목록과 진단은 2,000개 제한을 가진 메모리 상태다. reload·문서 닫기 이후 과거 생성 경로가 영속적으로 복구되는 것은 아니다.

## 4. 원본 함수 전체 해설

아래 행 번호는 **추출한 0.3.1 원문 기준**이다. 함수 선언은 TypeScript parser의 AST로 집계했다. 이름 있는 선언뿐 아니라 뒤의 별도 절에서 익명 등록 callback·export 래퍼·설정·XML·검사 본문도 설명한다. 수정 후 함수 위치는 `function-inventory.json`의 `release/*`에 있다.

### 4.1. `core.js`

#### `mapOffset` — 9–41행

변경 전 offset을 변경 후 offset으로 옮긴다. 각 contentChange의 원본 범위, 삽입 길이, 이전 변경 delta를 고려한다. 정확히 경계에 있는 offset은 left/right affinity에 따라 기존 왼쪽에 남거나 삽입 뒤로 이동한다. 여러 변경은 같은 원본 문서 좌표라는 전제를 지키며 입력 배열을 임의의 순서에 의존하지 않게 다룬다.

#### `transformRange` — 44–53행

편집 가능한 placeholder/span 양 끝에 mapOffset을 적용한다. 시작의 왼쪽 affinity와 끝의 오른쪽 affinity로 경계에서 입력한 텍스트가 범위에 포함되도록 한다. 사용자가 필드에서 타이핑하면 범위가 늘어나는 것이 정상이다.

#### `transformTokenRange` — 59–68행

이미 존재하는 고정 literal token의 위치를 이동한다. 원본은 양 끝을 오른쪽으로 옮겨 token 바로 뒤 입력이 token span을 늘렸다. 0.3.2는 시작 right, 끝 left로 바꾸었다. 바로 앞에 들어온 문자는 token을 밀고 바로 뒤 문자는 token 바깥에 남는다. 토큰 내부 편집으로 문자열이 달라지면 별도 validation에서 삭제한다.

#### `findLongLineSnippetPrefixProbe` — 85–153행

현재 줄·cursor 위치·100자 경계·허용 문자 집합을 받아 복구 후보 token과 공백을 삽입할 위치를 계산한다. 짧은 줄은 native 경로에 맡기고, 입력 중인 명령 또는 보수적 조건을 만족하지 않는 suffix는 복구하지 않는다. 단순히 모든 100자 제한을 제거한 것이 아니라 native 제한을 우회하는 조건부 전처리다.

#### `normalizeClosingTokens` — 155–158행

token 배열에서 빈 값과 중복을 없애고 길이 내림차순으로 정렬한다. 복합 token \right)와 마지막 문자 )가 같은 위치에서 경쟁할 때 더 구체적인 구조를 우선하게 한다.

#### `findInlineClosingMatch` — 161–189행

주어진 line과 cursor 오른쪽에서 첫 가까운 token 일치를 찾는다. skipBlankChar에 따라 공백을 건너뛸 수 있지만 일반 문자를 넘지 않는다. 새 버전은 isValidTokenStart로 escape, 주석, control-word 경계를 함께 확인한다.

#### `findInlineClosingTarget` — 196–215행

문자열 수준 inline match를 이동할 character 위치로 변환하는 보조 함수다. core 모듈 API와 테스트에서 사용할 수 있으나 원본 extension.js는 이 함수를 직접 import하지 않았다. 실행 경로에 쓰이지 않는 export도 원본 기능 목록에 포함해 설명한다.

#### `findClosingTokensInInsertedText` — 221–249행

삽입된 문자열을 앞에서 뒤로 훑으며 가장 긴 closing token을 찾아 상대 offset을 반환한다. 같은 토큰 안의 짧은 suffix를 중복 등록하지 않도록 소비한 길이만큼 전진한다. 새 버전은 문자열의 escape와 줄 주석을 검사하지만, 기존 문서 바깥 문맥 전체를 아는 완전한 TeX lexer는 아니다.

#### `hasOnlyIgnorableLineTail` — 252–255행

token 뒤에 공백 또는 주석만 남아 있는지 판단한다. 뒤에 수식이나 본문이 있으면 block 종료라고 간주해 다음 줄로 보내지 않기 위한 조건이다.

#### `isStandaloneBlockCloser` — 263–279행

token이 blockClosingTokens에 있고 token 앞이 들여쓰기뿐이며 뒤가 무시 가능한 tail인지 확인한다. \] 한 줄은 display 종료지만, matrix/aligned 같은 nested closer는 기본 block 목록에서 제외한다. token 종류와 줄 배치를 동시에 검사한다.

#### `nextLineEntryCharacter` — 282–285행

다음 줄의 선행 공백 길이를 구해 첫 비공백 문자 앞 위치를 돌려준다. 다음 줄의 텍스트를 덮어쓰지 않으면서 들여쓰기 이후로 진입하기 위한 계산이다.

### 4.2. `extension.js`

#### `__trace` — 8–26행

진단이 켜져 있고 대상이 LaTeX이며 녹화 대상 URI와 일치할 때만 이벤트를 저장한다. 시간·문서 버전·문서 전체 텍스트·선택 구간·추정 placeholder·가까운 closer와 소유 분류를 함께 남긴다. 최대 2,000개를 유지한다. 이것은 상태 관찰기이지 native snippet 상태 조회 API가 아니다. 전체 텍스트가 기록되므로 민감한 노트 대신 짧은 재현 문서에서 사용해야 한다.

#### `documentKey` — 131–133행

문서 URI를 문자열로 바꾸어 세 개의 문서별 Map의 키로 사용한다. 파일 경로만 쓰지 않으므로 untitled 문서도 서로 구별한다. 두 문서에서 같은 offset의 괄호를 혼동하지 않게 하는 기본 식별 함수다.

#### `sameDocument` — 135–141행

editor와 추적 객체가 존재하고 URI가 같은지 검사한다. 다른 탭으로 이동한 뒤 이전 placeholder의 범위를 현재 탭에 적용하는 것을 막는다. 문서가 같다는 조건만 검사하며, native 세션 생존 여부나 버전 일치까지 보장하지는 않는다.

#### `documentLength` — 143–145행

현재 문서 전체 문자열 길이를 구한다. VS Code offset과 JavaScript 문자열은 UTF-16 단위이므로 한글·이모지가 들어 있는 문서에서도 같은 좌표계를 유지해야 한다. 호출 시 문서 전체 문자열을 읽는 비용이 있다.

#### `clamp` — 147–149행

값을 하한과 상한 사이로 제한한다. 변경으로 짧아진 문서에 오래된 offset이 남았을 때 유효 범위 밖으로 positionAt을 계산하지 않도록 한다. 잘못된 의미의 범위를 올바른 native 필드로 복구하는 함수는 아니다.

#### `captureCurrentPlaceholder` — 151–169행

현재 selection을 start/end offset, URI, documentVersion, editedSinceCapture=false와 함께 저장한다. 스니펫 삽입 또는 native Tab 후에 호출되어 확장 프로그램이 사용할 범위의 기준점이 된다. 이름과 달리 VS Code 내부 placeholder 객체를 가져오지 않는다. 빈 selection일 때는 길이 0인 추적 범위이며, 이 차이가 중첩 스니펫 오류의 핵심이다.

#### `clearTrackedPlaceholder` — 171–176행

대상 문서에 해당하는 추적 placeholder를 지운다. plain 모드 진입, 문서 닫기, 범위 무효화 등에서 사용한다. 확장 프로그램의 추정 상태를 지울 뿐 VS Code의 native session을 직접 취소하는 명령은 아니다.

#### `changeTouchesRange` — 178–191행

contentChanges의 각 변경이 추적 범위에 닿거나 겹치는지 판단한다. 길이 0인 삽입도 경계에서 편집으로 취급할지 구분한다. 이 판정으로 editedSinceCapture를 갱신하므로 Space로 기본값을 보존할 조건에 직접 영향을 준다.

#### `updateTrackedPlaceholder` — 193–222행

같은 문서의 변경 이벤트를 받아 범위 양 끝을 새 좌표로 옮기고 버전을 갱신한다. 변경이 필드에 닿으면 editedSinceCapture를 true로 만든다. 입력으로 커지는 필드에는 growing-range 규칙을 쓰며, 고정 문자열인 closer marker와 같은 경계 규칙을 쓰면 안 된다.

#### `getTrackedPlaceholder` — 224–248행

저장된 객체가 같은 문서에 있고 offset과 현재 selection이 사용 가능한 관계인지 검사한 뒤 범위를 돌려준다. 없거나 더 이상 믿을 수 없는 경우 undefined를 반환한다. 반환값은 구문 탐색의 안전 경계에만 사용해야 하며, native 필드의 정체나 다음 필드 위치를 증명하지 않는다.

#### `readConfigForResource` — 250–296행

문서 URI를 기준으로 latexSmartTab 설정을 읽고 기본값으로 보완한다. closingTokens와 blockClosingTokens는 빈 항목·중복을 정리하고 긴 토큰을 먼저 검사하도록 정렬한다. 설정 범위가 문서별일 수 있으므로 전역 상수만 읽는 것과 다르다. Tab keybinding 활성화 설정은 package.json의 when 절에서 평가된다.

#### `readConfig` — 298–300행

현재 editor의 document.uri를 readConfigForResource에 전달하는 얇은 래퍼다. 동일한 워크스페이스에서도 리소스별 설정을 유지하기 위한 진입점이다.

#### `newOffsetForChange` — 302–304행

하나의 contentChange가 삽입한 텍스트의 시작 위치를, 같은 이벤트에 포함된 다른 변경까지 반영한 최종 문서 좌표로 변환한다. 다중 변경 이벤트에서는 원본 rangeOffset을 그대로 새 marker 위치로 쓰면 틀릴 수 있으므로 필요하다.

#### `validateCloserMarker` — 306–318행

추적한 start/end가 현재 문서 범위 안에 있으며 그 사이의 실제 문자열이 기록한 token과 같은지 확인한다. 삭제되거나 편집된 괄호 marker를 버린다. 과거 구현에서 token 끝이 오른쪽 affinity로 늘어나면 뒤에 입력한 문자까지 포함되어 이 검증에 실패했다.

#### `transformExistingCloserMarkers` — 320–339행

기존 closer marker들을 contentChanges에 맞춰 이동시키고 validateCloserMarker로 살아 있는 것만 남긴다. 0.3.2에서는 토큰 시작은 오른쪽, 끝은 왼쪽 affinity를 사용하여 토큰 직후의 입력이 marker 안으로 들어오지 않게 했다.

#### `appendInsertedCloserMarkers` — 341–371행

새로 삽입된 문자열 안에서 등록된 닫는 토큰을 찾고 최종 문서 offset으로 marker를 생성한다. 기존 문서에 있던 토큰의 이동과 새 토큰의 생성은 별도 단계다. 새 버전의 어휘 검사로 주석·escape·긴 control word 일부를 잘못 기록하는 경우를 줄였다.

#### `storeCloserMarkers` — 373–387행

문서별 marker 목록을 정렬·중복 제거하고 수를 제한해 저장한다. 같은 토큰이 겹쳐 기록되거나 오랜 편집으로 상태가 무한히 늘어나는 것을 방지한다. marker는 메모리에만 있으므로 reload 후 원래 소유권 정보는 남지 않는다.

#### `validateSnippetRange` — 389–395행

스니펫이 삽입했던 전체 범위가 문서 안에 있고 정상적인 순서인지 검사한다. closer 검증과 달리 텍스트가 원본 template와 같은지를 요구하지 않는다. 사용자가 스니펫의 필드를 편집하며 범위가 커지는 것이 정상 동작이기 때문이다.

#### `transformExistingSnippetRanges` — 397–410행

기존 스니펫 전체 span을 growing-range 규칙으로 옮긴다. 이 범위의 끝은 terminal default 여부를 판단하는 Space 동작에 쓰인다. closer처럼 고정 토큰으로 취급하면 정상적인 필드 입력을 추적하지 못한다.

#### `appendInsertedSnippetRanges` — 412–434행

snippetInsertionDepth가 활성화된 동안 들어온 삽입 구간을 스니펫 생성 span으로 기록한다. 이것은 최종 렌더링된 텍스트 범위이고, ${1}/${2} 구조를 파싱하여 별도 엔진을 만드는 기능은 아니다.

#### `storeSnippetRanges` — 436–450행

문서별 스니펫 span을 검증·중복 정리·개수 제한 후 저장한다. Space가 terminal인지 판단할 증거를 보관한다. 현재 사용자 스니펫의 $0이 출력 끝에 위치한다는 설계 전제가 있으므로 임의의 template를 완전히 일반화한 판정은 아니다.

#### `updateCloserMarkers` — 457–483행

문서 변경에서 기존 closer/span을 먼저 이동하고 새 삽입을 분류한다. snippetInsertionDepth가 0보다 크면 snippet-owned로, 그 밖의 일반 타이핑·자동 닫힘·붙여넣기 등은 typed 계열로 기록한다. typed는 반드시 물리 키 한 글자로 생성됐다는 뜻이 아니다. 이 분류가 delimiter 이동과 native 필드 이동의 우선순위를 결정한다.

#### `handleDocumentChange` — 485–488행

문서 변경 이벤트의 중앙 처리기다. 원본은 placeholder와 marker 갱신을 연달아 호출했다. 0.3.2에서는 인지하고 있는 text-neutral boundary transaction을 먼저 확인한다. 최종 텍스트와 정확한 다음 버전이 일치할 때 자체 marker의 의미 없는 삭제·재삽입을 건너뛰고, 일반 변경은 정상 갱신한다. 긴 줄 임시 공백 추적도 여기서 갱신한다.

#### `positionWithinMaximum` — 490–495행

후보 위치가 선택적인 maximumEndOffset 이하인지 검사한다. maximum이 없으면 제한하지 않는다. multiline 탐색에서 현재 추정 placeholder 밖의 구조를 임의로 넘어가지 않도록 하는 구문 탐색 경계다.

#### `createClosingTarget` — 497–531행

찾은 token의 start/end position과 offset, 실제 tokenEnd, block 다음 줄 이동 여부를 하나의 target 객체로 묶는다. token 바로 뒤의 위치와 display block을 빠져나갈 최종 위치를 분리하므로 문서 끝에서 새 줄이 필요할 때도 처리가 가능하다.

#### `getImmediateInlineClosingMatch` — 533–563행

단일 커서의 현재 줄에서 바로 오른쪽에 있는 closer를 찾는다. 설정에 따라 앞쪽 공백을 허용하며 가장 긴 일치 토큰을 사용한다. 일반 괄호와 \right)처럼 복합 토큰이 겹칠 때 짧은 )만 소비하지 않는 것이 중요하다. 선택 중인 범위를 무조건 한 커서로 축소하는 동작은 하지 않아야 한다.

#### `isRecordedClosingMatch` — 570–579행

해당 URI의 marker 목록에서 token과 start/end가 동일한 기록을 찾는다. 현재 커서 앞의 문자가 우연히 같은 기호라는 사실과, 그 기호의 생성 경로가 기록돼 있다는 사실을 구분한다.

#### `isTypedClosingMatch` — 581–583행

isRecordedClosingMatch를 typedClosersByDocument에 적용한다. 스니펫이 아닌 일반 편집 경로에서 생성된 closer라는 증거를 제공하며, 괄호 한 단계 탈출의 근거로 사용된다.

#### `isSnippetOwnedClosingMatch` — 585–587행

동일한 조회를 snippetClosersByDocument에 적용한다. 스니펫이 만든 \frac의 인수 경계나 \left…\right를 수동 괄호로 오인하지 않게 한다. 이런 토큰은 원칙적으로 native tabstop 구조로 이동해야 한다.

#### `findFollowingBracedArgument` — 600–658행

현재 closer가 }일 때 뒤의 공백 등을 지나 다음 {…}를 찾고 중첩 깊이를 세어 균형 잡힌 인수의 내용 start/end를 돌려준다. 원본은 escape를 처리했지만 주석을 충분히 건너뛰지 않았다. 0.3.2는 인수 사이와 내부 주석의 괄호를 무시한다. 결과는 인수 전체의 구문 범위일 뿐 실제 ${2:x}의 정확한 범위가 아니다.

#### `selectionOffsets` — 660–666행

selection의 정렬된 start/end와 방향을 반영하는 active 위치를 document offset으로 표현한다. text 비교·진단·native 전환 비교에서 같은 좌표계를 사용하기 위한 함수다.

#### `selectionIsInsideArgument` — 668–691행

현재 native 이동 결과가 구문 분석으로 찾은 인수 내용 안에 있는지 검사한다. 원본은 인수 전체가 비어 있지 않으면 빈 selection을 실패로 간주했다. 그러나 {prefix ${2} suffix} 안의 빈 native field도 유효하다. 0.3.2는 범위에 포함되는 빈 field를 허용하며 임의의 전체 선택으로 바꾸지 않는다.

#### `selectFollowingArgument` — 693–701행

인수 내용 전체를 editor.selection으로 선택한다. plain 상태에서 구문 기반 편의 기능으로는 의미가 있지만, native 필드 복구라고 부르면 안 된다. 0.3.2에서는 native 세션 경로가 이 함수를 fallback으로 호출하지 않게 했다. 이미 native를 잃은 plain 모드에서는 전체 인수를 선택하는 기존 동작이 남아 있다.

#### `jumpToFollowingArgumentPlaceholder` — 708–744행

native next 명령을 반복하여 실제 선택이 다음 인수 내부에 도달했는지 확인한다. 반복은 최대 32회다. 원본은 지나친 뒤 prev로 되감았으나, 최종 $0 도달로 취소된 session은 prev로 살아나지 않는다. 0.3.2는 유효한 native 목적지를 되감아 조작하지 않고, 다음 field가 인수에 없는 경우에도 실제 이동 결과를 보존한다.

#### `advanceSequentialArgument` — 753–777행

}{를 한 인수에서 다음 인수로 넘어가는 경계로 해석한다. native 모드에서는 원래 placeholder를 따라가 x만 선택하고, plain 모드에서는 구문 인수를 편의상 선택할 수 있다. 원본은 native 실패 후 두 모드를 섞어 \partial x 전체를 선택했다. 0.3.2는 native 경로에서 그 fallback을 금지했다.

#### `isEscapedCharacter` — 779–785행

대상 문자 앞의 연속 backslash 개수를 세어 홀수이면 escape된 것으로 본다. 원시 괄호와 명령의 일부를 구별할 때 사용한다. 완전한 TeX catcode 해석이 아닌 기본적인 문자열 수준 escape 검사다.

#### `hasUnmatchedRoundOpeningBeforeCursor` — 792–814행

현재 줄의 커서 왼쪽에서 닫히지 않은 일반 (가 있는지 계산한다. 확장 reload 전부터 존재하던 텍스트는 typed marker가 없으므로, 상대적으로 명확한 round pair만 어휘적으로 복구하는 보조 경로다. 임의의 {…}를 같은 방식으로 복구하면 명령 인수 경계를 훼손할 수 있어 적용하지 않는다.

#### `shouldEscapeAcrossPlaceholder` — 822–835행

설정이 허용되고 snippet-owned가 아니며, typed 기록 또는 같은 줄의 미닫힌 round pair 증거가 있을 때만 추정 child field 밖의 closer 탈출을 허용한다. 현재 child field가 비어 있거나 이미 닫힌 nested snippet 끝에 있어도 바깥의 typed 괄호를 놓치지 않는 결정 함수다.

#### `detectClosingTarget` — 841–932행

현재 줄의 즉시 closer를 검사하고, 줄의 남은 부분이 비었으면 설정에 따라 다음 비어 있지 않은 비주석 줄을 검사한다. 중간의 일반 텍스트를 넘어 원하는 토큰까지 임의 탐색하지 않는다. snippet 모드에서는 maximumEndOffset으로 범위를 제한한다. 현재 명령 필드와 display block을 혼동하지 않도록 쓰이는 보수적 탐색이다.

#### `executeSilently` — 934–944행

VS Code native command 호출을 감싸고 before/after 진단을 남기며 지원되지 않는 명령 등의 예외를 처리한다. 반환값이 없거나 실패했다고 해서 native session을 새로 구성하지 않는다. 0.3.2에서는 작업 도중 다른 editor로 focus가 바뀌었는지 확인하여 이후 명령이 엉뚱한 문서에 적용되지 않게 한다.

#### `hideSuggestions` — 946–949행

suggestion widget와 inline suggestion을 숨겨 Tab 이동이 자동완성 승인과 섞이지 않도록 한다. exact prefix를 확장할 기회는 이 함수보다 앞선 경로에서 처리해야 한다. 사용자 설정의 모든 suggestion 정책을 변경하는 함수는 아니다.

#### `moveCursor` — 951–955행

selection을 하나의 위치로 만들고 해당 위치를 화면에 보이게 한다. plain navigation에는 필요한 동작이지만, native child range 밖에서 이 함수를 호출하면 session 취소를 유발할 수 있다. 0.3.2의 typed-boundary 경로는 이 함수를 대신 사용하지 않으며 focus guard도 추가했다.

#### `waitForSelectionState` — 957–959행

native 명령 후 선택 변경 알림을 받을 수 있도록 이벤트 루프에 한 번 양보한다. 실행 host와 renderer 사이 RPC 전달 순서 전체를 증명하는 동기화 장치는 아니다. 새 boundary-hop 경로는 특정 목표 위치의 selection 이벤트를 제한 시간 동안 별도로 기다린다.

#### `selectionSnapshot` — 961–970행

start/end/active의 행·열을 별도 객체로 복사한다. reference가 아니라 값으로 보관하므로 전후 selection 비교 시 객체 재사용에 영향을 받지 않는다.

#### `sameSelection` — 972–979행

두 snapshot의 선택 구간과 active 위치가 같은지 검사한다. native next를 눌렀지만 같은 자리에 머무른 숨은 stop과 실제 이동을 구별하는 데 쓰인다.

#### `sameActivePosition` — 981–986행

선택 전체가 아닌 active cursor 위치만 비교한다. 넓은 outer field와 그 끝의 빈 final stop처럼 구간 형태는 달라도 사용자가 보는 커서가 같을 때를 판정한다.

#### `isVisuallyCoincidentTransition` — 998–1008행

같은 selection 또는 같은 active 위치의 특정 native 전환을 시각적으로 겹치는 stop으로 취급한다. ${2}$0가 같은 자리에 있을 때 불필요한 Tab을 줄이는 장치다. 모든 빈 selection을 실패나 다음 필드로 취급하면 안 된다.

#### `jumpToNextDistinctPlaceholder` — 1023–1040행

native next를 실행하고 같은 위치의 중복 stop만 제한 횟수 안에서 건너뛴다. 텍스트 구조를 새로 파싱해 native field를 만드는 기능은 아니다. 원본 outerTypedCloser 분기에서 이 함수를 호출하면 가장 가까운 )가 아니라 다음 field 또는 dm의 $0로 이동했던 것이 이번 직접 원인이다.

#### `documentEol` — 1042–1044행

문서의 EndOfLine 설정에 따라 LF 또는 CRLF 문자열을 반환한다. block을 EOF에서 빠져나가 새 줄을 만들 때 문서의 줄바꿈 형식을 유지한다.

#### `resolveClosingDestination` — 1053–1085행

일반 closer이면 tokenEnd를, 독립된 display closer이면 다음 물리적 줄의 진입 위치를 계산한다. 다음 줄이 없으면 문서 EOL 방식으로 새 줄을 만든다. 다음 줄에 들여쓰기가 있으면 편집 가능한 시작 위치를 고른다. 이 함수는 경우에 따라 텍스트를 실제로 추가한다.

#### `moveAcrossClosingTarget` — 1087–1091행

resolveClosingDestination의 결과로 커서를 옮긴다. plain mode용으로는 적절하지만 native field를 넘는 이동에 그대로 쓰지 않아야 한다. 새 버전은 native block boundary를 별도 보존 경로로 분리했다.

#### `isCollapsedAt` — 1093–1099행

현재 selection이 비어 있고 정확히 지정 위치에 있는지 확인한다. native final-stop 정규화가 선택 중인 다음 필드를 덮어쓰지 않도록 할 때 유용하다.

#### `escapeInnerTokenAndSynchronize` — 1106–1122행

원본은 native next/prev로 내부 상태를 맞춰 보려 한 뒤 커서를 직접 옮겼다. native next가 root $0에 도달한 순간 취소될 수 있어 되감기로 복구할 수 없었다. 0.3.2에서는 이름은 유지하되 boundary-hop의 단일 atomic transaction을 호출한다. 실패하면 강제로 native next나 전체 인수 선택을 하지 않고 멈추고 진단을 남긴다.

#### `tryExpandLongLineSnippetPrefix` — 1136–1243행

VS Code의 짧은 비공백 prefix 스캔에 걸리는 긴 줄에서 보조 확장을 시도한다. 허용 문자로 구성된 마지막 후보 앞에 임시 공백을 넣어 native prefix 인식을 새로 유도하고 native insertSnippet 경로로 확장한 뒤 그 공백을 지운다. 0.3.2는 임시 공백의 위치를 추적하고 finally에서 정리하며 focus 변경·실패 시 문서 전체 snapshot을 되돌리지 않는다. 임의의 매우 긴 순수 문자 token까지 모두 지원하는 일반 parser는 아니다.

#### `expandSnippet` — 1246–1276행

native insertSnippet을 이용해 exact snippet prefix를 확장하고 삽입 전후 텍스트 변화를 확인한다. snippetInsertionDepth 동안 생성된 closer가 snippet-owned로 기록된다. 긴 줄 복구를 함께 시도하며, 명령의 최종 selection을 새 tracked placeholder로 캡처한다. 자체적으로 사용자 snippets 파일 전체를 읽어 별도 snippet engine을 구현하지 않는다.

#### `insertSnippetTemplate` — 1283–1324행

명시적으로 받은 template를 추적 가능한 스니펫 삽입 경로로 보낸다. Alt 단축키 등에서 생성한 토큰도 snippet-owned로 분류되도록 하는 진입점이다. 일반 editor.action.insertSnippet을 외부에서 직접 호출하면 이 extension이 생성 주체를 알 수 없는 경우가 있어, 사용자의 기존 직접 삽입 단축키에서는 이 명령을 사용하는 것이 설계상 일관된다.

#### `selectionExactlyMatchesUntouchedTrackedPlaceholder` — 1332–1347행

현재 선택 구간이 캡처한 field와 완전히 같고 편집되지 않았는지 확인한다. 단순히 무언가 선택돼 있다는 이유만으로 Space가 원래 선택 내용을 보존하지 않도록 한다.

#### `selectionEndsAtRecordedSnippetEnd` — 1356–1369행

현재 선택의 끝이 기록된 생성 스니펫 span의 끝에 닿는지 검사한다. terminal field와 뒤에 다른 의미 있는 구조가 있는 이전 field를 구분한다. 임의의 잘못된 span이나 비표준 $0 배치까지 판별할 수는 없다.

#### `typeDefaultText` — 1372–1374행

VS Code default:type로 문자를 넣어 일반 입력의 선택 대체 동작을 보존한다. Space 특례가 적용되지 않을 때 사용하는 정상 경로다.

#### `insertContinuationSpace` — 1383–1439행

아직 편집하지 않은 terminal default가 정확히 선택된 때만 그 기본값을 보존하고 뒤에 공백을 넣는다. 이전 field이거나 이미 수정한 field이면 정상적으로 선택을 공백으로 대체한다. 분모·합의 끝 field·닫는 delimiter 앞 field를 똑같이 취급하지 않도록 두 보조 판정이 필요하다. 0.3.2는 기존 정책을 유지하고 회귀 검사를 추가했다.

#### `navigateSnippet` — 1447–1542행

native snippet mode에서의 Tab dispatch 본체다. 원본은 sequential argument → snippet-owned → 내부 closer → outer typed 순으로 판단했으며 outer typed에 native-next를 적용했다. 0.3.2는 typed/unowned 가까운 closer를 먼저 한 단계 탈출시키고, snippet-owned 인수 구조에는 native 이동을 사용한다. 다중 선택은 native에 위임하고, block 종료 정규화는 선택 중인 다음 field를 덮어쓰지 않을 때만 한다.

#### `navigatePlain` — 1545–1579행

snippet mode 밖에서의 Tab 처리다. 긴 줄 prefix 복구 후 가까운 closer를 넘어가고, }{이면 balanced argument 전체 선택 편의를 제공한다. 그 밖에는 native tab으로 넘긴다. 이미 취소된 native session의 원래 ${2:x} 범위를 복원하는 엔진이 아님을 분명히 해야 한다.

#### `activate` — 1581–1618행

다섯 편집 명령과 문서 변경·선택 변경·문서 닫기 이벤트를 등록한다. close 시 문서별 Map을 지운다. 실제 module.exports.activate 래퍼는 여기에 진단 및 host regression 명령을 추가한다. 0.3.2에서는 편집 명령을 직렬화 래퍼로 등록하여 비동기 Tab 요청 간의 겹침을 줄였다.

#### `__readEvents` — 1621–1621행

진단 배열을 JSON serialize/parse로 깊은 복사하여 반환한다. host 검사나 로그 export가 내부 배열을 실수로 수정하지 않도록 한다. 녹화된 본문을 자동 전송하는 함수는 아니다.

#### `deactivate` — 1622–1628행

placeholder, 문서별 closer/span, 삽입 depth 등 메모리 상태를 초기화한다. 0.3.2는 boundary transaction과 임시 probe 상태도 정리한다. 이미 실행 중인 외부 native 세션을 재구성하거나 저장하지 않는다.

#### `resetEvents` — 1634–1638행

진단 목록을 비우고 녹화를 켜며 현재 문서 URI에 범위를 고정한다. host test에서는 각 case 시작 시 호출하여 다른 문서의 이벤트를 섞지 않는다.

#### `stopRecording` — 1639–1639행

진단의 활성 플래그를 끈다. 이미 모아 둔 이벤트를 즉시 삭제하지는 않으므로 검사 결과로 읽거나 JSON으로 내보낼 수 있다.

### 4.3. `test/host-regression.js`

#### `snapshot` — 10–15행

현재 document text와 cursor/selection offset을 값으로 읽어 테스트 증거를 만든다. 원본은 최종 selection 확인에 주로 사용했고, 새 host suite는 각 Tab 중간 상태도 저장한다.

#### `command` — 16–21행

테스트가 VS Code 명령을 실행하고 selection 이벤트가 반영될 기회를 준다. API command 실행은 물리 키보드 Tab을 누른 것과 동일한 검증이 아니므로 보고서에서 구분한다.

#### `type` — 22–24행

테스트 문자열을 native default:type 경로로 입력한다. 손으로 selection을 바꿔 기대 상태를 만들어 버리는 테스트를 피하고 실제 삽입·자동 pair 동작을 사용하려는 목적이다.

#### `requireCondition` — 25–27행

테스트 조건이 false이면 설명과 함께 실패시킨다. assertion 실패를 숨기고 다음 단계만 진행하면 잘못된 최종 통과가 생기므로 각 조건의 의미를 명확히 해야 한다.

#### `newDocument` — 28–32행

테스트용 새 untitled LaTeX 문서를 열고 해당 editor를 활성화한다. 사용자의 기존 파일 본문을 검사 목적으로 직접 수정하지 않는 격리 장치다.

## 5. 익명 callback, 검사 본문, metadata까지의 해설

### 5.1 `module.exports.activate` 래퍼

먼저 내부 activate를 호출해 편집 명령과 이벤트를 등록하고, 이어서 diagnosticsStart/Mark/Export와 runRegressionChecks를 추가 등록한다. 반환 API의 readEvents/resetEvents/stopRecording은 host fixture에서 진단을 수집할 때 사용한다. 별도 두 개의 독립 확장이 아니라 하나의 activation의 두 층이다.

진단 시작 callback은 LaTeX editor를 확인한 뒤 버전·설정과 recording:start를 기록한다. Mark는 keybinding args로 들어온 native context를 기록한다. Export는 새 JSON 문서에 이벤트를 표시하며 파일을 자동 전송하지 않는다. 새 기본 Tab route는 context:keybinding에도 실제 when 상태를 남긴다. selection이 비었다는 사실로 inSnippetMode를 거짓 추론하지 않는다.

Run Regression Checks callback은 UI progress 안에서 host suite를 호출한다. **원본 VSIX에 host 검사 코드가 들어 있었다는 사실 자체가 그 버전이 실제 host에서 통과했다는 증거는 아니다.** 이번 0.3.2에도 같은 구분을 적용했다.

onDidChangeTextEditorSelection callback은 진단용이다. onDidChangeTextDocument는 범위·토큰·probe 갱신을 수행한다. onDidCloseTextDocument는 해당 URI의 상태를 삭제한다. 이벤트 처리와 native command 완료의 전달 순서는 extension host와 renderer 사이 비동기 경계 때문에 실제 host에서 따로 확인해야 한다.

### 5.2 원본 `test/host-regression.js`의 `exports.run`

원본은 새 문서에 스니펫을 넣고 native type/next/prev를 실행하며 pd 및 일반 인수의 최종 선택, plain 괄호와 display 종료를 검사했다. A–E 등 pd 변형과 일반 delimiter case를 포함했지만, 중간 Tab에서 반드시 `)` 뒤에 멈춰야 한다는 엄격한 요구가 없었다. 그래서 최종적으로 x에 도착하기만 하면 사용자가 원하지 않는 중간 단계 건너뛰기를 허용할 수 있었다.

새 suite는 각 case의 문서·선택을 기록하고, x/y 같은 최종 field뿐 아니라 `{z|}` → `{z}|)` → `{z})|` → 다음 field의 **중간 목적지**를 검사한다. native prev/next 왕복도 검사하여 문자열만 우연히 맞춘 selection과 구별한다. physicalTabTest=false이면 API command 경로이며 OS 키 입력 검증이 아니다.

### 5.3 package.json

name/publisher는 기존 확장 ID `local-latex.latex-smart-tab-dispatcher`를 유지한다. version만 0.3.2로 올리고 displayName에 Candidate를 표시했다. engines `^1.99.0`은 설치 허용 범위이지 모든 그 버전 조합을 테스트했다는 뜻이 아니다. extensionKind workspace이므로 원격/WSL 창에서 어느 host에 설치·실행되는지도 중요하다. main은 `./extension.js`이며 런타임 npm 패키지 의존성은 없다.

활성화 이벤트는 시작 후와 확장 command 실행을 포함한다. commands는 5개 편집 명령, 3개 진단 명령, 1개 회귀 검사 명령이다. 새 scripts는 로컬 테스트, 실제 host runner, 표준 라이브러리만 사용하는 VSIX packager를 제공한다. 테스트 runner 의존성은 런타임 의존성과 별개다.

원본 keybindings에는 Space와 4개 진단 context 조합만 있고 기본 Tab route는 없었다. 기존 사용자 keybindings에 의존한 구조다. 0.3.2는 기본 Tab route를 추가하되 `latexSmartTab.enableDefaultTabKeybindings=false`로 끌 수 있다. 사용자 keybinding이 이미 등록돼 있으면 그것이 우선할 수 있으며 자동으로 사용자의 JSON을 덮어쓰지 않는다. prefix route가 navigation route보다 높은 순서에 있어 exact snippet을 우선하고, suggestion 승인 정책은 사용자 설정의 영향을 받는다.

### 5.4 README, CHANGELOG, LICENSE, XML

원본 README의 “`)` Tab에서 바로 x 선택 가능” 정책을 제거하고 한 단계 탈출을 명시했다. 원본 CHANGELOG가 언급한 redacted baseline trace라는 별도 파일은 실제 추출 ZIP 목록에 없으므로 존재한다고 재주장하지 않는다. source bundle은 대신 원본 0.3.1 코드와 재현 negative control을 포함한다.

원래 LICENSE의 2026 local-latex MIT notice를 그대로 보존했다. 테스트에서 VS Code marker 알고리즘을 각색한 파일은 Microsoft notice와 별도 전체 MIT license를 함께 포함한다. 사용자의 다른 저장소나 스니펫에 대해 새로운 소유권·라이선스를 임의 선언하지 않는다.

extension.vsixmanifest는 ID/publisher/version/displayName/engine과 package/README/CHANGELOG/license asset 경로를 선언한다. 새 packager가 package.json과 같은 버전을 생성한다. [Content_Types].xml은 js/json/md/txt/xml/py 등의 형식을 확장자 점 없이 선언한다. ZIP 안 경로는 `extension/…`이며 manifest와 content types는 root에 둔다. GalleryFlags가 있다 해도 Marketplace에 실제 공개 게시했다는 뜻은 아니다. 이번 작업은 로컬 VSIX 생성이며 원격 게시를 하지 않았다.

## 6. 수정 방법: 텍스트 불변 경계 이동

### 6.1 단일 atomic edit

현재 cursor offset을 p, 넘어갈 가장 가까운 closer 끝을 q, 원문 `text[p:q]`를 literal이라고 하자. 한 번의 `editor.edit` 안에서 다음 두 작업을 제출한다.

```js
builder.insert(positionAt(p), literal);
builder.delete(new vscode.Range(positionAt(p), positionAt(q)));
```

빈 삽입 `[p,p)`과 삭제 `[p,q)`는 경계가 닿지만 겹치지 않는다. VS Code의 공개 TextEditorEdit 구현은 insert와 delete에 forceMoveMarkers=true를 지정한다. 기존 구간 삭제와 동일 문자열 재삽입을 하나의 적용으로 처리하여 **최종 문서 텍스트는 그대로 두고 native tracked point와 caret을 새 경계로 옮기는 방식**이다. native placeholder를 새로 만들거나, 다음 field를 먼저 선택하거나, 현재 child 밖으로 직접 selection을 강제하지 않는다.

`replace(range, sameText)`로 단순화하면 안 된다. replace의 forceMoveMarkers는 false라 marker 이동 의미가 달라진다. 두 번의 별도 editor.edit로 나누면 중간에 문자열 중복·삭제 상태가 노출되어 concurrent typing과 충돌할 수 있다. 전체 문서 snapshot을 사후 restore하는 방식도 사용하지 않는다.

이 방법은 VS Code 공개 API와 실제 marker 갱신 알고리즘을 근거로 구현했다. 하지만 **renderer의 최종 caret 이동 및 session 유지까지 이번 환경에서 실측한 것은 아니다.** 로컬에서는 upstream marker kernel을 각색한 검사와 behavioral editor model로 검증했다. 실제 host용 검사에 같은 조건과 prev/next 왕복을 넣었다.

### 6.2 boundary-hop.js의 네 함수

`planBoundaryHop(text, from, to)`는 문자열과 UTF-16 범위를 검증하고 이동할 literal만 추출한다. `cursorAt`은 실제 editor selection이 목표 offset에 있는지 확인한다. `settleCursor`는 이미 도착했으면 종료하고, 아니라면 해당 editor의 selection 이벤트를 최대 150ms 기다린다. 이 시간은 작업 소요 안내가 아니라 코드 내부의 제한된 실패 감지 timeout이다.

`hopBoundary`는 같은 활성 editor, 단일 빈 selection, 열린 문서를 요구한다. 원문·버전·구간으로 transaction을 등록하고 atomic edit을 실행한다. edit 거절, focus 변경, 동시 입력, 예상하지 못한 문서 버전 변화, 목표 caret 미도달을 구분한다. 실패 시 임의의 native next 또는 강제 selection으로 덮지 않고 안전하게 종료한다. finally에서 자기 transaction만 정리한다. 동시 입력을 감지했다고 해서 기존 내용을 통째로 되돌리지 않는다.

### 6.3 새 runtime 보조 함수

`serializeEditorCommand`는 요청 당시 editor를 캡처하고 5개 편집 명령을 순서대로 실행한다. 대기 중 닫혔거나 focus가 바뀐 문서에 대한 명령은 중단한다. 예외는 진단과 상태줄로 노출하고 queue가 영구적으로 끊어지지 않게 한다.

`updateTransientProbe`는 긴 줄 native prefix 복구용으로 넣은 공백 한 글자의 생성·이동·유효성을 추적한다. 편집된 공백을 무조건 지우지 않고 실제 그 문자와 marker가 살아 있을 때만 정리한다.

`escapeBlockInSnippet`는 block 다음 줄 목적지를 계산한 뒤 native 경계를 보존하는 hop 경로로 이동한다. `normalizeNativeBlockExit`는 native가 block closer 직후 빈 stop에 도착한 경우에만 다음 물리 줄 진입을 정규화한다. 다음 field가 이미 선택됐거나 더 뒤의 유효한 목적지에 도착했다면 덮어쓰지 않는다.

core의 `isEscapedAt`은 backslash parity, `isInLineComment`는 같은 줄의 unescaped %, `isValidTokenStart`는 앞 두 조건과 control-word 마지막 알파벳 경계를 검사한다. 따라서 `\rangle`를 `\rangles`의 앞부분으로 잘못 소비하지 않는다. 이는 완전한 TeX parsing을 추가한 것이 아니라 기존 token matcher의 경계 조건 보강이다.

### 6.4 부수 효과와 선택한 trade-off

텍스트는 같아도 edit transaction이므로 문서 버전·dirty 상태·undo 그룹과 다른 extension의 change listener에 영향을 줄 가능성이 있다. undoStopBefore/After=false로 별도 불필요 stop을 줄였지만, native 상태가 undo 이전과 완전히 같아지는지까지 보장하지 않는다. host suite에 undo/redo 후 **텍스트 무결성** 검사를 넣었다. 실제 host 통과 전에는 이 trade-off 때문에 Candidate 표기를 유지한다.

## 7. 기대 동작과 회귀 방지 규칙

`|`는 커서, `⟦…⟧`는 선택 구간을 뜻한다.

```text
L(\theta{}|)   -- Tab -->   L(\theta{})|
                                  |
                   다음 Tab에서만 dm 종료로 진행

\frac{\partial f(\bm{z|})}{\partial x}
   Tab 1: \frac{\partial f(\bm{z}|)}{\partial x}
   Tab 2: \frac{\partial f(\bm{z})|}{\partial x}
   Tab 3: \frac{\partial f(\bm{z})}{\partial ⟦x⟧}
```

스니펫이 만든 인수 경계와 사용자가 넣은 괄호를 구별한다. `}{` 자체를 의미 없는 stop으로 추가하지 않는다. 이미 있는 native field의 일부 literal인 `\partial` 또는 `prefix`를 자동으로 선택 영역에 포함하지 않는다. 같은 위치의 continuation/$0를 건너뛰는 기존 기능은 유지하지만, 실제 괄호 하나를 넘는 시각적 단계는 삭제하지 않는다.

## 8. 검사 설계와 결과의 정확한 의미

| 검사 층 | 이번 실행 | 의미 |
|---|---|---|
| 원본 ZIP CRC / Git blob hash | 통과 | 실제 대상 원본을 해부했다는 증거 |
| Node 로컬 검사 | 119/119 통과 | pure logic, native-marker model, 상태 전이, 실패 경로 |
| 원본/과거 문제 negative control | 위 119개 안의 5개 통과 | 원본 문제 또는 위험 경로를 테스트가 실제로 잡는지 확인 |
| 실제 host용 fixture의 model smoke | 42/42 통과 | fixture assertion 자체의 일관성, **real host 통과 아님** |
| 실제 VS Code Extension Host | 미실행 | 실행 프로그램/runner 부재 및 네트워크 제한 |
| OS 물리 Tab / 사용자 keybinding | 미실행 | 선택 위치 API 검사와 별개 |
| 이전 모든 버전 binary 실행 | 수행하지 않음 | 기록된 사례를 검사에 옮겼으나 모든 과거 binary를 확보·실행한 것은 아님 |

119에는 데이터 조합으로 여러 사례를 한 번에 훑는 property test가 포함된다. 각 1,000조합을 확인한 두 property test도 각각 하나의 검사로 세었으며 “2,000개 버그 수정”이라고 세지 않는다. 42개 fixture의 모델 smoke 역시 119의 일부 테스트 안에서 호출되므로 119+42를 독립 검증 개수로 합산하지 않는다.

원본 0.3.1 negative control은 theta→dm 탈출, pd의 ) 단계 건너뛰기, 내부 field의 root final-stop 취소, token 끝 affinity 문제를 재현했다. 과거 pd whole-argument 사례는 unsafe direct move→세션 취소→fallback의 경로를 replay한 검사다. **0.3.0 binary를 실행해 통과·실패를 측정했다고 표현하지 않는다.**

### 기록된 문제군별 커버리지

| 문제군 | 넣은 검증 |
|---|---|
| theta/dm, 일반 () | 자동 pair와 수동 pair, nested 유무, outer FOLLOW field 생존 |
| pd 분모 전체 선택 | nested bv/hat, 괄호 유무, display wrapper, native prev/next 왕복 |
| 범용 연속 인수 | ()/[]/{}, prefix와 suffix가 있는 다음 field, 빈 field |
| 깊은 중첩 | 40개 typed closer, 새 placeholder 증가 없이 한 단계씩 이동 |
| coincident final stop | continuation과 $0가 같은 위치, 불필요 빈 Tab 방지 |
| frac/subscript/sum/bar | 내부 토큰 우선, 이후 native 인수 이동 |
| 긴 줄 스니펫 | 99/100/101/250/1,000자 경계, static ff와 ;th prerequisite, probe 정리 |
| Space | untouched terminal 보존, earlier field 대체, 편집한 default, closer 앞 field |
| block 종료 | LF/CRLF, EOF, 다음 줄 들여쓰기, nested block의 outer field 생존 |
| 문자 해석 | escape, 주석 괄호, control-word 경계, UTF-16 문맥 |
| 동시성/실패 | 빠른 명령 queue, focus 변경, edit 거절, concurrent typing 보존 |
| 다중 selection | 단일 커서로 축소하지 않고 native 위임 |

현재 실제 host용 42개 case의 이름과 모델 결과는 `verification/host-fixture-model-smoke.json`에 있다. 실제 host를 실행하면 그때의 버전과 actualExtensionHost/physicalTabTest를 별도 JSON으로 기록하도록 했다.

## 9. 검사 코드·도구 구성

`test/unit/core.test.js`는 순수 offset/token/parser, text-identity 계획, VS Code marker kernel의 경계 법칙을 검사한다. `navigation.test.js`는 추출 코드를 fake vscode API에 로드해 stateful navigation을 수행한다. `baseline.test.js`는 수정본만 통과하도록 기대값을 완화한 것이 아닌지 원본 negative control을 실행한다. `host-suite-smoke.test.js`는 real host용 fixture를 model에 로드하되 실행 환경을 명시적으로 MODEL-NOT-VSCODE라고 기록한다.

`test/support/model-host.js`는 문서·selection·content event·native placeholder 이동·취소·스니펫 삽입의 계약을 흉내 낸 모델이다. 이 파일을 실제 renderer/extension host로 착각해서는 안 된다. `vscode-markers.js`는 upstream intervalTree의 marker-edit 로직을 테스트 범위로 각색했으며 출처와 라이선스를 포함한다. 두 모델의 가정 밖의 API 차이는 실제 host 검사로만 확인할 수 있다.

`test/host-regression.js`는 현재 설치된 VS Code API에서 실행할 검사 본문이다. 새 untitled 문서를 사용하고 검사 중 focus가 다른 editor로 바뀌면 중단한다. 기존 파일 텍스트나 사용자 settings.json을 덮어쓰지 않는다. 기본 설정/스니펫 fixture가 빠진 환경에서는 관련 case가 실패 또는 미실행으로 표시되며, 이를 성공으로 바꾸지 않는다.

`test/host-entry.js`는 @vscode/test-electron 진입점이다. 개발 확장을 활성화하고 report를 지정 경로에 쓴다. SMART_TAB_PHYSICAL=1일 때 Linux의 xdotool을 사용해 물리 Tab을 보내는 별도 경로를 켠다. 이것은 이번 결과에서 실행됐다고 표시되지 않는다.

`scripts/run-host-tests.js`는 별도 temp user-data/extensions 폴더에 테스트 fixture 확장과 격리 settings를 만들고 실행 종료 후 지운다. @vscode/test-electron과 실제 VS Code binary가 필요하다. VSCODE_EXECUTABLE을 지정하면 기존 설치를 사용할 수 있고, 없으면 runner가 선택한 버전을 받으려 한다. 테스트 fixture 확장은 운영 설치에 자동 활성화되는 extension이 아니다.

`scripts/package.py`는 Python 표준 라이브러리로 package.json을 검증하고 manifest/content types를 생성한다. 파일 순서·ZIP 시간·권한·압축을 고정하여 같은 입력에서 같은 VSIX를 생성한다. node_modules, .git, .vscode-test, 임시 report와 기존 vsix는 포함하지 않는다. 서명하거나 Marketplace에 게시하는 도구가 아니며 외부 네트워크가 필요 없다.

## 10. 재현 및 검증 방법

source bundle의 `source/`에서 `npm test`를 실행하면 Node 기본 test runner로 로컬 검사를 수행한다. VSIX 생성은 `python3 scripts/package.py --output ../latex-smart-tab-dispatcher-0.3.2.vsix`다. 실행 의존성을 별도 설치하지 않아도 로컬 검사와 패키징은 가능하다.

실제 host 검사에는 `npm install --no-save @vscode/test-electron` 후 `npm run test:host`를 사용한다. Linux headless에서는 Xvfb가 필요할 수 있다. 기존 VS Code executable을 이용할 경우 VSCODE_EXECUTABLE을 지정한다. 사용자와 동일한 VS Code 버전에서 검사하는 편이 이번 버그의 수용 기준에 맞다.

설치된 확장에서 직접 확인할 경우 Command Palette의 `LaTeX Smart Tab: Run Regression Checks`를 실행한다. report의 failed/skipped/aborted와 actualExtensionHost를 함께 확인한다. API 검사가 통과하더라도 평소 사용하는 ;th/Tab, pd/bv/Tab 조합의 물리 keybinding 확인은 별도다.

## 11. 범위와 남은 불확실성

이번 구현은 현재 확보한 원본·대화·기존 README/CHANGELOG에 기록된 문제를 회귀 대상으로 삼았다. 모든 과거 버전의 모든 미기록 오류, 사용자 컴퓨터의 현재 설정·확장 조합, 모든 임의 snippet template까지 “재발 불가능”하다고 보장하지 않는다.

특히 actual Extension Host의 edit/RPC/caret 반영, 다른 extension과 동시 수정, 사용자 keybinding 우선순위, undo로 native 세션이 복원되는 범위, reload 후 이전 token 소유권은 추가 실사용 확인 대상이다. core는 완전한 TeX parser가 아니므로 verbatim/catcode/custom delimiter 의미를 모두 이해하지 않는다. 이미 외부 요인으로 native session이 취소된 plain 모드에서는 원래의 ${2:x} 경계를 알 수 없어 lexical fallback이 여전히 근사적이다.

GitHub에 테스트 브랜치를 만들려 했으나 integration이 HTTP 403을 반환했다. **원격 branch/commit/PR 생성 및 main 변경은 이루어지지 않았다.** 결과는 첨부한 VSIX와 source bundle이다.

## 12. 1차 자료

- 사용자 저장소의 기준 commit 및 VSIX: `02de4c8c30caafa8113595dfb535d073d395ee7d`, blob `3e9befeca417ce177d9ae3d77d4ab9afa94bb6c7`.
- Microsoft VS Code `src/vs/editor/contrib/snippet/browser/snippetController2.ts`: native final stop / selection containment에 의한 취소. 조회 blob `43611a9fc6287030687b4147a2dcfe1a4a7527d2`.
- Microsoft VS Code `src/vs/editor/contrib/snippet/browser/snippetSession.ts`: nested merge의 parent decoration 교체. 조회 blob `818139c2af37a7359e13c1d11f9e0115882fc0fd`.
- Microsoft VS Code `src/vs/workbench/api/common/extHostTextEditor.ts`: insert/delete의 forceMoveMarkers, replace 차이, touching-edit validation. 조회 blob `b523bf14a82824859161f87117d08e9fb18a4fc1`.
- Microsoft VS Code `src/vs/editor/common/model/intervalTree.ts`: nodeAcceptEdit 및 adjustMarkerBeforeColumn. 조회 blob `ada8cbdffd181260c7244b6f59873631a21e7b96`.
- 공식 스니펫 설명: https://code.visualstudio.com/docs/editing/userdefinedsnippets
- 공식 Extension Host 검사 설명: https://code.visualstudio.com/api/working-with-extensions/testing-extension

조회한 upstream main의 소스는 사용자 VS Code binary와 동일한 버전이라는 뜻이 아니다. 실제 지원 버전별 수용 검증은 별개다.

## 부록 A. 설정별 정확한 기본값

### `latexSmartTab.skipBlankChar`

cursor와 closer 사이 공백을 건널지 결정한다. 일반 텍스트를 넘어 찾는 옵션은 아니다.

기본값:
```json
true
```

### `latexSmartTab.enableMultilineMode`

현재 줄의 나머지가 비었을 때 다음 비공백/비주석 줄에서 closer를 찾는다. 추정 placeholder 범위 제한은 계속 적용된다.

기본값:
```json
true
```

### `latexSmartTab.escapeTypedClosersAcrossPlaceholder`

child 범위 밖이어도 typed/auto-pair 또는 회복 가능한 round closer를 먼저 넘는 정책을 켠다.

기본값:
```json
true
```

### `latexSmartTab.recoverSequentialArguments`

명령의 연속 인수 }{를 native 다음 field 전환으로 처리한다. native와 plain fallback의 차이는 본문 참조.

기본값:
```json
true
```

### `latexSmartTab.recoverLongLineSnippetPrefixes`

100자 native suffix 탐색이 실패하는 조건에서 임시 공백을 이용한 복구를 허용한다.

기본값:
```json
true
```

### `latexSmartTab.prefixProbeCharacters`

긴 줄 복구 후보로 간주할 문자 집합. 기본은 영문·숫자·밑줄·세미콜론이다.

기본값:
```json
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_;"
```

### `latexSmartTab.preserveUntouchedTerminalDefaultOnSpace`

아직 수정하지 않은 terminal default를 Space로 대체하지 않고 뒤에 공백을 넣는 특례.

기본값:
```json
true
```

### `latexSmartTab.closingTokens`

일반적으로 넘을 수 있는 literal token 목록. 긴 것부터 검사하며 런타임은 deduplicate한다.

기본값:
```json
[
  "\\end{multline}",
  "\\end{multline*}",
  "\\end{gather}",
  "\\end{gather*}",
  "\\end{flalign}",
  "\\end{flalign*}",
  "\\end{alignat}",
  "\\end{alignat*}",
  "\\end{displaymath}",
  "\\end{equation*}",
  "\\end{equation}",
  "\\end{align*}",
  "\\end{aligned}",
  "\\end{align}",
  "\\end{bmatrix}",
  "\\end{pmatrix}",
  "\\end{vmatrix}",
  "\\end{Vmatrix}",
  "\\end{cases}",
  "\\right\\rangle",
  "\\right\\}",
  "\\right)",
  "\\right]",
  "\\rangle",
  "\\)",
  "\\]",
  "}",
  ")",
  "]"
]
```

### `latexSmartTab.exitBlockClosersToNextLine`

독립 display closer 뒤가 아니라 다음 물리 줄로 나가게 한다.

기본값:
```json
true
```

### `latexSmartTab.blockClosingTokens`

독립 줄에서 display 종료로 취급할 token 목록. matrix/aligned 같은 nested token은 기본에서 제외한다.

기본값:
```json
[
  "\\]",
  "\\end{displaymath}",
  "\\end{equation*}",
  "\\end{equation}",
  "\\end{alignat*}",
  "\\end{alignat}",
  "\\end{align*}",
  "\\end{align}",
  "\\end{flalign*}",
  "\\end{flalign}",
  "\\end{gather*}",
  "\\end{gather}",
  "\\end{multline*}",
  "\\end{multline}"
]
```

### `latexSmartTab.enableDefaultTabKeybindings`

0.3.2 추가. 기본 Tab route를 켜지만 사용자 keybinding을 수정·삭제하지 않는다.

기본값:
```json
true
```

## 부록 B. 수정 후 함수 위치

정확한 AST 집계 결과는 동봉한 `function-inventory.json`과 같다.

### `extension.js`

- `__trace`: 9–27행
- `serializeEditorCommand`: 139–158행
- `documentKey`: 160–162행
- `sameDocument`: 164–170행
- `documentLength`: 172–174행
- `clamp`: 176–178행
- `captureCurrentPlaceholder`: 180–198행
- `clearTrackedPlaceholder`: 200–205행
- `changeTouchesRange`: 207–220행
- `updateTrackedPlaceholder`: 222–251행
- `getTrackedPlaceholder`: 253–277행
- `readConfigForResource`: 279–325행
- `readConfig`: 327–329행
- `newOffsetForChange`: 331–333행
- `validateCloserMarker`: 335–347행
- `transformExistingCloserMarkers`: 349–368행
- `appendInsertedCloserMarkers`: 370–400행
- `storeCloserMarkers`: 402–416행
- `validateSnippetRange`: 418–424행
- `transformExistingSnippetRanges`: 426–439행
- `appendInsertedSnippetRanges`: 441–463행
- `storeSnippetRanges`: 465–479행
- `updateCloserMarkers`: 486–512행
- `updateTransientProbe`: 515–534행
- `handleDocumentChange`: 536–550행
- `positionWithinMaximum`: 552–557행
- `createClosingTarget`: 559–593행
- `getImmediateInlineClosingMatch`: 595–625행
- `isRecordedClosingMatch`: 632–641행
- `isTypedClosingMatch`: 643–645행
- `isSnippetOwnedClosingMatch`: 647–649행
- `findFollowingBracedArgument`: 662–732행
- `selectionOffsets`: 734–740행
- `selectionIsInsideArgument`: 742–756행
- `selectFollowingArgument`: 758–766행
- `jumpToFollowingArgumentPlaceholder`: 773–791행
- `advanceSequentialArgument`: 800–825행
- `isEscapedCharacter`: 827–833행
- `hasUnmatchedRoundOpeningBeforeCursor`: 840–862행
- `shouldEscapeAcrossPlaceholder`: 870–883행
- `detectClosingTarget`: 889–980행
- `executeSilently`: 982–995행
- `hideSuggestions`: 997–1000행
- `moveCursor`: 1002–1009행
- `waitForSelectionState`: 1011–1013행
- `selectionSnapshot`: 1015–1024행
- `sameSelection`: 1026–1033행
- `sameActivePosition`: 1035–1040행
- `isVisuallyCoincidentTransition`: 1052–1062행
- `jumpToNextDistinctPlaceholder`: 1077–1094행
- `documentEol`: 1096–1098행
- `resolveClosingDestination`: 1107–1139행
- `moveAcrossClosingTarget`: 1141–1145행
- `escapeBlockInSnippet`: 1148–1154행
- `normalizeNativeBlockExit`: 1157–1172행
- `isCollapsedAt`: 1174–1180행
- `escapeInnerTokenAndSynchronize`: 1188–1198행
- `tryExpandLongLineSnippetPrefix`: 1212–1271행
- `expandSnippet`: 1274–1304행
- `insertSnippetTemplate`: 1311–1352행
- `selectionExactlyMatchesUntouchedTrackedPlaceholder`: 1360–1375행
- `selectionEndsAtRecordedSnippetEnd`: 1384–1397행
- `typeDefaultText`: 1400–1402행
- `insertContinuationSpace`: 1411–1467행
- `navigateSnippet`: 1470–1524행
- `navigatePlain`: 1527–1566행
- `activate`: 1568–1607행
- `__readEvents`: 1610–1610행
- `deactivate`: 1611–1620행
- `resetEvents`: 1626–1630행
- `stopRecording`: 1631–1631행

### `core.js`

- `mapOffset`: 9–41행
- `transformRange`: 44–53행
- `transformTokenRange`: 60–69행
- `findLongLineSnippetPrefixProbe`: 86–154행
- `normalizeClosingTokens`: 156–159행
- `isEscapedAt`: 162–166행
- `isInLineComment`: 168–174행
- `isValidTokenStart`: 176–181행
- `findInlineClosingMatch`: 184–212행
- `findInlineClosingTarget`: 219–238행
- `findClosingTokensInInsertedText`: 244–272행
- `hasOnlyIgnorableLineTail`: 275–278행
- `isStandaloneBlockCloser`: 286–302행
- `nextLineEntryCharacter`: 305–308행

### `boundary-hop.js`

- `planBoundaryHop`: 21–25행
- `cursorAt`: 27–29행
- `settleCursor`: 31–50행
- `hopBoundary`: 52–86행

### `test/host-regression.js`

- `check`: 11–11행
- `snap`: 12–16행
- `command`: 22–26행
- `insert`: 27–27행
- `type`: 28–31행
- `snapshot`: 32–32행
- `tab`: 33–44행
- `pair`: 45–52행
- `roundTrip`: 53–64행
- `one`: 65–79행
