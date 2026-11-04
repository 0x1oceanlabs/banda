/**
 * The git module's words for TypeScript: what `git.status` reads, what
 * `git.diff` and `git.contents` compare, the branches and commits to
 * compare with, what `git.stage`, `git.unstage` and `git.revert`
 * change, and what the git button asks `git.act`, `git.switch` and
 * `git.branch` and hears back, with the prompt and the reply its message
 * is written from.
 */
export type { ActAsk } from "./generated/git/ActAsk"
export type { Action } from "./generated/git/Action"
export type { Base } from "./generated/git/Base"
export type { BranchAsk } from "./generated/git/BranchAsk"
export type { Change } from "./generated/git/Change"
export type { ChangeAsk } from "./generated/git/ChangeAsk"
export type { Changed } from "./generated/git/Changed"
export type { Commit } from "./generated/git/Commit"
export type { CommitsAsk } from "./generated/git/CommitsAsk"
export type { Contents } from "./generated/git/Contents"
export type { ContentsAsk } from "./generated/git/ContentsAsk"
export type { Diff } from "./generated/git/Diff"
export type { DiffAsk } from "./generated/git/DiffAsk"
export type { Done } from "./generated/git/Done"
export type { FileDiff } from "./generated/git/FileDiff"
export type { HunkAsk } from "./generated/git/HunkAsk"
export type { Message } from "./generated/git/Message"
export type { Objects } from "./generated/git/Objects"
export type { Progress } from "./generated/git/Progress"
export type { PromptAsk } from "./generated/git/PromptAsk"
export type { Prompted } from "./generated/git/Prompted"
export type { Ref } from "./generated/git/Ref"
export type { RefsAsk } from "./generated/git/RefsAsk"
export type { Scope } from "./generated/git/Scope"
export type { Status } from "./generated/git/Status"
export type { Step } from "./generated/git/Step"
export type { SwitchAsk } from "./generated/git/SwitchAsk"
export type { WrittenAsk } from "./generated/git/WrittenAsk"
