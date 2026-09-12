//! Raw bindings to the RekordFox native audio layer.
//!
//! `sys` mirrors the C shim (`src/rfx_audio.h`), the engine (`src/rfx_engine.h`) and the C test
//! suites. Everything is `unsafe` on purpose: the callers in this crate are thin tools, and the
//! safe wrapper belongs in the Node addon that comes next, where it has a real API to protect.

pub mod sys {
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_double, c_int, c_uint};

    #[link(name = "rfx_audio")]
    extern "C" {
        // --- device shim ---
        pub fn rfx_init() -> c_int;
        pub fn rfx_uninit();
        pub fn rfx_last_error() -> *const c_char;
        pub fn rfx_backend_name() -> *const c_char;
        pub fn rfx_version() -> *const c_char;
        pub fn rfx_device_count() -> c_int;
        pub fn rfx_device_name(index: c_int) -> *const c_char;
        pub fn rfx_device_is_default(index: c_int) -> c_int;
        pub fn rfx_device_max_channels(index: c_int) -> c_int;
        pub fn rfx_device_native_rate(index: c_int) -> c_int;
        pub fn rfx_open(device: c_int, exclusive: c_int, sample_rate: c_uint, channels: c_uint, period_frames: c_uint) -> c_int;
        pub fn rfx_close() -> c_int;
        pub fn rfx_open_device_name() -> *const c_char;
        pub fn rfx_get_int(key: c_int) -> c_int;
        pub fn rfx_get_double(key: c_int) -> c_double;
        pub fn rfx_play_tone(pair: c_int, seconds: c_double, freq: c_double, amplitude: c_double) -> c_int;
        pub fn rfx_tone_busy() -> c_int;

        // --- engine ---
        pub fn rfx_engine_init(sample_rate: c_uint) -> c_int;
        pub fn rfx_engine_shutdown();
        pub fn rfx_engine_last_error() -> *const c_char;
        pub fn rfx_engine_sample_rate() -> c_uint;
        pub fn rfx_engine_attach();
        pub fn rfx_deck_load(deck: c_int, path: *const c_char) -> c_int;
        pub fn rfx_deck_eject(deck: c_int);
        pub fn rfx_deck_length_seconds(deck: c_int) -> c_double;
        pub fn rfx_deck_has_track(deck: c_int) -> c_int;
        pub fn rfx_deck_play(deck: c_int, playing: c_int);
        pub fn rfx_deck_playing(deck: c_int) -> c_int;
        pub fn rfx_deck_seek(deck: c_int, seconds: c_double);
        pub fn rfx_deck_position(deck: c_int) -> c_double;
        pub fn rfx_deck_set_rate(deck: c_int, rate: c_double);
        pub fn rfx_deck_set_scratch(deck: c_int, on: c_int, rate: c_double);
        pub fn rfx_deck_scratch_to(deck: c_int, on: c_int, target_seconds: c_double);
        pub fn rfx_deck_set_loop(deck: c_int, in_seconds: c_double, out_seconds: c_double, active: c_int);
        pub fn rfx_deck_set_channel(deck: c_int, trim: c_double, eq_hi: c_double, eq_mid: c_double, eq_low: c_double, cfx: c_double, fader: c_double, pfl: c_int);
        pub fn rfx_engine_set_master(crossfader: c_double, master: c_double, phones: c_double, phones_mix: c_double, master_cue: c_int);
        pub fn rfx_probe_file(path: *const c_char, length_seconds: *mut c_double, sample_rate: *mut c_int, channels: *mut c_int) -> c_int;
        pub fn rfx_deck_peak(deck: c_int) -> c_double;
        pub fn rfx_engine_master_peak() -> c_double;
        pub fn rfx_engine_frames_rendered() -> u64;
        pub fn rfx_engine_underruns() -> c_uint;

        // --- C test suites ---
        pub fn rfx_dsp_test_main() -> c_int;
        pub fn rfx_engine_test_main(scratch_dir: *const c_char) -> c_int;
        pub fn rfx_shim_test_main() -> c_int;
    }

    /// A C string from the shim as an owned Rust string ("" when null).
    pub fn cstr(p: *const c_char) -> String {
        if p.is_null() {
            return String::new();
        }
        unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
    }
}
