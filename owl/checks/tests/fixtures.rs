//! Every file in fixtures/checks must come out exactly as the TypeScript version produced it (NFR-02, ROADMAP G2).
use serde_json::Value;
use shark_checks::run_code_checks;
use std::fs;
use std::path::Path;

#[test]
fn every_shared_fixture_matches_the_typescript_result() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/checks");
    let mut seen = 0;
    for kind in ["summary", "thread", "extract"] {
        for entry in fs::read_dir(root.join(kind)).expect("fixtures/checks exists") {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let fx: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            let got = run_code_checks(&fx["brief"], fx["source"].as_str().unwrap(), fx["delivery"].as_str().unwrap()).to_json();
            assert_eq!(got, fx["expected"], "{}", path.display());
            seen += 1;
        }
    }
    assert!(seen >= 20, "found only {seen} fixtures");
}
