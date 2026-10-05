# BDF Egypt verification

Validated locally on 2026-10-05. Vercel deployment is blocked: the connected app returned HTTP 403, `You don't have permission to create the project.` No live URL has been issued.

## Browser checks

Headless Chromium, desktop 1440×1000 and mobile 390×844. Page loads, 40 catalog tools render, no horizontal overflow on mobile, search and favorites work. Fixed compound Lucide icon names to render correctly. No JavaScript page errors in the functional run.

Uploaded synthetic two-page and one-page PDFs, exercised the UI, followed generated download Blob URLs, and parsed the output files to verify real content/page counts:

- Merge, extraction, rotation, page order/duplication, removal, numbering, watermark, cropping, metadata, grayscale, redaction, text overlay, resave, flatten.
- Split and PDF-image ZIP output, blank PDF, Arabic HTML-to-PDF, text comparison.
- PDF→DOCX→PDF, PDF→XLSX→PDF, PDF→PPTX→PDF.
- Form creation fixture, UI field filling and re-read of the filled value.
- Pointer-drawn signature and generated PDF.
- Image→PDF, scanner image upload→PDF, image conversion ZIP.
- OCR on a synthetic English image; self-hosted engine/language downloads, recognized expected text. Arabic language assets are included, but Arabic OCR recognition accuracy has not been measured.
- UI→Python security route→AES encryption→unlock with known password→valid PDF. A separate Python test rejected a wrong password.

Unit tests cover Arabic page ranges, invalid/out-of-range inputs, merge, page selection/order/duplicates, rotation, numbering and PDF roundtrip.

## Limits of verification

Native camera hardware capture was not exercised; image upload for the scanner was. Conversion-worker PDF/A/searchable-OCR tools and AI provider calls were not activated or tested live. The advanced tools display disabled activation state when their service is absent. Production Vercel API bundling and runtime have not been verified because project creation was denied. Office conversion accuracy beyond the synthetic fixtures is not guaranteed; see README.
