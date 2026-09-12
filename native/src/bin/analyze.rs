//! Analyse audio files the way the library will on import — BPM, downbeat, key and the 3-band
//! waveform — and print the result.
//!
//!     cargo run --release --bin rfx-analyze -- <file or folder> [...]
//!     cargo run --release --bin rfx-analyze -- --json --out analysis.json D:\Music
//!
//! miniaudio decodes WAV, MP3 and FLAC without any extra dependency; anything else is reported as
//! unreadable rather than guessed at. `--wave <dir>` also writes one `<name>.rfxwave` per track:
//! a flat low/mid/high byte triple per 10 ms, which is exactly what the deck overview draws.

use rfx::sys::*;
use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};

const AUDIO_EXT: [&str; 5] = ["wav", "mp3", "flac", "wave", "mp2"];

struct Result_ {
    path: PathBuf,
    ok: bool,
    error: String,
    duration: f64,
    bpm: f64,
    bpm_confidence: f64,
    first_beat: f64,
    key_name: String,
    camelot: String,
    key_fit: f64,
    key_margin: f64,
    bins: i32,
    rate: i32,
    channels: i32,
}

fn collect(target: &Path, into: &mut Vec<PathBuf>) {
    if target.is_dir() {
        let mut entries: Vec<PathBuf> = match std::fs::read_dir(target) {
            Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
            Err(_) => return,
        };
        entries.sort();
        for e in entries {
            collect(&e, into);
        }
        return;
    }
    let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if AUDIO_EXT.contains(&ext.as_str()) {
        into.push(target.to_path_buf());
    }
}

fn text(key: i32) -> String {
    unsafe { CStr::from_ptr(rfx_analysis_text(key)).to_string_lossy().into_owned() }
}

fn analyse(path: &Path, wave_dir: Option<&Path>) -> Result_ {
    let c_path = match CString::new(path.to_string_lossy().as_bytes()) {
        Ok(c) => c,
        Err(_) => {
            return Result_ {
                path: path.to_path_buf(), ok: false, error: "path is not representable".into(),
                duration: 0.0, bpm: 0.0, bpm_confidence: 0.0, first_beat: 0.0,
                key_name: String::new(), camelot: String::new(), key_fit: 0.0, key_margin: 0.0,
                bins: 0, rate: 0, channels: 0,
            };
        }
    };
    let rc = unsafe { rfx_analysis_run(c_path.as_ptr()) };
    let error = unsafe { CStr::from_ptr(rfx_analysis_error()).to_string_lossy().into_owned() };
    let out = Result_ {
        path: path.to_path_buf(),
        ok: rc == 0,
        error,
        duration: unsafe { rfx_analysis_double(0) },
        bpm: unsafe { rfx_analysis_double(1) },
        bpm_confidence: unsafe { rfx_analysis_double(2) },
        first_beat: unsafe { rfx_analysis_double(3) },
        key_fit: unsafe { rfx_analysis_double(4) },
        key_margin: unsafe { rfx_analysis_double(5) },
        rate: unsafe { rfx_analysis_int(1) },
        channels: unsafe { rfx_analysis_int(2) },
        bins: unsafe { rfx_analysis_int(5) },
        key_name: text(1),
        camelot: text(0),
    };

    if out.ok {
        if let Some(dir) = wave_dir {
            let mut buf = vec![0u8; (out.bins.max(0) as usize) * 3];
            let bins = unsafe { rfx_analysis_wave(buf.as_mut_ptr(), buf.len() as i32) };
            if bins > 0 {
                let stem = path.file_name().and_then(|n| n.to_str()).unwrap_or("track");
                let dest = dir.join(format!("{stem}.rfxwave"));
                if let Err(e) = std::fs::write(&dest, &buf[..(bins as usize) * 3]) {
                    eprintln!("  could not write {}: {e}", dest.display());
                }
            }
        }
    }
    unsafe { rfx_analysis_release() };
    out
}

fn json_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o
}

fn as_json(all: &[Result_]) -> String {
    let mut s = String::from("[\n");
    for (i, r) in all.iter().enumerate() {
        s.push_str("  {\n");
        s.push_str(&format!("    \"file\": \"{}\",\n", json_escape(&r.path.to_string_lossy())));
        s.push_str(&format!("    \"ok\": {},\n", r.ok));
        if r.ok {
            s.push_str(&format!("    \"durationSec\": {:.3},\n", r.duration));
            s.push_str(&format!("    \"sourceRate\": {},\n", r.rate));
            s.push_str(&format!("    \"sourceChannels\": {},\n", r.channels));
            s.push_str(&format!("    \"bpm\": {:.2},\n", r.bpm));
            s.push_str(&format!("    \"bpmConfidence\": {:.3},\n", r.bpm_confidence));
            s.push_str(&format!("    \"firstBeatSec\": {:.4},\n", r.first_beat));
            s.push_str(&format!("    \"key\": \"{}\",\n", json_escape(&r.key_name)));
            s.push_str(&format!("    \"camelot\": \"{}\",\n", json_escape(&r.camelot)));
            s.push_str(&format!("    \"keyFit\": {:.3},\n", r.key_fit));
            s.push_str(&format!("    \"keyMargin\": {:.3},\n", r.key_margin));
            s.push_str(&format!("    \"waveformBins\": {}\n", r.bins));
        } else {
            s.push_str(&format!("    \"error\": \"{}\"\n", json_escape(&r.error)));
        }
        s.push_str(if i + 1 == all.len() { "  }\n" } else { "  },\n" });
    }
    s.push_str("]\n");
    s
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut want_json = false;
    let mut out_file: Option<PathBuf> = None;
    let mut wave_dir: Option<PathBuf> = None;
    let mut targets: Vec<PathBuf> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => want_json = true,
            "--out" => {
                i += 1;
                out_file = args.get(i).map(PathBuf::from);
            }
            "--wave" => {
                i += 1;
                wave_dir = args.get(i).map(PathBuf::from);
            }
            "-h" | "--help" => {
                println!("rfx-analyze [--json] [--out FILE] [--wave DIR] <file or folder>...");
                println!("  WAV, MP3 and FLAC. Prints BPM, downbeat, key and waveform size.");
                return;
            }
            other => targets.push(PathBuf::from(other)),
        }
        i += 1;
    }

    if targets.is_empty() {
        eprintln!("nothing to analyse. rfx-analyze --help");
        std::process::exit(2);
    }

    let mut files: Vec<PathBuf> = Vec::new();
    for t in &targets {
        collect(t, &mut files);
    }
    if files.is_empty() {
        eprintln!("no WAV, MP3 or FLAC files found in {} target(s)", targets.len());
        std::process::exit(2);
    }
    if let Some(dir) = &wave_dir {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("could not create {}: {e}", dir.display());
            std::process::exit(1);
        }
    }

    let mut all = Vec::with_capacity(files.len());
    for f in &files {
        if !want_json {
            println!("analysing {}", f.display());
        }
        let started = std::time::Instant::now();
        let r = analyse(f, wave_dir.as_deref());
        if !want_json {
            if r.ok {
                println!(
                    "  {:.2} BPM  first beat {:.3} s  {} ({})  {:.0}:{:02.0}  [{:.1} s to analyse]",
                    r.bpm,
                    r.first_beat,
                    r.key_name,
                    r.camelot,
                    (r.duration / 60.0).floor(),
                    r.duration % 60.0,
                    started.elapsed().as_secs_f64()
                );
            } else {
                println!("  could not analyse: {}", r.error);
            }
        }
        all.push(r);
    }

    let failed = all.iter().filter(|r| !r.ok).count();
    if want_json || out_file.is_some() {
        let json = as_json(&all);
        match &out_file {
            Some(p) => match std::fs::write(p, &json) {
                Ok(()) => eprintln!("wrote {}", p.display()),
                Err(e) => {
                    eprintln!("could not write {}: {e}", p.display());
                    std::process::exit(1);
                }
            },
            None => print!("{json}"),
        }
    }
    if !want_json {
        println!("\n{} analysed, {} failed", all.len() - failed, failed);
    }
    if failed > 0 && failed == all.len() {
        std::process::exit(1);
    }
}
