<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
  <a href="./README.zh.md"><img src="https://img.shields.io/badge/lang-中文-red.svg" alt="中文"></a>
  <a href="./README.ja.md"><img src="https://img.shields.io/badge/lang-日本語-green.svg" alt="日本語"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-orange.svg" alt="한국어"></a>
</p>

# Codex HUD

[OpenAI Codex CLI](https://github.com/openai/codex) 用のリアルタイムステータスバー HUD。軽量・設定不要・tmux 内で動作。

## Windows WSL サポート

Windows サポートは Ubuntu WSL 経由で `feature/windows-support-dual-entry` branch に用意されています。macOS/Linux では `main`、Windows (WSL) ではその feature branch を使用してください。

> Claude Code の [claude-hud](https://github.com/jarrodwatts/claude-hud) にインスパイアされています。

![Codex HUD — シングルセッション](./doc/fig/screenshot.png)

## お知らせ

- **[2026-08-15]** OpenAI 上流の「capacity exceeded」の自動検出と自動「continue」処理を追加しました。使い方は `cx-continue/README.md` を参照してください。
- **[2026-07-20]** 最初の正式版 v1.0 をリリースし、macOS と Linux を完全サポートしました。

## なぜ Codex HUD が必要？

**Q: Codex CLI だけで十分では？**

計器なしのフライトと同じです。Codex HUD はターミナル下部に常駐ダッシュボードを表示します：

- **tmux** —— 設定不要で最適化された tmux 内で Codex CLI をネイティブ実行（上下にスクロールして会話履歴を確認可能）
- **自動 continue** —— OpenAI「capacity exceeded」ブロックを自動検出し、「continue」を送信してタスクを再開
- **ブランチ・モデル・権限・モード** —— 一目で把握、推測不要
- **MCP サーバー状況 & ツール呼び出し、skills & agent アクション** —— Codex が実際に何をしているか監視
- **Context ウィンドウ充填バー** —— 上限に近づくのをグラフィカルに確認

**Q: 複数の Codex セッションを同時に監視できますか？**

はい。`Ctrl+T` で**マルチセッション概要モード**に切り替えると、すべてのアクティブセッションの context 使用状況を一画面で確認できます。

![Codex HUD — マルチセッション概要](./doc/fig/6d0edbdd-19b5-4038-b9a3-ca5341fd39d1.png)

**Q: tmux を手動で設定する必要がありますか？**

不要です。Codex HUD は tmux を自動的に起動します。`codex` と入力するだけで HUD が表示されます。tmux 未インストールの場合もインストーラーが対応します。

既存の tmux pane から `codex`、`cx`、または `codex-hud` を起動した場合は、同じ tmux
socket 上に nested client を開き、外側の session を維持します。HUD を終了すると元の pane に戻ります。

## クイックスタート

### ワンプロンプトでインストール（agent 向け）

```bash
codex-hud (https://github.com/fwyc0573/codex-hud) を、その README.md の手順に従って Codex CLI 用にインストールしてください。Codex の「capacity exceeded」を自動検出し「continue」を自動送信する場合は、cx-continue/ に移動して ./bin/cx-continue-ctl start を実行してください。
```

### macOS/Linux（`main`）

```bash
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch main
./bin/codex-hud-install

# シェルをリフレッシュして、以下を入力：
codex

# Codex の「capacity exceeded」を自動検出し「continue」を自動送信する場合は、以下を使用：
cd cx-continue
./bin/cx-continue-ctl start     # バックグラウンドで起動
./bin/cx-continue-ctl status    # 実行中かどうか、各 pane の動作を確認
./bin/cx-continue-ctl stop      # 停止
./bin/cx-continue-ctl restart   # 停止してから起動
./bin/cx-continue-ctl logs      # ログを追跡
```

### Windows (WSL)（`feature/windows-support-dual-entry`）

```powershell
git clone https://github.com/fwyc0573/codex-hud.git
cd codex-hud
git switch feature/windows-support-dual-entry
.\bin\codex-hud-install.ps1

# 新しい PowerShell または cmd ウィンドウを開いて確認：
codex --self-check

# WSL HUD で起動：
codex
```

### 管理コマンド

初回インストール後、以下のコマンドがシェルに追加されます：

| コマンド | 説明 |
|----------|------|
| `cx` | HUD 付きで Codex を起動（`codex` と同じ wrapper） |
| `codex-hud-sync` | 現在のチェックアウトを再ビルドしエイリアスを更新 |
| `codex-hud-upgrade` | 最新 build を transactionally 取得・検証・有効化 |
| `codex-hud-uninstall` | エイリアスを削除し HUD セッションを停止 |

## HUD に何が表示される？

```
[gpt-5.4 xhigh] █████░░░░ 45% │ my-project git:(main ●) │ 12m
3 extensions | 3 skills | 2 hooks | 2 AGENTS.md | Approval: ask for approval | Fast: on | Sandbox: ws-write
Ctx: ████░░░░ 45% (50.2K/128K) | Tokens: 50.2K | (in: 35.0K, cache: 5.0K, out: 15.2K) | ↻2
Dir: ~/my-project | Session: abc12345 | CLI: 0.4.2
◐ Edit: file.ts | ✓ Read ×3
◐ codex_cli_explore 2m14s ↳2
```

| 行 | 内容 |
|----|------|
| **ヘッダー** | モデル + effort、context バー、プロジェクト名、git ブランチ、セッションタイマー |
| **環境** | 設定数、MCP サーバー、有効な skills/hooks、命令ファイル、承認/サンドボックス、Fast mode |
| **Tokens** | 合計 token（入力/cache/出力の内訳）、context 充填率、compact 回数 |
| **Session** | 作業ディレクトリ、Session ID、CLI バージョン |
| **アクティビティ** | 実行中のツール呼び出し、最近のツール履歴、アクティブな subagent |

Approval は最新の Codex ランタイム permission に基づき、`ask for approval`、
`approve for me`、`full access` のいずれかで表示されます。Codex 実行中に permission
を変更すると、session を再起動せず HUD が表示を更新します。HUD が作成する tmux
session は、`codex-hud-new-topic-research-a1b2c3d4-20260727220308-2505832` のように
プロジェクト名を含む区別しやすい形式です。
`Fast: on` は priority service tier、`Fast: off` は default tier を示します。skills と hooks
は現在の cwd に対して有効な configured scope にある entry の数です。集計には 5 秒間のプロセス内キャッシュを使用するため、skills/hooks のファイル変更は通常約 5 秒以内に表示されます。
wrapper は tmux pane で Codex を直接起動するため、attach 中に起動コマンドが端末へ表示
されません。HUD のデフォルト高さは 5 行で、別の固定高さには `CODEX_HUD_HEIGHT` を設定
できます。

### Subagent activity

展開モードでは、可視の直接子ごとに icon-first の行を 1 行表示します。例：`◐ codex_cli_explore 2m14s ↳2`。名前には typed agent path の末尾を使い、`↳N` は全階層にある可視のアクティブな子孫数です。turn が完了または abort すると即座に消えますが、アクティブな子孫が残る場合は直接子の集約行を維持します。authoritative な rollout または metadata の追跡に失敗した場合は `✗ <name> tracking error` を表示し、回復するまで同じ typed child path のみを再試行します。

コンパクトモードでは `Agents: N` を表示します。`N` は展開モードの直接子行数ではなく、root が所有するツリー全体の可視 agent node 数です。マルチセッション概要では、所有元の root session に activity が集約されるため、typed subagent session を除外します。

`CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS` は running turn の非アクティブ時間を制御します。デフォルトは `900000` ms（15 分）で、ミリ秒単位の正の safe integer のみ受け付けます。空、無効、ゼロ、負数、小数、unsafe integer は起動時にエラーになります。この timeout は古い表示を隠すだけで、agent を中断せず、hung や crash を証明できません。`starting` と `tracking error` は timeout しません。

## 使い方

```bash
codex                        # HUD 付きで起動
codex --model gpt-5          # Codex CLI 引数を渡す
codex "help me debug this"   # プロンプト付き
cx                           # 同じ HUD wrapper を短いコマンドで起動
codex-resume                 # 前回のセッションを再開
```

<details>
<summary>その他のコマンド</summary>

```bash
codex-hud --kill             # 現在のディレクトリのセッションを終了
codex-hud --list             # すべての HUD セッションを一覧表示
codex-hud --attach           # 既存セッションにアタッチ
codex-hud --new-session      # 新規セッションを強制作成
codex-hud --self-check       # 環境診断を実行
```

</details>

## 設定

### 環境変数

| 変数 | デフォルト | 説明 |
|------|------------|------|
| `CODEX_HUD_POSITION` | `bottom` | HUD ペインの位置（`top` / `bottom`） |
| `CODEX_HUD_HEIGHT` | 5 行 | HUD の高さ（行数） |
| `CODEX_HUD_MOUSE` | `1` | マウス/トラックパッドスクロールを有効化 |
| `CODEX_HUD_UPDATE_CHECK` | 有効 | GitHub の正式 Release を確認し、終了後の更新を提案（`0`/`false` で無効化） |

<details>
<summary>すべての環境変数</summary>

| 変数 | デフォルト | 説明 |
|------|------------|------|
| `CODEX_HUD_HEIGHT_AUTO` | `0` | 幅に基づいて高さを自動調整 |
| `CODEX_HUD_HEIGHT_MIN` | `CODEX_HUD_HEIGHT` | 自動モードの最小高さ |
| `CODEX_HUD_HEIGHT_MAX` | `12` | 自動モードの最大高さ |
| `CODEX_HUD_AUTO_ATTACH` | `0` | 同ディレクトリの最新セッションに自動アタッチ |
| `CODEX_HUD_ALTERNATE_SCREEN` | `0` | codex ペインの tmux alternate-screen |
| `CODEX_HUD_CLEAR_SCROLLBACK` | `0` | 初回レンダリング時にスクロールバックをクリア |
| `CODEX_HUD_BIND_TOGGLE` | `0` | 旧 server-wide Prefix+H HUD 切り替えをオプトインで有効化 |
| `CODEX_HUD_UPDATE_CHECK` | 有効 | 12 時間ごとに新しい安定版 Release を確認し、セッション終了後の更新を確認 |
| `CODEX_HUD_AGENT_INACTIVITY_TIMEOUT_MS` | `900000` | running agent の表示 timeout。正の safe integer ミリ秒値のみ |
| `CODEX_HUD_CWD` | （未設定） | 作業ディレクトリを上書き |
| `CODEX_HOME` | `~/.codex` | Codex ホームディレクトリ |
| `CODEX_SESSIONS_PATH` | （未設定） | sessions ディレクトリを上書き |

</details>

### Update リマインダー

新しい `codex`、`cx`、`codex-resume`、または直接の `codex-hud` セッションでは、
12 時間に 1 回まで GitHub の正式 Release を確認します。既存セッションを再利用
する場合は現在の会話を中断しません。新しい安定版があると、対話端末に次を表示します：

```text
[codex-hud] Update available: v旧 → v新. Update after this session exits? [Y/n]
```

確認後は要求を記録し、新しい tmux セッションが checkout 専用 close hook に登録
された時点で scheduling が完了します。通常の detach では Codex セッションを保持し、
更新を開始しません。tmux セッションが実際に終了すると、正確な fast-forward target を
fetch し、隔離した staging worktree で依存関係のインストールと build を行います。
事前 build が成功した場合だけ active checkout を進めるため、dependency/build 失敗時は
HEAD/worktree が変わりません。状態とログは checkout 外の
`$XDG_STATE_HOME/codex-hud/`（未設定時は `~/.local/state/codex-hud/`）に保存されます。
`CODEX_HUD_UPDATE_CHECK=0` または `false` で無効化でき、`codex-hud-upgrade` も同じ
transactional flow を使用します。

### config.toml

HUD は `CODEX_HOME/config.toml` から設定を読み取ります：

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

## 対応システム

| プラットフォーム | 状態 |
|------------------|------|
| Linux | 対応済み |
| macOS (Apple Silicon) | 対応済み |
| macOS (Intel) | テスト待ち |
| Windows (WSL) | `feature/windows-support-dual-entry` で対応済み |

## 開発

```bash
npm install && npm run build   # ビルド
npm run dev                    # ウォッチモード
node dist/index.js             # HUD を直接実行
```

## ライセンス

MIT

## クレジット

Jarrod Watts の [claude-hud](https://github.com/jarrodwatts/claude-hud) にインスパイアされています。[OpenAI Codex CLI](https://github.com/openai/codex) 用に構築。
