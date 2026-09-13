//! RekordFox native audio as a Node-API addon. This is the safe wrapper over `rfx::sys` that the
//! Electron main process loads (`native/node/rfx.node`, built by `npm run native`).
//!
//! Everything here runs on the caller's thread except `deckLoad` and `probeFile`, which decode on
//! the libuv thread pool and resolve a Promise, so a two-second mp3 decode never stalls IPC.
//! The engine contract still holds: the audio thread is only ever touched through the atomics in
//! the C engine, and nothing in here allocates on its behalf.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rfx::sys::*;
use std::ffi::CString;

fn fail(msg: String) -> Error {
    Error::new(Status::GenericFailure, msg)
}

fn shim_error(what: &str) -> Error {
    fail(format!("{what}: {}", cstr(unsafe { rfx_last_error() })))
}

fn engine_error(what: &str) -> Error {
    fail(format!("{what}: {}", cstr(unsafe { rfx_engine_last_error() })))
}

fn c_path(path: &str) -> Result<CString> {
    CString::new(path).map_err(|_| fail("the path contains a NUL byte".into()))
}

fn deck_index(deck: i32) -> Result<i32> {
    if (0..2).contains(&deck) {
        Ok(deck)
    } else {
        Err(fail(format!("no such deck: {deck}")))
    }
}

/// miniaudio's version string.
#[napi]
pub fn version() -> String {
    cstr(unsafe { rfx_version() })
}

/// Starts the audio backend and enumerates outputs. Returns the backend's name ("WASAPI", or
/// "Null" when RFX_BACKEND=null). Safe to call again; it is a no-op once started.
#[napi]
pub fn init() -> Result<String> {
    if unsafe { rfx_init() } != 0 {
        return Err(shim_error("could not start the audio backend"));
    }
    Ok(cstr(unsafe { rfx_backend_name() }))
}

/// Closes the device (if open) and shuts the backend down.
#[napi]
pub fn uninit() {
    unsafe { rfx_uninit() }
}

#[napi(object)]
pub struct DeviceInfo {
    pub index: i32,
    pub name: String,
    pub is_default: bool,
    /// 0 when the backend did not say.
    pub max_channels: i32,
    /// 0 when the backend did not say.
    pub native_rate: i32,
}

#[napi]
pub fn devices() -> Vec<DeviceInfo> {
    let count = unsafe { rfx_device_count() };
    (0..count)
        .map(|i| DeviceInfo {
            index: i,
            name: cstr(unsafe { rfx_device_name(i) }),
            is_default: unsafe { rfx_device_is_default(i) } != 0,
            max_channels: unsafe { rfx_device_max_channels(i) },
            native_rate: unsafe { rfx_device_native_rate(i) },
        })
        .collect()
}

#[napi(object)]
pub struct OpenInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub period_frames: u32,
    pub periods: u32,
    pub exclusive: bool,
    /// Output buffer latency: periods x period size, in milliseconds.
    pub latency_ms: f64,
}

fn open_info() -> OpenInfo {
    OpenInfo {
        name: cstr(unsafe { rfx_open_device_name() }),
        sample_rate: unsafe { rfx_get_int(0) }.max(0) as u32,
        channels: unsafe { rfx_get_int(1) }.max(0) as u32,
        period_frames: unsafe { rfx_get_int(2) }.max(0) as u32,
        periods: unsafe { rfx_get_int(3) }.max(0) as u32,
        exclusive: unsafe { rfx_get_int(4) } == 1,
        latency_ms: unsafe { rfx_get_double(0) },
    }
}

/// Opens an output and starts it. `device` -1 = the default output. `sampleRate`, `channels` and
/// `periodFrames` may be 0 to let the backend choose. Any open device is closed first.
#[napi]
pub fn open(device: i32, exclusive: bool, sample_rate: u32, channels: u32, period_frames: u32) -> Result<OpenInfo> {
    if unsafe { rfx_open(device, if exclusive { 1 } else { 0 }, sample_rate, channels, period_frames) } != 0 {
        return Err(shim_error(if exclusive { "could not open the output in exclusive mode" } else { "could not open the output" }));
    }
    Ok(open_info())
}

#[napi]
pub fn close() {
    unsafe {
        rfx_close();
    }
}

/// Starts the engine at the rate the device opened with and installs it as the device renderer.
#[napi]
pub fn engine_init(sample_rate: u32) -> Result<()> {
    if unsafe { rfx_engine_init(sample_rate) } != 0 {
        return Err(engine_error("the engine refused to start"));
    }
    unsafe { rfx_engine_attach() };
    Ok(())
}

#[napi]
pub fn engine_shutdown() {
    unsafe { rfx_engine_shutdown() }
}

#[napi]
pub fn engine_sample_rate() -> u32 {
    unsafe { rfx_engine_sample_rate() }
}

/// Decodes a whole file into a deck on the thread pool. Resolves with the track length in seconds.
pub struct LoadTask {
    deck: i32,
    path: CString,
}

impl Task for LoadTask {
    type Output = f64;
    type JsValue = f64;

    fn compute(&mut self) -> Result<f64> {
        if unsafe { rfx_deck_load(self.deck, self.path.as_ptr()) } != 0 {
            return Err(engine_error("could not load the track"));
        }
        Ok(unsafe { rfx_deck_length_seconds(self.deck) })
    }

    fn resolve(&mut self, _env: Env, output: f64) -> Result<f64> {
        Ok(output)
    }
}

#[napi]
pub fn deck_load(deck: i32, path: String) -> Result<AsyncTask<LoadTask>> {
    Ok(AsyncTask::new(LoadTask { deck: deck_index(deck)?, path: c_path(&path)? }))
}

#[napi]
pub fn deck_eject(deck: i32) {
    unsafe { rfx_deck_eject(deck) }
}

#[napi]
pub fn deck_has_track(deck: i32) -> bool {
    (unsafe { rfx_deck_has_track(deck) }) != 0
}

#[napi]
pub fn deck_length(deck: i32) -> f64 {
    unsafe { rfx_deck_length_seconds(deck) }
}

#[napi]
pub fn deck_play(deck: i32, playing: bool) {
    unsafe { rfx_deck_play(deck, if playing { 1 } else { 0 }) }
}

#[napi]
pub fn deck_playing(deck: i32) -> bool {
    (unsafe { rfx_deck_playing(deck) }) != 0
}

#[napi]
pub fn deck_seek(deck: i32, seconds: f64) {
    unsafe { rfx_deck_seek(deck, seconds) }
}

#[napi]
pub fn deck_position(deck: i32) -> f64 {
    unsafe { rfx_deck_position(deck) }
}

/// 1.0 = as recorded; the tempo slider, sync and a jog bend all land here.
#[napi]
pub fn deck_set_rate(deck: i32, rate: f64) {
    unsafe { rfx_deck_set_rate(deck, rate) }
}

/// Explicit-rate scratch (the demo's mode). The app uses `deckScratchTo` instead.
#[napi]
pub fn deck_set_scratch(deck: i32, on: bool, rate: f64) {
    unsafe { rfx_deck_set_scratch(deck, if on { 1 } else { 0 }, rate) }
}

/// Follow-the-hand scratch: send where the platter has put the playhead, once per UI frame.
#[napi]
pub fn deck_scratch_to(deck: i32, on: bool, target_seconds: f64) {
    unsafe { rfx_deck_scratch_to(deck, if on { 1 } else { 0 }, target_seconds) }
}

#[napi]
pub fn deck_set_loop(deck: i32, in_seconds: f64, out_seconds: f64, active: bool) {
    unsafe { rfx_deck_set_loop(deck, in_seconds, out_seconds, if active { 1 } else { 0 }) }
}

/// Channel strip, all 0..1 exactly as the UI and the FLX2 send them.
#[napi]
pub fn deck_set_channel(deck: i32, trim: f64, eq_hi: f64, eq_mid: f64, eq_low: f64, cfx: f64, fader: f64, pfl: bool) {
    unsafe { rfx_deck_set_channel(deck, trim, eq_hi, eq_mid, eq_low, cfx, fader, if pfl { 1 } else { 0 }) }
}

#[napi]
pub fn engine_set_master(crossfader: f64, master_level: f64, phones_level: f64, phones_mix: f64, master_cue: bool) {
    unsafe { rfx_engine_set_master(crossfader, master_level, phones_level, phones_mix, if master_cue { 1 } else { 0 }) }
}

/// Everything the UI needs per animation frame, in one call. Peaks are "since the last call".
#[napi(object)]
pub struct Snapshot {
    pub position: Vec<f64>,
    pub playing: Vec<bool>,
    pub peak: Vec<f64>,
    pub master_peak: f64,
    /// Frames rendered since the engine started (as a double: JS has no u64).
    pub frames: f64,
    pub underruns: u32,
    pub sample_rate: u32,
    /// Device callbacks so far and the largest block they asked for.
    pub callbacks: f64,
    pub max_block: f64,
}

#[napi]
pub fn snapshot() -> Snapshot {
    let decks = 0..2;
    Snapshot {
        position: decks.clone().map(|d| unsafe { rfx_deck_position(d) }).collect(),
        playing: decks.clone().map(|d| unsafe { rfx_deck_playing(d) } != 0).collect(),
        peak: decks.map(|d| unsafe { rfx_deck_peak(d) }).collect(),
        master_peak: unsafe { rfx_engine_master_peak() },
        frames: unsafe { rfx_engine_frames_rendered() } as f64,
        underruns: unsafe { rfx_engine_underruns() },
        sample_rate: unsafe { rfx_engine_sample_rate() },
        callbacks: unsafe { rfx_get_double(1) },
        max_block: unsafe { rfx_get_double(3) },
    }
}

#[napi(object)]
pub struct ProbeInfo {
    pub length_seconds: f64,
    pub sample_rate: i32,
    pub channels: i32,
}

/// Reads a file's duration, rate and channels from its headers, on the thread pool.
pub struct ProbeTask {
    path: CString,
}

impl Task for ProbeTask {
    type Output = ProbeInfo;
    type JsValue = ProbeInfo;

    fn compute(&mut self) -> Result<ProbeInfo> {
        let mut length = 0.0f64;
        let mut rate = 0i32;
        let mut channels = 0i32;
        if unsafe { rfx_probe_file(self.path.as_ptr(), &mut length, &mut rate, &mut channels) } != 0 {
            return Err(engine_error("could not read the file"));
        }
        Ok(ProbeInfo { length_seconds: length, sample_rate: rate, channels })
    }

    fn resolve(&mut self, _env: Env, output: ProbeInfo) -> Result<ProbeInfo> {
        Ok(output)
    }
}

#[napi]
pub fn probe_file(path: String) -> Result<AsyncTask<ProbeTask>> {
    Ok(AsyncTask::new(ProbeTask { path: c_path(&path)? }))
}

// ---------------------------------------------------------------------------------------------
// Library: tags and analysis. Both run on the thread pool; the analyser holds one result at a
// time in C, so runs are serialised behind a lock.

use std::sync::Mutex;

static ANALYSIS_LOCK: Mutex<()> = Mutex::new(());

#[napi(object)]
pub struct TagInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub comment: Option<String>,
    /// From the stream properties, 0 when the container did not say.
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub bitrate_kbps: u32,
    pub has_artwork: bool,
}

pub struct TagsTask {
    path: String,
}

impl Task for TagsTask {
    type Output = TagInfo;
    type JsValue = TagInfo;

    fn compute(&mut self) -> Result<TagInfo> {
        use lofty::prelude::*;
        let tagged = lofty::read_from_path(&self.path).map_err(|e| fail(format!("could not read the tags: {e}")))?;
        let props = tagged.properties();
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        let text = |f: &dyn Fn(&lofty::tag::Tag) -> Option<String>| tag.and_then(f).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        Ok(TagInfo {
            title: text(&|t| t.title().map(|s| s.into_owned())),
            artist: text(&|t| t.artist().map(|s| s.into_owned())),
            album: text(&|t| t.album().map(|s| s.into_owned())),
            album_artist: text(&|t| t.get_string(ItemKey::AlbumArtist).map(|s| s.to_string())),
            genre: text(&|t| t.genre().map(|s| s.into_owned())),
            year: tag.and_then(|t| t.date().map(|d| u32::from(d.year))).or_else(|| tag.and_then(|t| t.get_string(ItemKey::Year).and_then(|y| y.trim().get(0..4).and_then(|s| s.parse().ok())))),
            track_number: tag.and_then(|t| t.track()),
            comment: text(&|t| t.comment().map(|s| s.into_owned())),
            duration_seconds: props.duration().as_secs_f64(),
            sample_rate: props.sample_rate().unwrap_or(0),
            channels: u32::from(props.channels().unwrap_or(0)),
            bitrate_kbps: props.audio_bitrate().unwrap_or(0),
            has_artwork: tag.map(|t| !t.pictures().is_empty()).unwrap_or(false),
        })
    }

    fn resolve(&mut self, _env: Env, output: TagInfo) -> Result<TagInfo> {
        Ok(output)
    }
}

/// Reads a file's tags and stream properties (id3 / vorbis / flac / riff) without decoding audio.
#[napi]
pub fn read_tags(path: String) -> AsyncTask<TagsTask> {
    AsyncTask::new(TagsTask { path })
}

pub struct AnalysisOut {
    duration_seconds: f64,
    source_rate: i32,
    source_channels: i32,
    bpm: f64,
    bpm_confidence: f64,
    first_beat_seconds: f64,
    key: String,
    key_name: String,
    key_fit: f64,
    key_margin: f64,
    bins: i32,
    wave: Vec<u8>,
}

/// BPM, downbeat, key and the 3-band waveform (`wave`: low, mid, high bytes per bin, 100 bins/s).
#[napi(object)]
pub struct AnalysisInfo {
    pub duration_seconds: f64,
    pub source_rate: i32,
    pub source_channels: i32,
    pub bpm: f64,
    pub bpm_confidence: f64,
    pub first_beat_seconds: f64,
    /// Camelot code, e.g. "8A".
    pub key: String,
    pub key_name: String,
    pub key_fit: f64,
    /// How far ahead of the runner-up the key was; small means ambiguous (relative major/minor).
    pub key_margin: f64,
    pub bins: i32,
    pub wave: Buffer,
}

pub struct AnalyzeTask {
    path: CString,
}

impl Task for AnalyzeTask {
    type Output = AnalysisOut;
    type JsValue = AnalysisInfo;

    fn compute(&mut self) -> Result<AnalysisOut> {
        let _guard = ANALYSIS_LOCK.lock().map_err(|_| fail("the analyser lock is poisoned".into()))?;
        if unsafe { rfx_analysis_run(self.path.as_ptr()) } != 0 {
            let msg = cstr(unsafe { rfx_analysis_error() });
            unsafe { rfx_analysis_release() };
            return Err(fail(format!("could not analyse the file: {msg}")));
        }
        let bins = unsafe { rfx_analysis_int(5) }.max(0);
        let mut wave = vec![0u8; bins as usize * 3];
        let written = if bins > 0 { unsafe { rfx_analysis_wave(wave.as_mut_ptr(), wave.len() as i32) } } else { 0 };
        wave.truncate(written.max(0) as usize * 3);
        let out = AnalysisOut {
            duration_seconds: unsafe { rfx_analysis_double(0) },
            source_rate: unsafe { rfx_analysis_int(1) },
            source_channels: unsafe { rfx_analysis_int(2) },
            bpm: unsafe { rfx_analysis_double(1) },
            bpm_confidence: unsafe { rfx_analysis_double(2) },
            first_beat_seconds: unsafe { rfx_analysis_double(3) },
            key: cstr(unsafe { rfx_analysis_text(0) }),
            key_name: cstr(unsafe { rfx_analysis_text(1) }),
            key_fit: unsafe { rfx_analysis_double(4) },
            key_margin: unsafe { rfx_analysis_double(5) },
            bins: written.max(0),
            wave,
        };
        unsafe { rfx_analysis_release() };
        Ok(out)
    }

    fn resolve(&mut self, _env: Env, o: AnalysisOut) -> Result<AnalysisInfo> {
        Ok(AnalysisInfo {
            duration_seconds: o.duration_seconds,
            source_rate: o.source_rate,
            source_channels: o.source_channels,
            bpm: o.bpm,
            bpm_confidence: o.bpm_confidence,
            first_beat_seconds: o.first_beat_seconds,
            key: o.key,
            key_name: o.key_name,
            key_fit: o.key_fit,
            key_margin: o.key_margin,
            bins: o.bins,
            wave: Buffer::from(o.wave),
        })
    }
}

/// Analyses a file on the thread pool (one at a time): BPM, downbeat, key, 3-band waveform.
#[napi]
pub fn analyze(path: String) -> Result<AsyncTask<AnalyzeTask>> {
    Ok(AsyncTask::new(AnalyzeTask { path: c_path(&path)? }))
}
