//! Line-level staging on the combined diff of one file (HEAD to working
//! tree, staged and unstaged changes together). Pure functions over git's
//! text output, so they can be unit tested without a repository.
//!
//! Lines are identified by their index in `diff.split('\n')`, the same index
//! the UI uses.

use std::collections::HashSet;

/// Line ranges from a hunk header "@@ -a,b +c,d @@" (a missing length is 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HunkHeader {
    old_start: usize,
    old_len: usize,
    new_start: usize,
    #[allow(dead_code)]
    new_len: usize,
}

fn parse_range(range: &str) -> Option<(usize, usize)> {
    match range.split_once(',') {
        Some((start, len)) => Some((start.parse().ok()?, len.parse().ok()?)),
        None => Some((range.parse().ok()?, 1)),
    }
}

fn parse_hunk_header(line: &str) -> Option<HunkHeader> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(" +")?;
    let (new, _) = rest.split_once(" @@")?;
    let (old_start, old_len) = parse_range(old)?;
    let (new_start, new_len) = parse_range(new)?;
    Some(HunkHeader { old_start, old_len, new_start, new_len })
}

/// What a line of a diff body stands for, by its old or new line number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BodyLine {
    Context { old: usize },
    Removed { old: usize },
    Added { new: usize },
}

/// A diff as a sequence of hunk headers and body lines.
#[derive(Debug, Clone, Copy)]
enum Item<'a> {
    Hunk(HunkHeader),
    Line {
        /// Position in `diff.split('\n')`.
        index: usize,
        line: BodyLine,
        /// The line's text without its marker.
        text: &'a str,
        /// The next line is git's "\ No newline at end of file".
        no_newline: bool,
    },
}

fn parse_items(diff: &str) -> Vec<Item<'_>> {
    let lines: Vec<&str> = diff.split('\n').collect();
    let mut items = Vec::new();
    let mut in_hunk = false;
    let (mut old, mut new) = (0, 0);
    for (index, raw) in lines.iter().enumerate() {
        if let Some(header) = parse_hunk_header(raw) {
            in_hunk = true;
            old = header.old_start;
            new = header.new_start;
            items.push(Item::Hunk(header));
            continue;
        }
        if !in_hunk || raw.is_empty() {
            continue;
        }
        let line = match raw.as_bytes()[0] {
            b' ' => {
                old += 1;
                new += 1;
                BodyLine::Context { old: old - 1 }
            }
            b'-' => {
                old += 1;
                BodyLine::Removed { old: old - 1 }
            }
            b'+' => {
                new += 1;
                BodyLine::Added { new: new - 1 }
            }
            _ => continue,
        };
        let no_newline = lines.get(index + 1).is_some_and(|next| next.starts_with('\\'));
        items.push(Item::Line { index, line, text: &raw[1..], no_newline });
    }
    items
}

fn body_lines<'a>(diff: &'a str) -> impl Iterator<Item = (usize, BodyLine)> + 'a {
    parse_items(diff).into_iter().filter_map(|item| match item {
        Item::Line { index, line, .. } => Some((index, line)),
        Item::Hunk(_) => None,
    })
}

/// Old-file line numbers removed and new-file line numbers added by a diff.
/// Meant for `-U0` diffs, where every body line is a change.
pub fn changed_line_numbers(diff: &str) -> (HashSet<usize>, HashSet<usize>) {
    let (mut removed, mut added) = (HashSet::new(), HashSet::new());
    for (_, line) in body_lines(diff) {
        match line {
            BodyLine::Removed { old } => removed.insert(old),
            BodyLine::Added { new } => added.insert(new),
            BodyLine::Context { .. } => false,
        };
    }
    (removed, added)
}

/// Indices of the changed lines of `combined` (HEAD to working tree) that
/// are staged. A removed HEAD line is staged when the index no longer has it
/// (`removed_in_index`, from a HEAD-to-index diff); an added line is staged
/// unless the working tree added it on top of the index
/// (`added_in_worktree`, from an index-to-working-tree diff).
pub fn staged_line_indices(
    combined: &str,
    removed_in_index: &HashSet<usize>,
    added_in_worktree: &HashSet<usize>,
) -> Vec<usize> {
    body_lines(combined)
        .filter(|(_, line)| match line {
            BodyLine::Removed { old } => removed_in_index.contains(old),
            BodyLine::Added { new } => !added_in_worktree.contains(new),
            BodyLine::Context { .. } => false,
        })
        .map(|(index, _)| index)
        .collect()
}

/// True if any added line of `combined` is in `staged`.
pub fn stages_any_addition(combined: &str, staged: &HashSet<usize>) -> bool {
    body_lines(combined)
        .any(|(index, line)| matches!(line, BodyLine::Added { .. }) && staged.contains(&index))
}

const STALE: &str = "The file changed since its diff was shown. Try again on the updated diff.";

/// Appends `text`, first ending the previous line if it had no newline
/// (only the last line of a file may lack one).
fn push_line(out: &mut String, text: &str) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(text);
}

/// Index content for a file, given its HEAD content, its combined diff and
/// which of the diff's changed lines (`staged`, indices into
/// `combined.split('\n')`) should be in the index: HEAD with exactly those
/// removals and additions applied. Fails if `head` doesn't match the diff.
pub fn index_content(head: &str, combined: &str, staged: &HashSet<usize>) -> Result<String, String> {
    let head_lines: Vec<&str> = head.split_inclusive('\n').collect();
    let head_line = |number: usize| -> Result<&str, String> {
        number
            .checked_sub(1)
            .and_then(|i| head_lines.get(i).copied())
            .ok_or_else(|| STALE.to_string())
    };
    let mut out = String::new();
    // Next HEAD line (1-based) not yet copied or consumed by a hunk.
    let mut next_head = 1;

    for item in parse_items(combined) {
        match item {
            Item::Hunk(header) => {
                // With a zero length, old_start is the line the hunk comes after.
                let first = if header.old_len == 0 { header.old_start + 1 } else { header.old_start };
                if first < next_head {
                    return Err(STALE.into());
                }
                while next_head < first {
                    push_line(&mut out, head_line(next_head)?);
                    next_head += 1;
                }
            }
            Item::Line { index, line, text, no_newline } => match line {
                BodyLine::Context { old } | BodyLine::Removed { old } => {
                    let head_text = head_line(old)?;
                    if head_text.strip_suffix('\n').unwrap_or(head_text) != text {
                        return Err(STALE.into());
                    }
                    let removed = matches!(line, BodyLine::Removed { .. });
                    if !removed || !staged.contains(&index) {
                        push_line(&mut out, head_text);
                    }
                    next_head = old + 1;
                }
                BodyLine::Added { .. } => {
                    if staged.contains(&index) {
                        push_line(&mut out, text);
                        if !no_newline {
                            out.push('\n');
                        }
                    }
                }
            },
        }
    }
    while next_head <= head_lines.len() {
        push_line(&mut out, head_line(next_head)?);
        next_head += 1;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[usize]) -> HashSet<usize> {
        items.iter().copied().collect()
    }

    /// Index of the diff line equal to `line`.
    fn at(diff: &str, line: &str) -> usize {
        diff.split('\n').position(|l| l == line).unwrap()
    }

    const HEAD: &str = "one\ntwo\nthree\n";
    // two -> TWO, and "four" added at the end.
    const COMBINED: &str = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n one\n-two\n+TWO\n three\n+four\n";

    #[test]
    fn parses_hunk_headers() {
        let header = parse_hunk_header("@@ -1,3 +1,4 @@ fn x").unwrap();
        assert_eq!(header, HunkHeader { old_start: 1, old_len: 3, new_start: 1, new_len: 4 });
        let short = parse_hunk_header("@@ -0,0 +1 @@").unwrap();
        assert_eq!((short.old_len, short.new_start, short.new_len), (0, 1, 1));
    }

    #[test]
    fn builds_index_content_from_selected_lines() {
        let all = set(&[at(COMBINED, "-two"), at(COMBINED, "+TWO"), at(COMBINED, "+four")]);
        assert_eq!(index_content(HEAD, COMBINED, &all).unwrap(), "one\nTWO\nthree\nfour\n");
        assert_eq!(index_content(HEAD, COMBINED, &set(&[])).unwrap(), HEAD);
        let four = set(&[at(COMBINED, "+four")]);
        assert_eq!(index_content(HEAD, COMBINED, &four).unwrap(), "one\ntwo\nthree\nfour\n");
        // Removing "two" without adding "TWO".
        let removal = set(&[at(COMBINED, "-two")]);
        assert_eq!(index_content(HEAD, COMBINED, &removal).unwrap(), "one\nthree\n");
        assert!(index_content("one\n", COMBINED, &all).is_err());
    }

    #[test]
    fn keeps_lines_outside_hunks_and_handles_new_files() {
        let head = "a\nb\nc\nd\ne\nf\ng\nh\n";
        let diff = "@@ -8 +8,2 @@\n h\n+i\n";
        assert_eq!(index_content(head, diff, &set(&[2])).unwrap(), "a\nb\nc\nd\ne\nf\ng\nh\ni\n");
        let new_file = "--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+x\n+y\n\\ No newline at end of file\n";
        assert_eq!(index_content("", new_file, &set(&[3, 4])).unwrap(), "x\ny");
        assert_eq!(index_content("", new_file, &set(&[4])).unwrap(), "y");
        assert!(stages_any_addition(new_file, &set(&[4])));
        assert!(!stages_any_addition(new_file, &set(&[])));
    }

    #[test]
    fn finds_staged_lines() {
        // Index has "TWO" (staged); "four" is only in the working tree.
        let cached = "@@ -2 +2 @@\n-two\n+TWO\n";
        let unstaged = "@@ -3,0 +4 @@\n+four\n";
        let (removed_in_index, _) = changed_line_numbers(cached);
        let (_, added_in_worktree) = changed_line_numbers(unstaged);
        assert_eq!(removed_in_index, set(&[2]));
        assert_eq!(added_in_worktree, set(&[4]));
        let staged = staged_line_indices(COMBINED, &removed_in_index, &added_in_worktree);
        assert_eq!(staged, vec![at(COMBINED, "-two"), at(COMBINED, "+TWO")]);
    }
}
