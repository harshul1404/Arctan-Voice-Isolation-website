# Qwen LiveTranslate Dubbing Studio

Production-ready Next.js app for translating and dubbing uploaded audio or video files with Alibaba Cloud Model Studio's OpenAI-compatible `qwen3-livetranslate-flash` streaming API.

The app keeps the Alibaba API key on the server, stores uploaded files under `uploads/`, writes generated WAV/MP4 outputs under `outputs/`, and can mux translated WAV audio back onto uploaded video with FFmpeg.

## Features

- Upload WAV, MP3, M4A, MP4, MOV, or WEBM files
- Select source language, including auto detect
- Select supported Qwen target language
- Generate transcript-only, transcript + WAV audio, or transcript + WAV + dubbed MP4
- Enforce text-only target languages in the UI
- Enforce Qwen voice compatibility by target language
- Secure server-side upload and output serving by ID/name
- Robust handling for streaming text and Base64 audio chunks

This version generates translated speech using Qwen voices. Original speaker voice cloning is not included.

## Setup

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Set your Alibaba Cloud Model Studio API key:

```bash
DASHSCOPE_API_KEY=your_key_here
```

The default international endpoint is already configured:

```bash
DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
```

Run locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## FFmpeg

Video dubbing requires `ffmpeg` on the server PATH.

macOS:

```bash
brew install ffmpeg
```

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

Windows:

```bash
winget install Gyan.FFmpeg
```

## Video Input and PUBLIC_BASE_URL

Qwen video input requires a public URL. For local development, expose the Next.js server with ngrok:

```bash
ngrok http 3000
```

Then set:

```bash
PUBLIC_BASE_URL=https://your-ngrok-domain.ngrok-free.app
```

Restart `npm run dev` after changing environment variables.

For production, use object storage such as Alibaba OSS or S3 for uploaded video files instead of relying on local filesystem URLs.

## Environment Variables

```bash
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
PUBLIC_BASE_URL=http://localhost:3000
MAX_UPLOAD_MB=100
ELEVENLABS_API_KEY=
```

`DASHSCOPE_API_KEY` is read only by server routes and is never exposed to the browser.

## Supported Languages

Audio output targets:

- English, Chinese, Russian, French, German, Portuguese, Spanish, Italian, Korean, Japanese, Cantonese

Transcript-only targets:

- Indonesian, Vietnamese, Thai, Arabic, Hindi, Greek, Turkish

## Voice Compatibility

- Cherry and Nofish: Chinese, English, French, German, Russian, Italian, Spanish, Portuguese, Japanese, Korean
- Jada, Dylan, Sunny, Peter, Eric: Chinese only
- Kiki: Cantonese only

Unsupported combinations are blocked in the UI and revalidated on the server.

## API Routes

- `POST /api/upload` saves multipart uploads under `uploads/`
- `POST /api/translate` calls Qwen streaming API and writes outputs
- `GET /api/files/[fileId]` securely serves uploaded files by ID
- `GET /api/outputs/[filename]` securely serves generated outputs

## Deployment Notes

Vercel:

- Suitable for transcript and short audio workflows.
- Local filesystem writes are ephemeral, so production media should use Alibaba OSS/S3.
- FFmpeg availability depends on deployment packaging and function limits.
- Long video jobs may exceed serverless duration limits.

Render/Fly.io:

- Good fit for persistent Node services with FFmpeg installed in the image.
- Mount persistent storage or use object storage for uploads and outputs.
- Set `PUBLIC_BASE_URL` to the deployed app URL.

Production recommendation:

- Store uploads and outputs in Alibaba OSS/S3.
- Use a job queue for long video translations.
- Add authentication before exposing file routes publicly.
- For production-grade speaker-aware dubbing, set `ELEVENLABS_API_KEY`; video dubbed output will use ElevenLabs Dubbing for timing, background audio, speaker detection, and voice cloning.

## Legacy Pipeline

This repository also contains the previous FunCineForge wrapper under `translation_pipeline/`, `configs/`, `tests/`, and `ui/`. The new Next.js app lives at the repository root and does not require the legacy Python/Vite app to run.
