# Jupyter 커널 상태와 시작 지연 조사

확인 시각: 2026-11-09 16:47 KST. 프로젝트: `/home/minseok/paper_implementation/ACSSM_implementation`.

## 여러 Notebook과 하나의 커널

여러 Notebook의 셀을 하나의 실행 중인 Jupyter 커널로 보내는 것은 가능하다. 같은 Python 환경을 고르는 것만으로는 커널을 공유하지 않는다. 현재 VS Code의 로컬 Python 환경 선택은 Notebook마다 별도 프로세스를 시작한다.

현재 환경에서 별도의 임시 커널을 약 1.01초에 시작했고, 서로 다른 통신 세션을 가진 두 Jupyter 클라이언트 A/B로 검증했다. A가 저장한 값 37을 B가 같은 프로세스에서 읽었으며 작업 폴더도 프로젝트 경로였다. 검증용 커널은 종료·정리했다. 이는 Jupyter 프로토콜 수준의 검증이며 VS Code Notebook UI 두 개를 직접 조작한 결과는 아니다.

VS Code에서 파일별 셀 편집기를 사용하면서 같은 커널에 연결하려면, 일반적인 방법은 Jupyter 서버에서 실행 중인 커널을 만들고 각 Notebook의 커널 선택기에서 **Existing Jupyter Server**를 통해 그 동일한 실행 중 커널에 연결하는 것이다. 같은 환경 이름이나 kernelspec을 선택해 새 세션을 만드는 것은 다르다. 현재는 실행 중 Jupyter 서버가 없으며, 사용자 site를 제외한 base/acssm 환경에는 `jupyterlab`과 `jupyter_server` 모듈도 없다. 서버 공유 구성을 사용하려면 서버 패키지 설치·설정이 추가로 필요하다. 이번 조사에서는 설치하거나 서버를 상시 실행하지 않았다.

하나의 커널을 공유하면 변수, import 상태, 현재 작업 폴더와 재시작 영향도 공유된다. 일반 Python 커널의 셀 요청은 순서대로 처리되므로 커널 공유가 여러 셀의 CPU 병렬 실행을 뜻하지는 않는다.

## 현재 상태

| Notebook | PID | kernel_info 응답 |
|---|---:|---:|
| `3_locally_linear_approximation.ipynb` | 87141 | 0.0198초 |
| `4_Transition_SDE_parallel_scan.ipynb` | 131465 | 0.0122초 |
| `2_encoder_transformer.ipynb` | 131576 | 0.0057초 |
| `test.ipynb` | 135331 | 0.0170초 |

4개 모두 `/home/minseok/miniconda3/envs/acssm/bin/python`을 사용하고 작업 폴더는 프로젝트 루트다. connection file과 PID가 각각 달라 **환경은 같지만 커널 프로세스는 4개**다. `1_data_preparation.ipynb`에 대응하는 실행 중 커널은 조사 시점에 없었다. 저장된 Notebook metadata만으로 살아 있는 커널을 판단하지 않았다.

네 프로세스 모두 현재 `kernel_info_reply`를 반환했다. 이 조회는 코드 실행·변수 변경·사용자 셀 실행 결과의 검증을 포함하지 않는다.

실제 커널이 사용하는 패키지는 ipykernel 7.3.0, jupyter_client 8.10.0, IPython 9.17.1, pyzmq 27.2.0이다.

## 발생한 지연과 원인 범위

최신 WSL Jupyter 로그의 `test.ipynb` 기록:

| 시각 | 기록 |
|---|---|
| 16:35:12.847 | 커널 시작 요청 |
| 16:35:17.707 | `acssm` Python의 `ipykernel_launcher` 프로세스 실행 |
| 16:39:40.396 | 재시작 요청 |
| 16:44:15.296 | `Kernel successfully started` |
| 16:44:16.122 | 기존 재시작 요청 완료 |

시작 요청부터 성공 기록까지 약 9분 2초, 프로세스 실행부터 약 8분 58초가 걸렸다. 조사 중 재시작 전 프로세스 PID 133667에도 독립 클라이언트로 `kernel_info`를 보냈고 약 0.055초에 정상 응답했다. 이후 로그에서 준비 완료와 앞서 요청된 재시작 완료를 확인했다. 기존 커널에 restart/shutdown/interrupt 명령을 보낸 것은 없다.

따라서 확인한 장애 범위는 **커널 프로세스 생성 자체의 실패보다 VS Code Jupyter의 세션 초기화·준비 완료 처리 지연**이다. 하나의 프로젝트 폴더에서 여러 Notebook을 열었다는 사실만으로 생기는 실행 제한은 확인되지 않았다. 모든 기존 커널이 응답했고 별도 신규 커널도 약 1초에 준비됐다.

직접 상태 조회 직후 준비 완료 기록이 생겼지만, 그 조회가 어떤 대기를 해제했는지까지는 증명하지 못했다. 초기화 코드, KernelInfo 및 idle 상태 대기, 확장 hook 중 어느 단계가 멈췄는지는 현재 info 수준 로그만으로 특정할 수 없다. 이를 특정 ipykernel 버전 결함이나 특정 확장의 결함으로 단정할 근거도 없다.

설치된 Jupyter 확장 2025.9.1 구현은 시작 시 내부 초기화, 사용자 시작 코드, KernelInfo, idle 대기를 거친 다음에야 `Kernel successfully started`를 기록한다. 재시작도 기존 시작 promise를 기다리는 경로가 있어, 시작 과정이 지연되면 재시작 버튼을 눌러도 바로 새 프로세스를 띄우지 못할 수 있다.

16:44:16 이후의 `Canceled future for complete_request message before replies were done`는 재시작으로 기존 자동완성 요청을 정리할 때의 로그다. 최초 시작 지연을 이 메시지가 일으켰다고 볼 수는 없다.

## 별도로 발견한 사용자 패키지 손상

`~/.local/lib/python3.12/site-packages`에 아래 파일이 0바이트로 존재한다.

- `ipykernel/__init__.py`
- `ipykernel_launcher.py`
- `ipykernel/kernelapp.py`
- `jupyter_client/__init__.py`
- `jupyter_server/__init__.py`

사용자 site를 허용한 채 `acssm/bin/python`을 직접 실행하면 이 경로가 Conda 패키지보다 우선하여 `ipykernel.__version__`이 없고 launcher가 아무 출력 없이 종료된다. `-s` 또는 `PYTHONNOUSERSITE=1`로 제외하면 Conda의 정상 패키지를 읽고 launcher 도움말도 정상 출력한다.

하지만 실제 기존 커널 4개는 **이미 `PYTHONNOUSERSITE=1`**로 실행 중이었다. Conda 환경의 `conda-meta/state`에도 이 값이 설정되어 있었다. 따라서 사용자 패키지 손상은 일반 터미널에서 다시 나타날 수 있는 별도 문제이며, 이번 VS Code 커널 대기의 직접 원인으로 분류하지 않았다. 다른 Python 환경에 영향을 줄 수 있어 사용자 패키지를 임의 삭제하지 않았다.

최신 로그의 `LocalLinearAprox.py:99`에서 발생한 tensor 크기 4/40 불일치는 사용자 셀 실행 중의 별도 모델 코드 오류다. 커널이 실행 중인 상태에서 발생했고 이번 연결 지연과 구분해야 한다. 구현 파일은 수정하지 않았다.

## 이후 대응

현재 응답이 복구된 상태라 일괄 커널 종료, 패키지 재설치, Python 환경 교체는 하지 않았다. 다시 대기한다면 다음 증거를 먼저 남기면 지연 단계를 좁힐 수 있다.

1. VS Code 설정에서 Jupyter logging level을 `debug` 또는 `trace`로 올린 뒤 문제가 재발하는 Notebook의 Output → Jupyter 기록을 확인한다. 이번에는 설정을 변경하지 않았다.
2. `Started running kernel initialization`, `Requesting Kernel info`, `Waiting for idle`, 실행/재시작 요청의 전후 기록을 비교한다. 이미 시작을 기다리는 동안 재시작을 반복 요청하면 진단이 복잡해진다.
3. 실제 Python 프로세스가 있는지와 독립 `kernel_info` 응답이 있는지를 구분한다. 전자는 살아 있어도 VS Code 초기화가 끝나지 않을 수 있다.
4. 새 일반 터미널에서는 `conda activate acssm` 후 `PYTHONNOUSERSITE`가 1인지 확인한다. 인터프리터 절대 경로만 실행하면 Conda 환경변수 설정이 자동 적용되는 것은 아니다.
5. Notebook 간 공유가 목적이면 서버에서 실행 중인 **동일한 커널 ID**에 연결한다. 각 Notebook에서 `import os; print(os.getpid())`를 실행해 같은 PID인지 확인할 수 있다.

## 근거 파일과 출처

- [기계 판독용 현재 상태와 증거](jupyter-kernel-check-2026-11-09.json)
- WSL Jupyter 로그: `/home/minseok/.vscode-server/data/logs/20261109T104043/exthost1/output_logging_20261109T104049/1-Jupyter.log`, 특히 155–165행.
- 확장 호스트 로그: 같은 세션 `exthost1/remoteexthost.log`의 16:44:16 기록.
- [VS Code Jupyter 커널과 Existing Jupyter Server 공식 설명](https://github.com/microsoft/vscode-jupyter/wiki/Jupyter-Kernels-and-the-Jupyter-Extension)
- [Python 사용자 site 제외 옵션](https://docs.python.org/3/library/site.html)

사용자 Notebook, 모델 소스, VS Code 설정, Conda 패키지는 변경하지 않았다. 프로젝트의 이 보고서와 진단 JSON만 추가했다. 진단용 임시 커널은 종료했다.
