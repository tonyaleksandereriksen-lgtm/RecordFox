//! Plays real audio through the DDJ-FLX2 with the native engine — the first time RekordFox makes
//! a sound. A scripted run: play, tempo, EQ kill, filter sweep, crossfade, headphone cue, scratch
//! and a loop, narrating each step so you can hear whether it is right.
//!
//!     cargo run --release --bin rfx-demo -- "C:\Music\track-a.mp3" ["...\track-b.mp3"]
//!
//! Any wav, flac or mp3 works. With one file, deck B stays empty and the crossfade step is skipped.

use rfx::sys::*;
use std::ffi::CString;
use std::io::Write;
use std::thread::sleep;
use std::time::{Duration, Instant};

const RATE: u32 = 48000;

fn say(step: &str, detail: &str) {
    println!("\n▶ {step}");
    if !detail.is_empty() {
        println!("  {detail}");
    }
    let _ = std::io::stdout().flush();
}

/// Sleeps while showing the deck positions and the master meter, so a stall is obvious.
fn hold(seconds: f64, decks: usize) {
    let end = Instant::now() + Duration::from_secs_f64(seconds);
    while Instant::now() < end {
        sleep(Duration::from_millis(250));
        let mut line = String::new();
        for d in 0..decks {
            let pos = unsafe { rfx_deck_position(d as i32) };
            line.push_str(&format!("  {} {:>6.2}s", if d == 0 { "A" } else { "B" }, pos));
        }
        let peak = unsafe { rfx_engine_master_peak() };
        let bars = (peak * 24.0).min(24.0) as usize;
        print!("\r   {line}   master |{:<24}| {:.2}  ", "#".repeat(bars), peak);
        let _ = std::io::stdout().flush();
    }
    println!();
}

fn load(deck: i32, path: &str) -> bool {
    let c = match CString::new(path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    if unsafe { rfx_deck_load(deck, c.as_ptr()) } != 0 {
        println!("  could not load {path}: {}", cstr(unsafe { rfx_engine_last_error() }));
        return false;
    }
    println!(
        "  deck {} loaded: {} ({:.1} s)",
        if deck == 0 { "A" } else { "B" },
        path,
        unsafe { rfx_deck_length_seconds(deck) }
    );
    true
}

/// Neutral channel: trim/EQ/CFX centred, fader down, no cue.
fn reset_channel(deck: i32) {
    unsafe { rfx_deck_set_channel(deck, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 0) };
}

fn main() {
    let files: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect();
    if files.is_empty() {
        eprintln!("Give me one or two audio files to play:");
        eprintln!("  cargo run --release --bin rfx-demo -- \"C:\\Music\\a.mp3\" \"C:\\Music\\b.mp3\"");
        std::process::exit(2);
    }

    println!("RekordFox — engine demo (miniaudio {})", cstr(unsafe { rfx_version() }));
    println!("Close anything else using the FLX2, put your headphones on, and keep the master output up.");

    if unsafe { rfx_init() } != 0 {
        eprintln!("Could not start the audio backend: {}", cstr(unsafe { rfx_last_error() }));
        std::process::exit(1);
    }

    // Find the FLX2, fall back to the default device.
    let count = unsafe { rfx_device_count() };
    let mut device = -1;
    for i in 0..count {
        let name = cstr(unsafe { rfx_device_name(i) }).to_lowercase();
        if name.contains("flx2") || name.contains("flx-2") {
            device = i;
            break;
        }
    }
    if device < 0 {
        println!("No DDJ-FLX2 found — using the default output (no headphone cue there).");
    }

    // Exclusive at 96 frames first: that is what the probe measured at 4 ms.
    let mut opened = false;
    for (exclusive, period) in [(1, 96u32), (1, 128), (1, 256), (0, 0)] {
        if unsafe { rfx_open(device, exclusive, RATE, 4, period) } == 0 {
            opened = true;
            break;
        }
        println!("  {} {} frames: {}", if exclusive == 1 { "exclusive" } else { "shared" }, period, cstr(unsafe { rfx_last_error() }));
    }
    if !opened && unsafe { rfx_open(device, 0, 0, 2, 0) } != 0 {
        eprintln!("Could not open any output: {}", cstr(unsafe { rfx_last_error() }));
        unsafe { rfx_uninit() };
        std::process::exit(1);
    }

    let channels = unsafe { rfx_get_int(1) } as u32;
    let rate = unsafe { rfx_get_int(0) } as u32;
    println!(
        "\nOutput: {} — {} Hz, {} ch, {} x {} frames = {:.2} ms{}",
        cstr(unsafe { rfx_open_device_name() }),
        rate,
        channels,
        unsafe { rfx_get_int(3) },
        unsafe { rfx_get_int(2) },
        unsafe { rfx_get_double(0) },
        if unsafe { rfx_get_int(4) } == 1 { ", exclusive" } else { ", shared" }
    );
    if channels < 4 {
        println!("This output has {channels} channels, so the headphone-cue step will be silent.");
    }

    if unsafe { rfx_engine_init(rate) } != 0 {
        eprintln!("Engine refused to start: {}", cstr(unsafe { rfx_engine_last_error() }));
        unsafe { rfx_close(); rfx_uninit() };
        std::process::exit(1);
    }
    unsafe { rfx_engine_attach() };

    println!("\nLoading…");
    let a_ok = load(0, &files[0]);
    let b_ok = files.len() > 1 && load(1, &files[1]);
    if !a_ok {
        unsafe { rfx_engine_shutdown(); rfx_close(); rfx_uninit() };
        std::process::exit(1);
    }
    let decks = if b_ok { 2 } else { 1 };

    reset_channel(0);
    reset_channel(1);
    unsafe {
        rfx_engine_set_master(0.0, 0.75, 0.7, 0.0, 0); // crossfader hard to deck A
        rfx_deck_seek(0, 0.0);
        rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
        rfx_deck_play(0, 1);
    }

    say("Deck A playing", "fader up, crossfader hard left, EQ flat");
    hold(6.0, decks);

    say("Tempo +6%", "the same resampling path a jog bend and the tempo slider use");
    unsafe { rfx_deck_set_rate(0, 1.06) };
    hold(5.0, decks);
    unsafe { rfx_deck_set_rate(0, 1.0) };

    say("Low kill, then back", "3-band isolator: the bass should vanish and return cleanly");
    unsafe { rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.0, 0.5, 1.0, 0) };
    hold(4.0, decks);
    unsafe { rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0) };
    hold(1.5, decks);

    say("Sound Color FX sweep", "knob from centre to full low-pass and back, then into high-pass");
    {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs_f64(8.0) {
            let t = start.elapsed().as_secs_f64() / 8.0;
            // 0.5 -> 0.0 -> 0.5 -> 1.0
            let knob = if t < 0.33 {
                0.5 - (t / 0.33) * 0.5
            } else if t < 0.66 {
                ((t - 0.33) / 0.33) * 0.5
            } else {
                0.5 + ((t - 0.66) / 0.34) * 0.5
            };
            unsafe { rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, knob, 1.0, 0) };
            sleep(Duration::from_millis(20));
        }
        unsafe { rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0) };
    }

    if b_ok {
        say("Crossfade to deck B", "constant-power curve, both decks playing");
        unsafe {
            rfx_deck_seek(1, 0.0);
            rfx_deck_set_channel(1, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
            rfx_deck_play(1, 1);
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs_f64(8.0) {
            let x = start.elapsed().as_secs_f64() / 8.0;
            unsafe { rfx_engine_set_master(x, 0.75, 0.7, 0.0, 0) };
            sleep(Duration::from_millis(20));
        }
        hold(3.0, decks);
    }

    if channels >= 4 {
        say("Headphone cue", "deck A's fader is closed: silent on master, audible in your headphones");
        unsafe {
            rfx_engine_set_master(1.0, 0.75, 0.7, 0.0, 0);
            rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 1);
        }
        hold(6.0, decks);
        unsafe { rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0) };
    }

    say("Scratch", "the jog path: the playhead is driven by hand, backwards and forwards");
    unsafe {
        rfx_engine_set_master(0.0, 0.75, 0.7, 0.0, 0);
        if b_ok {
            rfx_deck_play(1, 0);
        }
        rfx_deck_seek(0, 30.0_f64.min(rfx_deck_length_seconds(0) * 0.4));
    }
    {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs_f64(6.0) {
            let t = start.elapsed().as_secs_f64();
            let rate = (t * 2.2 * std::f64::consts::PI).sin() * 2.2;  // back and forth, faster than 1x
            unsafe { rfx_deck_set_scratch(0, 1, rate) };
            sleep(Duration::from_millis(8));
        }
        unsafe { rfx_deck_set_scratch(0, 0, 0.0) };
    }
    hold(2.0, decks);

    say("Two-second loop", "the playhead wraps without a click");
    {
        let pos = unsafe { rfx_deck_position(0) };
        unsafe { rfx_deck_set_loop(0, pos, pos + 2.0, 1) };
        hold(7.0, decks);
        unsafe { rfx_deck_set_loop(0, 0.0, 0.0, 0) };
    }

    say("Done", "");
    println!(
        "  frames rendered: {}   underruns: {}   deck A peak: {:.2}",
        unsafe { rfx_engine_frames_rendered() },
        unsafe { rfx_engine_underruns() },
        unsafe { rfx_deck_peak(0) }
    );
    println!("  callbacks: {:.0}, largest block {:.0} frames", unsafe { rfx_get_double(1) }, unsafe { rfx_get_double(3) });

    unsafe {
        rfx_deck_play(0, 0);
        rfx_deck_play(1, 0);
        rfx_engine_shutdown();
        rfx_close();
        rfx_uninit();
    }
    println!("\nHow did it sound? Anything that clicked, stuttered or came out of the wrong socket is a bug — tell Claude.");
    print!("Press Enter to close… ");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
}
