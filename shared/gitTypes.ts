/**
 * Data shapes passed between the Rust backend and the UI.
 *
 * They are generated from the Rust types (by ts-rs, into `shared/generated/`)
 * whenever the Rust tests run: change the Rust type, run `cargo test` and
 * keep the regenerated file with it. Never edit the generated files.
 */
export type { BranchStash } from "./generated/BranchStash";
export type { ChangesOnSwitch } from "./generated/ChangesOnSwitch";
export type { CommitFile } from "./generated/CommitFile";
export type { ConflictFile } from "./generated/ConflictFile";
export type { ConflictState } from "./generated/ConflictState";
export type { ConflictVersions } from "./generated/ConflictVersions";
export type { ExternalTool } from "./generated/ExternalTool";
export type { FileChange } from "./generated/FileChange";
export type { FileDiff } from "./generated/FileDiff";
export type { GitBranch } from "./generated/GitBranch";
export type { GitCommit } from "./generated/GitCommit";
export type { GitHubAccount } from "./generated/GitHubAccount";
export type { GitHubRepository } from "./generated/GitHubRepository";
export type { GitRef } from "./generated/GitRef";
export type { GitStatus } from "./generated/GitStatus";
export type { ImageVersions } from "./generated/ImageVersions";
export type { Operation } from "./generated/Operation";
export type { RebaseStep } from "./generated/RebaseStep";
export type { RefType } from "./generated/RefType";
export type { Remote } from "./generated/Remote";
export type { RepositoryState } from "./generated/RepositoryState";
export type { ResetMode } from "./generated/ResetMode";
export type { Resolution } from "./generated/Resolution";
export type { SavedCommandKind } from "./generated/SavedCommandKind";
export type { StashOutcome } from "./generated/StashOutcome";
