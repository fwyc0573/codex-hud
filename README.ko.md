<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
  <a href="./README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-green.svg" alt="日本語"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-orange.svg" alt="한국어"></a>
</p>

# Codex HUD

[OpenAI Codex CLI](https://github.com/openai/codex)를 위한 실시간 상태 표시줄 HUD. 경량, 무설정, tmux 내 동작.

## Windows WSL 지원

Windows 지원은 Ubuntu WSL을 통해 `feature/windows-support-dual-entry` branch에서 제공됩니다. macOS/Linux 사용자는 `main`을, Windows (WSL) 사용자는 해당 feature branch를 사용하세요.

> Claude Code의 [claude-hud](https://github.com/jarrodwatts/claude-hud)에서 영감을 받았습니다.

![Codex HUD — 단일 세션](./doc/fig/screenshot.png)

## 왜 Codex HUD가 필요한가요?

**Q: Codex CLI만으로 충분하지 않나요?**

계기판 없이 비행하는 것과 같습니다. Codex HUD는 터미널 하단에 상시 대시보드를 제공합니다:

- **브랜치, 모델, 권한, 모드** — 한눈에 파악, 추측 불필요
- **Context 윈도우 채움 바** — 한계에 가까워지면 그래픽으로 즉시 인지
- **MCP 서버 상태 & 도구 호출, skills & agent 액션** — Codex가 실제로 무엇을 하는지 모니터링
- **tmux** — 설정 없이 Codex CLI를 tmux에서 네이티브 실행

**Q: 여러 Codex 세션을 동시에 모니터링할 수 있나요?**

네. `Ctrl+T`로 **멀티 세션 개요 모드**로 전환하면, 모든 활성 세션의 context 사용 현황을 한 화면에서 확인할 수 있습니다.

![Codex HUD — 멀티 세션 개요](./doc/fig/6d0edbdd-19b5-4038-b9a3-ca5341fd39d1.png)

**Q: tmux를 수동으로 설정해야 하나요?**

아닙니다. Codex HUD가 tmux를 자동으로 활성화합니다. `codex`만 입력하면 HUD가 나타납니다. tmux가 설치되지 않은 경우에도 설치 프로그램이 처리합니다.

이미 tmux pane 안에서 `codex`, `cx` 또는 `codex-hud`를 실행하면 같은 tmux socket에
nested client를 열고 바깥 session을 유지합니다. HUD를 닫으면 원래 pane으로 돌아갑니다.

## 빠른 시작

### macOS/Linux (`main`)

```bash
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch main
./bin/codex-hud-install

# 셸을 새로고침한 후 입력:
codex
```

### Windows (WSL) (`feature/windows-support-dual-entry`)

```powershell
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch feature/windows-support-dual-entry
.\bin\codex-hud-install.ps1

# 새 PowerShell 또는 cmd 창을 열고 확인:
codex --self-check

# WSL HUD로 실행:
codex
```

### 관리 명령어

첫 설치 후 다음 명령어가 셸에 추가됩니다:

| 명령어 | 설명 |
|--------|------|
| `cx` | HUD와 함께 Codex 실행 (`codex`와 같은 wrapper) |
| `codex-hud-sync` | 현재 체크아웃을 다시 빌드하고 별칭 갱신 |
| `codex-hud-upgrade` | 최신 build를 transactional 방식으로 가져와 검증하고 활성화 |
| `codex-hud-uninstall` | 별칭을 제거하고 HUD 세션 중지 |

## HUD에 무엇이 표시되나요?

```
[gpt-5.4 xhigh] █████░░░░ 45% │ my-project git:(main ●) │ 12m
3 extensions | 3 skills | 2 hooks | 2 AGENTS.md | Approval: ask for approval | Fast: on | Sandbox: ws-write
Ctx: ████░░░░ 45% (50.2K/128K) | Tokens: 50.2K | (in: 35.0K, cache: 5.0K, out: 15.2K) | ↻2
Dir: ~/my-project | Session: abc12345 | CLI: 0.4.2
◐ Edit: file.ts | ✓ Read ×3
◐ codex_cli_explore 2m14s ↳2
```

| 행 | 내용 |
|----|------|
| **헤더** | 모델 + effort, context 바, 프로젝트명, git 브랜치, 세션 타이머 |
| **환경** | 설정 수, MCP 서버, 활성화된 skills/hooks, 명령 파일, 승인/샌드박스 및 Fast mode |
| **Tokens** | 총 token (입력/cache/출력 내역), context 채움률, compact 횟수 |
| **Session** | 작업 디렉토리, Session ID, CLI 버전 |
| **활동** | 실행 중인 도구 호출, 최근 도구 이력, 활성 subagent |

Approval은 최신 Codex 런타임 permission에 따라 `ask for approval`, `approve for me`,
`full access` 중 하나로 표시됩니다. Codex 실행 중 permission을 변경하면 session을
재시작하지 않아도 HUD가 표시를 갱신합니다. HUD가 생성하는 tmux session은
`codex-hud-new-topic-research-a1b2c3d4-20260727220308-2505832`처럼 프로젝트 이름을
포함해 구분하기 쉬운 형식을 사용합니다.
`Fast: on`은 priority service tier, `Fast: off`는 default tier를 뜻합니다. skills와 hooks는
현재 cwd에 적용되는 effective configured scope의 유효하고 활성화된 entry 개수를 표시합니다. 집계에는 5초 프로세스 내 캐시가 사용되므로 skills/hooks 파일 변경은 일반적으로 약 5초 안에 표시됩니다.
wrapper는 tmux pane에서 Codex를 직접 시작하므로 attach 중 시작 명령이 터미널에 출력되지
않습니다. 기본 HUD 높이는 5행이며, 다른 고정 높이는 `CODEX_HUD_HEIGHT`로 지정할 수
있습니다.

### Subagent activity

확장 모드는 보이는 각 직접 자식마다 icon-first 행 하나를 표시합니다. 예: `◐ codex_cli_explore 2m14s ↳2`. 이름은 typed agent path의 마지막 부분이며, `↳N`은 모든 깊이에서 보이는 활성 하위 항목 수입니다. turn이 완료되거나 abort되면 즉시 사라지지만, 활성 하위 항목이 남아 있으면 직접 자식 집계 행은 유지됩니다. authoritative rollout 또는 metadata 추적에 실패하면 `✗ <name> tracking error`를 표시하고, 복구될 때까지 같은 typed child path만 다시 시도합니다.

compact 모드는 `Agents: N`을 표시합니다. `N`은 확장 모드의 직접 자식 행 수가 아니라 root가 소유한 전체 트리에서 보이는 agent node 수입니다. 멀티 세션 개요는 해당 activity가 소유 root session에 이미 표시되므로 typed subagent session을 제외합니다.

`CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS`는 running turn의 비활성 창을 제어합니다. 기본값은 `900000` ms(15분)이며 밀리초 단위의 양의 safe integer만 허용합니다. 빈 값, 잘못된 값, 0, 음수, 소수 또는 unsafe integer는 시작 시 오류로 종료됩니다. 이 timeout은 오래된 표시만 숨기며 agent를 중단하지 않고 hung 또는 crash를 증명할 수 없습니다. `starting`과 `tracking error`는 timeout되지 않습니다.

## 사용법

```bash
codex                        # HUD와 함께 실행
codex --model gpt-5          # Codex CLI 인수 전달
codex "help me debug this"   # 프롬프트 포함
cx                           # 같은 HUD wrapper를 짧은 명령으로 실행
codex-resume                 # 이전 세션 재개
```

<details>
<summary>추가 명령어</summary>

```bash
codex-hud --kill             # 현재 디렉토리의 세션 종료
codex-hud --list             # 모든 HUD 세션 목록
codex-hud --attach           # 기존 세션에 연결
codex-hud --new-session      # 새 세션 강제 생성
codex-hud --self-check       # 환경 진단 실행
```

</details>

## 설정

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CODEX_HUD_POSITION` | `bottom` | HUD 패인 위치 (`top` / `bottom`) |
| `CODEX_HUD_HEIGHT` | 5행 | HUD 높이 (행 수) |
| `CODEX_HUD_MOUSE` | `1` | 마우스/트랙패드 스크롤 활성화 |
| `CODEX_HUD_UPDATE_CHECK` | 활성화 | GitHub 정식 Release를 확인하고 종료 후 업데이트 제안 (`0`/`false`로 비활성화) |

<details>
<summary>모든 환경 변수</summary>

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CODEX_HUD_HEIGHT_AUTO` | `0` | 너비에 따라 높이 자동 조정 |
| `CODEX_HUD_HEIGHT_MIN` | `CODEX_HUD_HEIGHT` | 자동 모드 최소 높이 |
| `CODEX_HUD_HEIGHT_MAX` | `12` | 자동 모드 최대 높이 |
| `CODEX_HUD_AUTO_ATTACH` | `0` | 같은 디렉토리의 최신 세션에 자동 연결 |
| `CODEX_HUD_ALTERNATE_SCREEN` | `0` | codex 패인의 tmux alternate-screen |
| `CODEX_HUD_CLEAR_SCROLLBACK` | `0` | 첫 렌더링 시 스크롤백 초기화 |
| `CODEX_HUD_BIND_TOGGLE` | `0` | 기존 server-wide Prefix+H HUD 전환을 선택적으로 활성화 |
| `CODEX_HUD_UPDATE_CHECK` | 활성화 | 12시간마다 새 안정 Release를 확인하고 세션 종료 후 업데이트를 확인 |
| `CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS` | `900000` | running agent 표시 timeout; 양의 safe integer 밀리초 값만 허용 |
| `CODEX_HUD_CWD` | (미설정) | 작업 디렉토리 재정의 |
| `CODEX_HOME` | `~/.codex` | Codex 홈 디렉토리 |
| `CODEX_SESSIONS_PATH` | (미설정) | sessions 디렉토리 재정의 |

</details>

### Update 알림

새 `codex`, `cx`, `codex-resume` 또는 직접 실행한 `codex-hud` 세션은 12시간에 한 번
GitHub 정식 Release를 확인합니다. 기존 세션을 다시 연결할 때는 현재 대화를 방해하지
않습니다. 더 높은 안정 버전이 있으면 대화형 터미널에 다음 문구가 표시됩니다:

```text
[codex-hud] Update available: v旧 → v新. Update after this session exits? [Y/n]
```

확인 후 요청을 기록하고, 새 tmux 세션이 checkout 전용 close hook에 등록된 뒤에만
scheduling이 완료됩니다. 일반 detach는 Codex 세션을 유지하며 업데이트를 시작하지
않습니다. tmux 세션이 실제로 종료되면 정확한 fast-forward target을 fetch하고 격리된
staging worktree에서 의존성 설치와 build를 수행합니다. 사전 build가 성공한 경우에만
active checkout을 전진시키므로 dependency/build 실패 시 HEAD/worktree는 변경되지
않습니다. 상태와 로그는 checkout 외부의 `$XDG_STATE_HOME/codex-hud/`(미설정 시
`~/.local/state/codex-hud/`)에 저장됩니다. `CODEX_HUD_UPDATE_CHECK=0` 또는 `false`로
비활성화할 수 있으며 `codex-hud-upgrade`도 같은 transactional flow를 사용합니다.

### config.toml

HUD는 `CODEX_HOME/config.toml`에서 설정을 읽습니다:

```toml
model = "gpt-5.2-codex"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
service_tier = "priority"
hooks = true

[mcp_servers.my-server]
command = ["node", "server.js"]
enabled = true
```

## 지원 시스템

| 플랫폼 | 상태 |
|--------|------|
| Linux | 지원됨 |
| macOS (Apple Silicon) | 지원됨 |
| macOS (Intel) | 테스트 대기 |
| Windows (WSL) | `feature/windows-support-dual-entry`에서 지원됨 |

## 개발

```bash
npm install && npm run build   # 빌드
npm run dev                    # 감시 모드
node dist/index.js             # HUD 직접 실행
```

## 라이선스

MIT

## 크레딧

Jarrod Watts의 [claude-hud](https://github.com/jarrodwatts/claude-hud)에서 영감을 받았습니다. [OpenAI Codex CLI](https://github.com/openai/codex)를 위해 제작되었습니다.
