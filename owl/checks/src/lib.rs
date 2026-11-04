//! The Rust port of `packages/checks` (SRD §8.2, NFR-02): the deterministic code checks Owl runs before its model
//! check. TypeScript and Rust must give the same answer for every file in `fixtures/checks`; `tests/fixtures.rs`
//! runs them all. `detail` is UI copy (at most 40 characters, no semicolons or dashes, D-170).
//!
//! JavaScript semantics are matched on purpose where they differ from Rust's defaults: `\s` is JavaScript's set
//! (not Unicode White_Space), `\w` and `\d` are ASCII, and counts are by code point.
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    pub id: String,
    pub pass: bool,
    pub detail: String,
    /// Why it failed (SRD §8.3); `None` when it passed.
    pub code: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CodeChecks {
    pub checks: Vec<Check>,
    /// Each failing code once, in order of first failure.
    pub codes: Vec<&'static str>,
}

impl CodeChecks {
    /// The same JSON the TypeScript version returns (and the fixtures store).
    pub fn to_json(&self) -> Value {
        let checks: Vec<Value> = self
            .checks
            .iter()
            .map(|c| match c.code {
                Some(code) => json!({ "id": c.id, "pass": c.pass, "detail": c.detail, "code": code }),
                None => json!({ "id": c.id, "pass": c.pass, "detail": c.detail }),
            })
            .collect();
        json!({ "checks": checks, "codes": self.codes })
    }
}

/// JavaScript's `\s`.
fn js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// The members of JavaScript's `\s`, for use inside a regex character class.
const WS: &str = r"\t\n\x0B\x0C\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}";

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("a valid pattern")
}

fn trim(s: &str) -> &str {
    s.trim_matches(js_space)
}

fn words(s: &str) -> usize {
    s.split(js_space).filter(|w| !w.is_empty()).count()
}

fn norm(s: &str) -> String {
    s.to_lowercase().split(js_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

fn plural(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

fn found(n: usize, of: usize) -> String {
    if of == 2 && n == 2 {
        "both found".into()
    } else if n == of {
        "all found".into()
    } else {
        format!("{n} of {of} found")
    }
}

static WORD_COUNT: LazyLock<Regex> = LazyLock::new(|| re(r"^word_count <= ([0-9]+)$"));
static LANGUAGE: LazyLock<Regex> = LazyLock::new(|| re(r"^language == ([A-Za-z0-9_]+)$"));
static POST_COUNT: LazyLock<Regex> = LazyLock::new(|| re(r"^post_count == ([0-9]+)$"));
static TRACEABLE: LazyLock<Regex> = LazyLock::new(|| re(r"^traceable >= ([0-9]+)%$"));
static RECORDS: LazyLock<Regex> = LazyLock::new(|| re(r"^records <= ([0-9]+)$"));
static BULLET: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"^[{WS}]*(?:[-*•]|[0-9]+[.)])[{WS}]+")));
static HANDLE: LazyLock<Regex> = LazyLock::new(|| re(r"@[A-Za-z0-9_]+"));
static URL: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"https?://[^{WS}]+|(?-u:\b)[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/[^{WS}]*")));
static LINK: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"^https?://[^{WS}]+$")));
static NUMBER: LazyLock<Regex> = LazyLock::new(|| re(r"[0-9][0-9,]*(?:\.[0-9]+)?"));
static ISO_DATE: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?$"));

/// X's weights (twitter-text v3), same as `weightedLength` in packages/shared: code points up to U+10FF, U+2000 to
/// U+200D, U+2010 to U+201F and U+2032 to U+2037 count 1, every other code point 2, every link 23.
pub fn weighted_length(post: &str) -> usize {
    let mut n = 0;
    let rest = URL.replace_all(post, |_: &regex::Captures| {
        n += 23;
        ""
    });
    for c in rest.chars() {
        let cp = c as u32;
        let light = cp <= 0x10ff || (0x2000..=0x200d).contains(&cp) || (0x2010..=0x201f).contains(&cp) || (0x2032..=0x2037).contains(&cp);
        n += if light { 1 } else { 2 };
    }
    n
}

fn looks_english(text: &str) -> bool {
    const EN: [&str; 27] = [
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were", "be", "it", "this", "that", "with", "as", "by", "at",
        "from", "not", "but", "have", "has",
    ];
    // [a-z']+ over the lower-cased text
    let lower = text.to_lowercase();
    let mut ws: Vec<&str> = Vec::new();
    let mut start = None;
    for (i, c) in lower.char_indices() {
        let part = c.is_ascii_lowercase() || c == '\'';
        match (part, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                ws.push(&lower[s..i]);
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        ws.push(&lower[s..]);
    }
    if ws.len() < 8 {
        return true; // too short to judge
    }
    let english = ws.iter().filter(|w| EN.contains(w)).count();
    english as f64 / ws.len() as f64 >= 0.12
}

fn iso_date(s: &str) -> bool {
    let Some(m) = ISO_DATE.captures(s) else { return false };
    let num = |i: usize| m.get(i).map(|x| x.as_str().parse::<u32>().unwrap());
    let (y, mo, d) = (num(1).unwrap(), num(2).unwrap(), num(3).unwrap());
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    (1..=12).contains(&mo) && d >= 1 && d <= days[mo as usize - 1] && (num(4).is_none() || (num(4).unwrap() < 24 && num(5).unwrap() < 60 && num(6).is_none_or(|s| s < 60)))
}

fn field_ok(field: &Value, v: Option<&Value>) -> bool {
    let v = match v {
        None | Some(Value::Null) => return true, // presence is required_fields_filled's job
        Some(v) => v,
    };
    match field["type"].as_str() {
        Some("number") => v.is_number(),
        Some("string") => v.is_string(),
        Some("date") => v.as_str().is_some_and(iso_date),
        Some("url") => v.as_str().is_some_and(|s| LINK.is_match(s)),
        Some("enum") => v.as_str().is_some_and(|s| field["values"].as_array().is_some_and(|vs| vs.iter().any(|x| x.as_str() == Some(s)))),
        _ => false,
    }
}

/// A value counts as traceable when its text appears in the normalized snapshot, or a number equals one of the
/// snapshot's numbers ("1,200" is 1200, "12.50" is 12.5).
fn traceable(v: &Value, source: &str) -> bool {
    match v {
        Value::Number(n) => {
            let v = n.as_f64().unwrap_or(f64::NAN);
            NUMBER.find_iter(source).any(|t| t.as_str().replace(',', "").parse::<f64>().is_ok_and(|x| (x - v).abs() < 1e-9))
        }
        Value::String(s) => source.contains(&norm(s)),
        _ => false,
    }
}

fn strings(v: &Value) -> Vec<&str> {
    v.as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

fn count_in(text: &str, terms: &[&str]) -> usize {
    let hay = norm(text);
    terms.iter().filter(|t| hay.contains(&norm(t))).count()
}

struct Out(Vec<Check>);

impl Out {
    fn add(&mut self, id: &str, pass: bool, detail: String, code: &'static str) {
        self.0.push(Check { id: id.into(), pass, detail, code: if pass { None } else { Some(code) } });
    }

    fn finish(self) -> CodeChecks {
        let mut codes: Vec<&'static str> = Vec::new();
        for c in self.0.iter().filter_map(|c| c.code) {
            if !codes.contains(&c) {
                codes.push(c);
            }
        }
        CodeChecks { checks: self.0, codes }
    }
}

/// Runs every `kind: "code"` item of the brief against the delivery. Unknown rules fail closed.
/// `brief` is the JSON of `{ jobType, params, checklist }` exactly as Shark stores it.
pub fn run_code_checks(brief: &Value, source: &str, delivery: &str) -> CodeChecks {
    let params = &brief["params"];
    let items: Vec<(&str, &str)> = brief["checklist"]
        .as_array()
        .map(|a| a.iter().filter(|c| c["kind"] == "code").map(|c| (c["id"].as_str().unwrap_or(""), c["rule"].as_str().unwrap_or(""))).collect())
        .unwrap_or_default();
    let mut out = Out(Vec::new());

    match brief["jobType"].as_str() {
        Some("summary") => {
            let text = trim(delivery);
            for (id, rule) in items {
                if let Some(m) = WORD_COUNT.captures(rule) {
                    let n = words(text);
                    out.add(id, n as f64 <= m[1].parse::<f64>().unwrap_or(f64::INFINITY), plural(n, "word"), "FAIL_LENGTH");
                } else if rule == "mentions_all" {
                    let terms = strings(&params["mustMention"]);
                    let n = count_in(text, &terms);
                    out.add(id, n == terms.len(), found(n, terms.len()), "FAIL_MISSING_ITEM");
                } else if let Some(m) = LANGUAGE.captures(rule) {
                    // shortcut: only English is detected; any other language passes untested until a detector is added
                    out.add(id, &m[1] != "en" || looks_english(text), m[1].to_string(), "FAIL_FORMAT");
                } else if rule == "format == bullets" {
                    let lines: Vec<&str> = text.split('\n').filter(|l| !trim(l).is_empty()).collect();
                    let bullets = lines.iter().filter(|l| BULLET.is_match(l)).count();
                    out.add(id, lines.len() >= 2 && bullets == lines.len(), plural(bullets, "bullet"), "FAIL_FORMAT");
                } else {
                    out.add(id, false, "unknown rule".into(), "FAIL_FORMAT");
                }
            }
        }
        Some("thread") => {
            let json: Option<Value> = serde_json::from_str(delivery).ok();
            let posts: Option<Vec<&str>> = json.as_ref().and_then(|v| v["posts"].as_array()).map(|a| a.iter().filter_map(Value::as_str).collect());
            let all = posts.as_ref().map(|p| p.join("\n")).unwrap_or_default();
            let must = strings(&params["mustInclude"]);
            let allowed: HashSet<String> = must.iter().flat_map(|x| HANDLE.find_iter(x).map(|h| h.as_str().to_lowercase())).collect();
            for (id, rule) in items {
                let Some(posts) = &posts else {
                    out.add(id, false, "not a thread".into(), "FAIL_FORMAT");
                    continue;
                };
                if let Some(m) = POST_COUNT.captures(rule) {
                    out.add(id, posts.len() as f64 == m[1].parse::<f64>().unwrap_or(f64::NAN), plural(posts.len(), "post"), "FAIL_FORMAT");
                } else if rule == "post_length <= 280" {
                    let longest = posts.iter().map(|p| weighted_length(p)).max().unwrap_or(0);
                    out.add(id, longest <= 280, format!("longest {longest}"), "FAIL_LENGTH");
                } else if rule == "includes_all" {
                    let n = count_in(&all, &must);
                    out.add(id, n == must.len(), found(n, must.len()), "FAIL_MISSING_ITEM");
                } else if rule == "no_extra_handles" {
                    let used: HashSet<String> = HANDLE.find_iter(&all).map(|h| h.as_str().to_lowercase()).collect();
                    let extra = used.iter().filter(|h| !allowed.contains(*h)).count();
                    out.add(id, extra == 0, if extra > 0 { plural(extra, "extra handle") } else { "none extra".into() }, "FAIL_SAFETY");
                } else {
                    out.add(id, false, "unknown rule".into(), "FAIL_FORMAT");
                }
            }
        }
        _ => {
            // extract
            let json: Option<Value> = serde_json::from_str(delivery).ok();
            let fields: Vec<&Value> = params["schema"]["fields"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
            let many = params["many"] != json!(false);
            let objects = |v: &Value| v.as_object().cloned();
            let records: Option<Vec<Map<String, Value>>> = json.as_ref().and_then(|v| {
                if many { v.as_array().and_then(|a| a.iter().map(objects).collect()) } else { objects(v).map(|o| vec![o]) }
            });
            let src = norm(source);
            for (id, rule) in items {
                if rule == "json_parses" {
                    out.add(id, json.is_some(), (if json.is_some() { "valid JSON" } else { "not JSON" }).into(), "FAIL_FORMAT");
                    continue;
                }
                let Some(records) = &records else {
                    let code = if rule == "matches_schema" { "FAIL_SCHEMA" } else { "FAIL_FORMAT" };
                    out.add(id, false, (if json.is_some() { "wrong shape" } else { "not JSON" }).into(), code);
                    continue;
                };
                let name = |f: &Value| f["name"].as_str().unwrap_or("").to_string();
                if rule == "matches_schema" {
                    let names: HashSet<String> = fields.iter().map(|f| name(f)).collect();
                    let bad = records.iter().filter(|r| r.keys().any(|k| !names.contains(k)) || fields.iter().any(|f| !field_ok(f, r.get(&name(f))))).count();
                    out.add(id, bad == 0, if bad > 0 { format!("{} off schema", plural(bad, "record")) } else { plural(records.len(), "record") }, "FAIL_SCHEMA");
                } else if rule == "required_fields_filled" {
                    let required: Vec<String> = fields.iter().filter(|f| f["required"] == json!(true)).map(|f| name(f)).collect();
                    let filled = |v: Option<&Value>| !matches!(v, None | Some(Value::Null)) && v != Some(&json!(""));
                    let missing = records.iter().filter(|r| required.iter().any(|n| !filled(r.get(n)))).count();
                    out.add(id, missing == 0, if missing > 0 { format!("{} missing", plural(missing, "record")) } else { "all filled".into() }, "FAIL_SCHEMA");
                } else if let Some(m) = TRACEABLE.captures(rule) {
                    let values: Vec<&Value> = records.iter().flat_map(|r| fields.iter().filter_map(|f| r.get(&name(f)))).filter(|v| v.is_string() || v.is_number()).collect();
                    let pct = if values.is_empty() { 100 } else { 100 * values.iter().filter(|v| traceable(v, &src)).count() / values.len() };
                    out.add(id, pct as f64 >= m[1].parse::<f64>().unwrap_or(f64::INFINITY), format!("{pct}% found"), "FAIL_TRACEABILITY");
                } else if let Some(m) = RECORDS.captures(rule) {
                    out.add(id, records.len() as f64 <= m[1].parse::<f64>().unwrap_or(f64::INFINITY), plural(records.len(), "record"), "FAIL_LENGTH");
                } else {
                    out.add(id, false, "unknown rule".into(), "FAIL_FORMAT");
                }
            }
        }
    }
    out.finish()
}
