# BDF Egypt

Arabic, responsive PDF toolkit built with Vite and browser-side PDF processing. Original branding and UI; not affiliated with iLovePDF.

## Run

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run build
npm test
```

Deploy the repository to Vercel. `vercel.json` configures the build, SPA tool routes and security headers. Vercel deploys Python endpoints under `api/` using `requirements.txt`.

## Available tools

36 tools: merge, split, compress, PDF→Word/text/Excel/PowerPoint/images, DOCX/XLSX/XLS/CSV/PPTX/images/HTML/text→PDF, rotate, reorder/duplicate/extract/remove pages, watermark, numbering, add text/image, draw signature, crop, raster redaction, AES-256 password protection, password-based unlocking, fill existing PDF forms, OCR text extraction in Arabic/English, camera capture, text comparison, grayscale, resave readable PDFs, metadata, flatten existing form fields, blank PDF creation, image resizing/conversion and merge→rotate→number workflow.

Favorites, recent tools and theme preference are stored locally. File data is not saved in localStorage. Downloads are temporary Blob URLs cleared on tool closure. No accounts or payment processing.

## Accurate limitations

- Browser processing limit: 40 files and 100 MB total. Very long files can exceed mobile memory. Keep the tab open while processing.
- Compression, grayscale and redaction produce raster pages and remove selectable text, links and form interactivity. Compression can increase an already optimized file.
- Word extraction preserves editable text, not PDF layout or images. Excel extraction stores text lines, not reconstructed tables. PPTX output uses page images.
- Office→PDF reconstructs text/images and can differ substantially from original formatting. Old DOC/PPT are not supported; XLS is supported. PPTX charts are not rendered. HTML is sanitized, scripts and remote images are excluded.
- OCR exports TXT; language/engine assets are served from this deployment. User documents stay local.
- Cropping adjusts visibility, not secure removal. Redaction rasterizes all pages and covers the selected region on one page; inspect output before sharing.
- Signature is a visible drawn mark, not a certificate signature. Existing form fields have limited font support; English works with the default font. Arabic should be overlaid as a rendered image using the text tool.
- Compare is textual only. Repair resaves a readable document and cannot recover severe corruption.
- Security endpoints process files and passwords temporarily in memory. They do not write uploaded files or log passwords. Known password required; no password cracking. 2.8 MB input/output cap due to Vercel request/response constraints.

## Advanced tools / activation

Four extra tools are displayed with explicit activation status; they are **not active at initial deployment**:

- PDF/A-2b archival conversion.
- Searchable Arabic/English OCR PDF.
- AI summary.
- AI translation of extracted text to TXT.

`conversion-worker/` is an optional authenticated Docker service for the first two tools. It uses OCRmyPDF, Ghostscript and Tesseract. Host it on a Docker-capable server with TLS; configure matching `CONVERSION_SERVICE_TOKEN` on the worker and Vercel, plus `CONVERSION_SERVICE_URL` on Vercel. Requests are limited to 2.8 MB, two concurrent jobs, temporary directories and 45-second subprocess timeout. Worker dependencies carry their own licenses. PDF/A output should be independently validated with veraPDF for compliance-sensitive use.

AI functions remain disabled until `AI_API_KEY`, `AI_MODEL`, and `AI_ENABLED=1` are configured. Optional `AI_BASE_URL` defaults to the OpenAI-compatible HTTPS v1 endpoint. Advanced requests require an active signed Pro license; only extracted text is transmitted to the AI provider. 60,000-character summary limit, 15,000-character translation limit and 4,000 output token cap; truncated responses are rejected. Before public AI activation, add durable usage accounting and rate limits and set a provider spending cap. Current prices fund local Pro features only; AI is explicitly excluded from currently available subscription benefits. No provider credentials are included. Full native Office fidelity needs a separate conversion integration and is not provided by the browser converter.

## Validation

`npm test` covers Arabic page ranges, rejected out-of-range input, merge, page order, duplicate pages, rotation, numbering and a PDF roundtrip. Browser/API smoke tests described in `VERIFICATION.md`.

## Subscriptions and manual payment

EGP 19 / 49 / 89 / 149 for 1 / 3 / 6 / 12 calendar months, paid once with no automatic renewal. Basic tools stay free. Pro adds per-tool local saved presets (passwords/files excluded) and sequential batch processing for compression, rotation, watermark, numbering, grayscale and text extraction. Free upload limits are unchanged.

`/pricing` shows plans, manual WhatsApp request and activation. `SUPPORT_WHATSAPP` must contain the owner's international digits, without `+` (Egypt: `20...`). Checkout stays unavailable until a number is configured. No payment gateway, money capture or stored order is claimed.

Production encrypted variables `LICENSE_SIGNING_SECRET` and `SUBSCRIPTION_ADMIN_SECRET` enable signing and manual issuance. At `/admin`, the owner enters the admin secret, plan, exact amount received, unique payment reference and explicit confirmation. The server enforces price and administrator authorization. Codes start at issuance, expire after calendar months, and are verified server-side for advanced services. Save your payment references/codes in a private ledger: no database or issuance history exists. Codes are bearer credentials, can be shared across devices, and cannot individually be revoked; rotating the signing secret invalidates all codes. Basic browser feature gates are user-experience controls, not DRM. Keep admin access private; no secret is committed or embedded in the frontend.

The owner's admin key is delivered separately. Never submit the AI provider key through the public subscription form. Redeploy after changing server environment variables.
