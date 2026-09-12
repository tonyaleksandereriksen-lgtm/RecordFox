//! RekordFox native audio probe.
//!
//! The browser engine measured ~52 ms of output latency on the DDJ-FLX2 (docs/audio-check-*.json),
//! which is fine for mixing and hopeless for scratching. This probe answers the follow-up question:
//! what does the same hardware give us through a native path — WASAPI **exclusive** on Windows,
//! CoreAudio on macOS — and can master (ch 1/2) and headphones (ch 3/4) really be driven apart?
//!
//! Build and run:  cargo run --release
//! It prints a report and writes audio-native-check.json next to where you ran it.

use rfx::sys::*;
use std::io::Write;
use std::time::{Duration, Instant};

/// One open attempt and what the device actually gave us.
struct Attempt {
    label: String,
    exclusive_asked: bool,
    asked_rate: u32,
    asked_channels: u32,
    asked_period: u32,
    ok: bool,
    error: String,
    exclusive_granted: bool,
    sample_rate: i32,
    channels: i32,
    period_frames: i32,
    periods: i32,
    latency_ms: f64,
}

impl Attempt {
    fn json(&self) -> String {
        format!(
            "{{\"label\":\"{}\",\"asked\":{{\"exclusive\":{},\"sampleRate\":{},\"channels\":{},\"periodFrames\":{}}},\"ok\":{},\"error\":\"{}\",\"exclusiveGranted\":{},\"sampleRate\":{},\"channels\":{},\"periodFrames\":{},\"periods\":{},\"bufferLatencyMs\":{:.2}}}",
            escape(&self.label),
            self.exclusive_asked,
            self.asked_rate,
            self.asked_channels,
            self.asked_period,
            self.ok,
            escape(&self.error),
            self.exclusive_granted,
            self.sample_rate,
            self.channels,
            self.period_frames,
            self.periods,
            self.latency_ms
        )
    }
}

fn escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '"' => vec!['\\', '"'],
            '\\' => vec!['\\', '\\'],
            '\n' | '\r' | '\t' => vec![' '],
            c if (c as u32) < 0x20 => vec![' '],
            c => vec![c],
        })
        .collect()
}

fn try_open(label: &str, device: i32, exclusive: bool, rate: u32, channels: u32, period: u32) -> Attempt {
    let rc = unsafe { rfx_open(device, if exclusive { 1 } else { 0 }, rate, channels, period) };
    let mut a = Attempt {
        label: label.to_string(),
        exclusive_asked: exclusive,
        asked_rate: rate,
        asked_channels: channels,
        asked_period: period,
        ok: rc == 0,
        error: if rc == 0 { String::new() } else { cstr(unsafe { rfx_last_error() }) },
        exclusive_granted: false,
        sample_rate: 0,
        channels: 0,
        period_frames: 0,
        periods: 0,
        latency_ms: 0.0,
    };
    if rc == 0 {
        unsafe {
            a.exclusive_granted = rfx_get_int(4) == 1;
            a.sample_rate = rfx_get_int(0);
            a.channels = rfx_get_int(1);
            a.period_frames = rfx_get_int(2);
            a.periods = rfx_get_int(3);
            a.latency_ms = rfx_get_double(0);
        }
    }
    a
}

fn ask(question: &str) -> String {
    print!("{} ", question);
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return String::new();
    }
    line.trim().to_lowercase()
}

fn heard(answer: &str) -> &'static str {
    match answer.chars().next() {
        Some('y') | Some('j') => "heard",
        Some('n') => "not heard",
        _ => "skipped",
    }
}

fn main() {
    println!("RekordFox — native audio probe (miniaudio {})", cstr(unsafe { rfx_version() }));
    println!("Close rekordbox, Serato, Spotify and any browser playing audio first: exclusive mode needs the device to itself.\n");

    if unsafe { rfx_init() } != 0 {
        eprintln!("Could not start the audio backend: {}", cstr(unsafe { rfx_last_error() }));
        std::process::exit(1);
    }
    let backend = cstr(unsafe { rfx_backend_name() });
    println!("Backend: {}", backend);

    let count = unsafe { rfx_device_count() };
    if count <= 0 {
        eprintln!("No output devices found.");
        std::process::exit(1);
    }
    println!("Output devices:");
    let mut flx2: Option<i32> = None;
    for i in 0..count {
        let name = cstr(unsafe { rfx_device_name(i) });
        let is_default = unsafe { rfx_device_is_default(i) } == 1;
        let max_ch = unsafe { rfx_device_max_channels(i) };
        let rate = unsafe { rfx_device_native_rate(i) };
        println!(
            "  [{}] {}{}{}{}",
            i,
            name,
            if is_default { "  (default)" } else { "" },
            if max_ch > 0 { format!("  up to {} ch", max_ch) } else { String::new() },
            if rate > 0 { format!("  {} Hz", rate) } else { String::new() },
        );
        let lower = name.to_lowercase();
        if flx2.is_none() && (lower.contains("flx2") || lower.contains("flx-2")) {
            flx2 = Some(i);
        }
    }

    // Pick the device: argument wins, then an FLX2 by name, then ask.
    let device = match std::env::args().nth(1).and_then(|a| a.parse::<i32>().ok()) {
        Some(i) if i >= 0 && i < count => i,
        _ => match flx2 {
            Some(i) => {
                println!("\nUsing [{}] {} (matched DDJ-FLX2).", i, cstr(unsafe { rfx_device_name(i) }));
                i
            }
            None => {
                let answer = ask("\nNo DDJ-FLX2 in the list. Which device number should I test?");
                match answer.parse::<i32>() {
                    Ok(i) if i >= 0 && i < count => i,
                    _ => {
                        eprintln!("Not a device number — stopping.");
                        unsafe { rfx_uninit() };
                        std::process::exit(1);
                    }
                }
            }
        },
    };

    let device_name = cstr(unsafe { rfx_device_name(device) });
    let native_rate = unsafe { rfx_device_native_rate(device) }.max(0) as u32;
    let max_channels = unsafe { rfx_device_max_channels(device) }.max(0) as u32;

    // Exclusive first, smallest sensible buffer first; then looser asks; shared last as the baseline.
    let mut plans: Vec<(String, bool, u32, u32, u32)> = Vec::new();
    let rate = if native_rate > 0 { native_rate } else { 48000 };
    let channels = if max_channels >= 4 { 4 } else { 2 };
    plans.push((format!("exclusive {} ch @ {} Hz, 96-frame period", channels, rate), true, rate, channels, 96));
    plans.push((format!("exclusive {} ch @ {} Hz, 128-frame period", channels, rate), true, rate, channels, 128));
    plans.push((format!("exclusive {} ch @ {} Hz, 256-frame period", channels, rate), true, rate, channels, 256));
    plans.push((format!("exclusive {} ch @ {} Hz, device default period", channels, rate), true, rate, channels, 0));
    if channels == 4 {
        plans.push(("exclusive 2 ch, device default period".to_string(), true, rate, 2, 0));
    }
    plans.push((format!("shared {} ch (what the browser gets)", channels), false, 0, channels, 0));

    println!("\nTrying to open “{}”:", device_name);
    let mut attempts: Vec<Attempt> = Vec::new();
    for (label, exclusive, rate, ch, period) in plans {
        let a = try_open(&label, device, exclusive, rate, ch, period);
        if a.ok {
            println!(
                "  ok    {:<46} -> {} Hz, {} ch, {} x {} frames = {:.2} ms{}",
                a.label,
                a.sample_rate,
                a.channels,
                a.periods,
                a.period_frames,
                a.latency_ms,
                if a.exclusive_asked && !a.exclusive_granted { "  (fell back to shared)" } else { "" }
            );
            unsafe { rfx_close() };
        } else {
            println!("  no    {:<46} -> {}", a.label, a.error);
        }
        attempts.push(a);
    }

    // Best = lowest latency that actually got exclusive mode; otherwise the best that opened at all.
    let best = attempts
        .iter()
        .filter(|a| a.ok && a.exclusive_granted)
        .min_by(|a, b| a.latency_ms.partial_cmp(&b.latency_ms).unwrap_or(std::cmp::Ordering::Equal))
        .or_else(|| {
            attempts
                .iter()
                .filter(|a| a.ok)
                .min_by(|a, b| a.latency_ms.partial_cmp(&b.latency_ms).unwrap_or(std::cmp::Ordering::Equal))
        });

    let mut master = "skipped".to_string();
    let mut phones = "skipped".to_string();
    let mut callback_ms = 0.0f64;
    let mut callback_jitter_frames = 0i32;
    let mut best_label = String::new();
    let mut best_latency = 0.0f64;
    let mut best_exclusive = false;
    let mut best_channels = 0i32;

    if let Some(b) = best {
        best_label = b.label.clone();
        best_latency = b.latency_ms;
        best_exclusive = b.exclusive_granted;
        best_channels = b.channels;
        println!("\nBest: {} — {:.2} ms output buffer.", b.label, b.latency_ms);

        let reopened = try_open(&b.label, device, b.exclusive_asked, b.asked_rate, b.asked_channels, b.asked_period);
        if reopened.ok {
            println!("Open as “{}”.", cstr(unsafe { rfx_open_device_name() }));
            // How steady is the callback? Sample the counters over a couple of seconds.
            let frames0 = unsafe { rfx_get_double(2) };
            let calls0 = unsafe { rfx_get_double(1) };
            let t0 = Instant::now();
            std::thread::sleep(Duration::from_millis(2000));
            let elapsed = t0.elapsed().as_secs_f64();
            let calls = unsafe { rfx_get_double(1) } - calls0;
            let frames = unsafe { rfx_get_double(2) } - frames0;
            callback_jitter_frames = unsafe { rfx_get_double(3) } as i32;
            if calls > 0.0 {
                callback_ms = elapsed * 1000.0 / calls;
            }
            println!(
                "Callback: {:.0} calls in {:.2} s ({:.2} ms apart, {:.0} frames written, largest block {} frames).",
                calls, elapsed, callback_ms, frames, callback_jitter_frames
            );

            println!("\nPut your headphones on and keep the master output audible.");
            let _ = ask("Press Enter to play a tone on MASTER (channels 1/2)…");
            unsafe { rfx_play_tone(0, 1.5, 660.0, 0.25) };
            while unsafe { rfx_tone_busy() } == 1 {
                std::thread::sleep(Duration::from_millis(20));
            }
            master = heard(&ask("Did you hear it on the master output? [y/n]")).to_string();

            if reopened.channels >= 4 {
                let _ = ask("Press Enter to play a tone on HEADPHONES (channels 3/4)…");
                unsafe { rfx_play_tone(1, 1.5, 880.0, 0.25) };
                while unsafe { rfx_tone_busy() } == 1 {
                    std::thread::sleep(Duration::from_millis(20));
                }
                phones = heard(&ask("Did you hear it in the headphones only? [y/n]")).to_string();
            } else {
                println!("This device opened with {} channels, so there is no separate headphone pair to test.", reopened.channels);
            }
            unsafe { rfx_close() };
        } else {
            println!("Could not reopen it for the tone test: {}", reopened.error);
        }
    } else {
        println!("\nNothing opened. Is another app holding the device?");
    }

    let verdict = if !best_exclusive {
        "Exclusive mode did not open — check Windows › Sound › this device › Properties › Advanced › “Allow applications to take exclusive control”, and close anything else using the FLX2.".to_string()
    } else if best_latency <= 12.0 {
        format!("{:.1} ms output buffer in exclusive mode — good enough for scratching. Build the engine on this path.", best_latency)
    } else if best_latency <= 25.0 {
        format!("{:.1} ms output buffer — fine for mixing, soft for scratching. Worth trying an ASIO driver before settling.", best_latency)
    } else {
        format!("{:.1} ms even in exclusive mode — the device or driver is the limit; look for an ASIO driver.", best_latency)
    };
    println!("\n{}", verdict);

    let json = format!(
        "{{\n  \"at\": \"{}\",\n  \"os\": \"{}\",\n  \"backend\": \"{}\",\n  \"miniaudio\": \"{}\",\n  \"device\": \"{}\",\n  \"deviceMaxChannels\": {},\n  \"deviceNativeRate\": {},\n  \"attempts\": [\n    {}\n  ],\n  \"best\": {{\"label\": \"{}\", \"exclusive\": {}, \"channels\": {}, \"bufferLatencyMs\": {:.2}, \"callbackMs\": {:.2}, \"largestCallbackFrames\": {}}},\n  \"channelTest\": {{\"master\": \"{}\", \"phones\": \"{}\"}},\n  \"verdict\": \"{}\"\n}}\n",
        chrono_now(),
        std::env::consts::OS,
        escape(&backend),
        escape(&cstr(unsafe { rfx_version() })),
        escape(&device_name),
        max_channels,
        native_rate,
        attempts.iter().map(|a| a.json()).collect::<Vec<_>>().join(",\n    "),
        escape(&best_label),
        best_exclusive,
        best_channels,
        best_latency,
        callback_ms,
        callback_jitter_frames,
        master,
        phones,
        escape(&verdict)
    );

    match std::fs::write("audio-native-check.json", &json) {
        Ok(()) => println!("\nWritten to audio-native-check.json — paste it back to Claude:\n"),
        Err(e) => println!("\n(Could not write audio-native-check.json: {e}. Copy the JSON below instead.)\n"),
    }
    println!("{}", json);

    unsafe { rfx_uninit() };
    let _ = ask("Press Enter to close…");
}

/// UTC timestamp as ISO-8601, without pulling in a date crate (civil-from-days, Howard Hinnant).
fn chrono_now() -> String {
    let secs = match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(_) => return "unknown".to_string(),
    };
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, tod / 3600, (tod % 3600) / 60, tod % 60)
}
