//! Runs the C test suites (DSP, device shim, engine) with one command:
//!     cargo run --release --bin rfx-tests
//! They need no sound card: the shim uses miniaudio's null backend and the engine test writes its
//! own WAV fixtures into a scratch folder and deletes them afterwards.

use rfx::sys::*;
use std::ffi::CString;

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| std::env::temp_dir().to_string_lossy().into_owned());
    let c_dir = CString::new(dir.clone()).unwrap_or_else(|_| CString::new(".").unwrap());
    let mut failures = 0;

    println!("== DSP ==");
    failures += unsafe { rfx_dsp_test_main() };
    println!("\n== device shim ==");
    failures += unsafe { rfx_shim_test_main() };
    println!("\n== engine ==  (fixtures in {dir})");
    failures += unsafe { rfx_engine_test_main(c_dir.as_ptr()) };

    println!();
    if failures == 0 {
        println!("all native checks passed");
    } else {
        println!("{failures} native checks FAILED");
        std::process::exit(1);
    }
}
