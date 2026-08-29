## Modification History

| Date       | Summary of Changes |
| ---------- | ------------------ |
| 2026-08-29 | Added the issue #18 root-cause analysis, implementation details, and verification evidence. |

# Issue 018: CJK Project Names Wrap the HUD

## Status

- **State:** Fixed on `fix/issue-18-cjk-terminal-width`
- **Reported issue:** https://github.com/fwyc0573/codex-hud/issues/18
- **Affected path:** `src/render/colors.ts` and the renderer callers that consume its width helpers
- **User-visible impact:** A project name containing CJK characters can make a HUD row exceed the tmux pane, wrap onto a second physical row, and leave an old title fragment after refresh.

## Reproduction

The report uses macOS Apple Silicon, Codex CLI `0.149.1`, tmux, and a HUD pane of approximately `108 x 5`. Start the HUD from a directory whose project name contains Chinese characters, then wait for a refresh. The report shows an apparently duplicated environment/title line, for example:

```text
sizetensions | 65 skills | 8 hooks | 1 AGENTS.md | Approval: full access | Fast: off | Sandbox: DANGER
4 extensions | 65 skills | 8 hooks | 1 AGENTS.md | Approval: full access | Fast: off | Sandbox: DANGER
```

The second fragment is not a second logical environment record. It is the visible remainder of a line that exceeded the physical pane width and wrapped.

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
4. With a CJK name, the renderer believed a row fit even when the terminal needed additional columns. tmux therefore performed a physical line wrap.
5. The refresh path clears and rewrites a fixed number of logical rows (`CLEAR_LINE` plus cursor positioning). The wrapped continuation occupies a physical row that is not represented by the logical frame, so the old continuation remains visible and looks like a duplicate or shifted title.

The defect is therefore a shared terminal-width contract failure, not a project-name encoding or tmux refresh race. A project-specific padding adjustment would leave emoji, combining marks, and other width-sensitive callers incorrect.

## Resolution

`src/render/colors.ts` now provides one private width/tokenization path for all four public helpers:

- `Intl.Segmenter` segments visible text into grapheme clusters before measuring it.
- Unicode East Asian wide/fullwidth ranges account for CJK columns.
- Combining marks, format/default-ignorable characters, controls, emoji variation selectors, skin tones, keycaps, regional-indicator flags, and ZWJ emoji sequences receive their terminal-column widths.
- CSI, OSC/OSC8, DCS, SOS, PM, APC, C1, and string terminator controls are tokenized separately and consume zero display columns.
- `visualLength`, `padEnd`, `truncate`, and `truncateAnsi` use the same token widths, so callers cannot disagree about a row budget.
- Truncation keeps grapheme clusters intact, counts the ellipsis by its own width, and closes an active SGR or OSC8 sequence before returning a shortened string.
- Single-byte C1 controls are consumed as one control byte; they no longer swallow the printable character that follows them.

No renderer caller needs a new API or a CJK-specific branch. Existing layout and refresh logic inherits the corrected physical-column contract.

## Verification Evidence

The focused regression at `tests/unit/test-terminal-width.mjs` builds against `dist/` and verifies:

- `中文项目` = `8` columns, family ZWJ emoji = `2`, `e\u0301` = `1`, and `🇨🇳` = `2`.
- SGR, OSC8, C1 OSC8, and single-byte C1 controls are stripped without losing visible text.
- CJK, emoji, and combining graphemes remain whole during truncation.
- A truncated styled string ends with SGR reset; a truncated hyperlink ends with OSC8 close.
- A bounded project line at width `5` renders as `中文…` with measured width `5`.
- Real `renderToStdout` frames at `107`, `108`, and `109` columns emit five rows each; all `15` captured rows contain no embedded line break and measure at most their configured width.
- Two consecutive five-row refreshes replace `中文项目` with `新项目` without retaining the old title.

Observed focused metrics:

```text
{"cjkColumns":8,"familyEmojiColumns":2,"combiningColumns":1,"flagColumns":2,"boundedProjectColumns":5,"refreshedRows":10,"boundaryWidths":[107,108,109],"boundaryRowsChecked":15}
```

The implementation was also checked with the existing unit and renderer integration scripts; the exact commands and results are recorded in the task test report.

## Scope and Residual Risk

The fix follows the terminal-column behavior needed by the reported tmux workflow and keeps the existing helper signatures. Terminal emulators can differ for East Asian Ambiguous characters and locale-specific font choices; those characters are intentionally outside this issue's CJK-wide contract. No macOS host was required for the deterministic width and refresh regression, while the test uses the reported `108 x 5` pane dimensions and adjacent boundaries.
