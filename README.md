# Warmup

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

Practise speaking or singing and get feedback. Built for the Pollinations quest
[pollinations/pollinations#20022](https://github.com/pollinations/pollinations/issues/20022).

Frontend only: static HTML, CSS and ES modules, with no build step and no server.

## What it does

**Speak**
- Pick a language (14 included) and level, then use a built-in phrase or generate a new one.
- Hear the phrase read aloud (`openai/tts-1`).
- Record yourself. `openai/whisper-large-v3` transcribes the take with word timestamps.
- Each word in the phrase is marked as clear, close, missed or added. Tap a word to replay that moment of your recording.
- Shows words per minute and the number of long pauses.
- `openai/gpt-audio-mini` listens to the audio itself and gives pronunciation notes for specific sounds, plus one sentence on rhythm and pace.

**Sing**
- Exercises: five-note scale, arpeggio, thirds, octave leap, one long note, or free singing.
- You hear the pattern, a count-in plays, and then you sing it. Your pitch is drawn live against the target notes, coloured green, amber or red by how far off you are.
- Pitch tracking runs in the browser (YIN), so scoring costs nothing. Each note gets a cents offset and a wobble value, and the take gets an overall sharp or flat tendency. If you sing in a different octave from the guide, the take is scored in your octave.
- "Ask the coach" sends the recording and the measured numbers to `openai/gpt-audio-mini` for feedback on tone, breath and onsets.

## Payment

Users connect with Pollinations Pay (OAuth code flow with PKCE, see
[BRING_YOUR_OWN_POLLEN.md](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md)),
so every call is paid from their own balance. The key is kept in `sessionStorage` only.
The consent link asks for a 2-pollen budget and a 7-day key.

The app is registered at enter.pollinations.ai with the redirect URI
`https://1750030692.github.io/warmup/`. Its publishable key is `APP_KEY` in `js/auth.js`.

## Run locally

```powershell
python -m http.server 8770 --directory .
```

Then open http://localhost:8770. The microphone requires `localhost` or HTTPS.

## Files

- `js/auth.js`: Pollinations Pay login
- `js/api.js`: transcription, TTS and chat calls (including audio input)
- `js/audio.js`: microphone, recording, WAV encoding, level meter
- `js/pitch.js`: pitch detection and note scoring
- `js/align.js`: word alignment between the phrase and the transcript
- `js/speak.js`, `js/sing.js`: the two practice modes
