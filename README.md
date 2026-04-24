# mentedb-demo

Interactive demo for [MenteDB](https://mentedb.com) — experience AI memory in action.

**Live**: [demo.mentedb.com/chat](https://demo.mentedb.com/chat)

## What is this?

A side-by-side chat comparison: one AI with MenteDB memory, one without. Same model (Claude Haiku), same prompt — the only difference is persistent memory.

## Features

- **6 guided scenarios** showcasing contradiction detection, pain signals, cross-session memory, context assembly, entity resolution, and meeting recap
- **Free chat mode** with contextual hints
- **3 pre-built personas** (Developer, Student, Product Manager) with seeded memories
- **Live memory feed** showing recalls, stores, and contradictions in real-time
- **Streaming responses** in both panels simultaneously

## Architecture

```
demo.mentedb.com
├── /*       → S3 + CloudFront (Vite React SPA)
└── /api/*   → Lambda Function URL (streaming chat proxy)
```

- API keys stored in **AWS Secrets Manager** (never in code)
- Rate limiting via DynamoDB (30 msgs/hr per IP)
- Origin-locked to demo.mentedb.com

## Development

```bash
# Frontend
cd frontend && npm install && npm run dev

# Lambda (requires AWS credentials)
cd lambda/demo && npm install && npm run dev
```

## Security

This is a **public repository**. All secrets are managed via AWS Secrets Manager and are never committed to code. The Lambda validates the Origin header and rate-limits by IP.

## License

Apache 2.0
