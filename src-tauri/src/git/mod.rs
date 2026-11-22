//! Git support: running the git CLI, holding the open repository, and
//! parsing git's output into the types the UI receives.

pub mod parsers;
pub mod patch;
pub mod repository;
pub mod runner;
pub mod types;
