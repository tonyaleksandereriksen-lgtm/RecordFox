/* Compiles the C shim (and miniaudio with it). No other build step is needed. */
fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    let mut build = cc::Build::new();
    build
        .file("src/rfx_audio.c")
        .file("src/rfx_dsp.c")
        .file("src/rfx_engine.c")
        .file("src/rfx_fft.c")
        .file("src/rfx_analyze.c")
        // The C test suites ride along so `cargo run --bin rfx-tests` needs no extra tooling.
        .file("tests/dsp_test.c")
        .file("tests/shim_test.c")
        .file("tests/engine_test.c")
        .file("tests/analyze_test.c")
        .include("vendor")
        .include("src")
        .include("tests")
        .warnings(false);

    // miniaudio wants these on the Unix side; Windows links what it needs by itself.
    if target_os == "linux" || target_os == "android" {
        println!("cargo:rustc-link-lib=dylib=dl");
        println!("cargo:rustc-link-lib=dylib=pthread");
        println!("cargo:rustc-link-lib=dylib=m");
    }
    if target_os == "macos" || target_os == "ios" {
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
    }

    build.compile("rfx_audio");

    for f in [
        "src/rfx_audio.c",
        "src/rfx_audio.h",
        "src/rfx_dsp.c",
        "src/rfx_dsp.h",
        "src/rfx_engine.c",
        "src/rfx_engine.h",
        "src/rfx_atomic.h",
        "src/rfx_file.h",
        "src/rfx_fft.c",
        "src/rfx_fft.h",
        "src/rfx_analyze.c",
        "src/rfx_analyze.h",
        "tests/dsp_test.c",
        "tests/shim_test.c",
        "tests/engine_test.c",
        "tests/analyze_test.c",
    ] {
        println!("cargo:rerun-if-changed={f}");
    }
    println!("cargo:rerun-if-changed=vendor/miniaudio.h");
}
