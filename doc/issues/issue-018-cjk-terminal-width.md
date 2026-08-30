## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-29 | Added the issue #18 root-cause analysis, implementation details, and verification evidence. |
| 2026-08-29 | Pointed the status metadata at the published PR branch and PR #19. |
| 2026-08-30 | Independent second-pass review fixed cross-ANSI regional-indicator, invalid ESC, and colon-form SGR edges; separated evidence from inference and unknowns. |

# Issue 018: CJK Project Names Wrap the HUD

## Status

- **State:** Fixed in PR #19 on `fix/issue-18-cjk-terminal-width-pr`
- **Reported issue:** https://github.com/fwyc0573/codex-hud/issues/18
- **Affected path:** `src/render/colors.ts` and the renderer callers that consume its width helpers
- **User-visible impact:** A project name containing CJK characters can make a HUD row exceed the tmux pane, wrap onto a second physical row, and leave an old title fragment after refresh.

## Reproduction

The report supplies macOS Apple Silicon, Codex CLI `0.149.1`, tmux, and a HUD pane of approximately `108 x 5`. Start the HUD from a directory whose project name contains Chinese characters, then wait for a refresh. The report shows an apparently duplicated environment/title line, for example:

```text
sizetensions | 65 skills | 8 hooks | 1 AGENTS.md | Approval: full access | Fast: off | Sandbox: DANGER
4 extensions | 65 skills | 8 hooks | 1 AGENTS.md | Approval: full access | Fast: off | Sandbox: DANGER
```

The Linux tmux reproduction below shows the second fragment as the visible remainder of a line that exceeded the physical pane width and wrapped. That capture supports the interpretation that the displayed duplicate is a continuation row; host-specific refresh timing on the reported macOS setup remains an open validation item.

## Baseline Evidence

The unmodified renderer measured display text with JavaScript UTF-16 `.length`. Direct probes against the baseline build produced:

| Input | Baseline `visualLength` | Terminal columns |
| ----- | ----------------------: | ---------------: |
| `中文项目` | 4 | 8 |
| `👨‍👩‍👧‍👦` | 11 | 2 |
| `e\u0301` | 2 | 1 |
| `🇨🇳` | 4 | 2 |

The values demonstrate three independent accounting errors: CJK wide glyphs are under-counted, supplementary and ZWJ emoji are counted by code units, and combining marks are counted as visible characters.

## Root-Cause Chain

1. `stripAnsi` in `src/render/colors.ts` removed only SGR color sequences and then returned a string whose `.length` was used as the display width.
2. `visualLength` exposed that code-unit count to every layout decision. JavaScript counts UTF-16 code units, while a terminal lays out grapheme clusters in display columns.
3. `padEnd` in `colors.ts` used the incorrect value when reserving space for the status hint. `render/header.ts` used it again while composing identity, project, git, activity, and separator segments. `render/lines/project-line.ts` used it to decide when and how to truncate the project name. `render/index.ts` used it for the final line clipping pass.
4. With a CJK name, the renderer believed a row fit even when the terminal needed additional columns. The controlled Linux tmux run below therefore performed a physical line wrap.
5. **Inference:** the refresh path clears and rewrites a fixed number of logical rows (`CLEAR_LINE` plus cursor positioning). A wrapped continuation occupies a physical row that is not represented by the logical frame, which can leave an old continuation visible as a duplicate or shifted title.

The measured width overflow is sufficient to reproduce the reported wrap and identifies a shared terminal-width contract failure. The available artifacts do not independently rule out every macOS-specific refresh timing contribution, so a separate refresh race is **Unknown**, rather than disproved. A project-specific padding adjustment would leave emoji, combining marks, and other width-sensitive callers incorrect.

## Resolution

`src/render/colors.ts` now provides one private width/tokenization path for all four public helpers:

- `Intl.Segmenter` segments visible text into grapheme clusters before measuring it.
- Unicode East Asian wide/fullwidth ranges account for CJK columns.
- Combining marks, format/default-ignorable characters, controls, emoji variation selectors, skin tones, keycaps, regional-indicator flags, and ZWJ emoji sequences receive their terminal-column widths.
- CSI, OSC/OSC8, DCS, SOS, PM, APC, C1, and string terminator controls are tokenized separately and consume zero display columns.
- `visualLength`, `padEnd`, `truncate`, and `truncateAnsi` use the same token widths, so callers cannot disagree about a row budget.
- Truncation keeps grapheme clusters intact, counts the ellipsis by its own width, and closes an active SGR or OSC8 sequence before returning a shortened string.
- Single-byte C1 controls are consumed as one control byte; they no longer swallow the printable character that follows them.
- Invalid ESC continuations preserve the following Unicode text, and colon-form SGR parameters remain recognized so truncated styles receive a reset.

No renderer caller needs a new API or a CJK-specific branch. Existing layout and refresh logic inherits the corrected physical-column contract.

## Verification Evidence

The focused regression at `tests/unit/test-terminal-width.mjs` builds against `dist/` and verifies:

- `中文项目` = `8` columns, family ZWJ emoji = `2`, `e\u0301` = `1`, and `🇨🇳` = `2`.
- SGR, colon-form SGR, OSC8, C1 OSC8, single-byte C1 controls, and invalid ESC continuations are handled without losing adjacent visible text.
- CJK, emoji, combining, and regional-indicator graphemes remain whole during truncation.
- A truncated styled string ends with SGR reset; a truncated colon-form style ends with SGR reset; a truncated hyperlink ends with OSC8 close.
- A bounded project line at width `5` renders as `中文…` with measured width `5`.
- The focused `renderToStdout` boundary harness at `107`, `108`, and `109` columns emits five rows each; all `15` logical rows contain no embedded line break and measure at most their configured width.
- Two consecutive five-row refreshes replace `中文项目` with `新项目` without retaining the old title.

An independent Linux tmux capture at `108 x 5` corroborates the physical symptom. The baseline first row ended with `...Drag: Re` and the next row began with `size`; the fixed frame contained the complete `...Drag: Resize` on one row and no continuation row. The tmux pane reported `pane=108x5`; the capture is used for row/continuation evidence, while the renderer's explicit column assertions remain the numeric width gate.

Observed focused metrics:

```text
{"cjkColumns":8,"familyEmojiColumns":2,"combiningColumns":1,"flagColumns":2,"boundedProjectColumns":5,"refreshedRows":10,"boundaryWidths":[107,108,109],"boundaryRowsChecked":15}
```

The implementation was also checked with the existing unit and renderer integration scripts; the exact commands and results are recorded in the task test report.

## Scope and Residual Risk

The fix follows the terminal-column behavior needed by the reported tmux workflow and keeps the existing helper signatures. The direct physical capture ran on Linux; macOS host behavior from the report is **Unknown** pending a same-version host run. Terminal emulators can differ for East Asian Ambiguous characters and locale-specific font choices; those policies remain outside this issue's CJK-wide contract and are deferred.
