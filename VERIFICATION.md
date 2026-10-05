# BDF Egypt verification

Validated locally and deployed to production on 2026-10-05. Public URL: https://bdf-egypt.vercel.app/

Production deployment `dpl_Fs81HPuV7edeCzJrmFSZLUfkKrwb` reached READY from commit `263e95f1c4b8fb6249efc15782c9295d48967e52`. Imported through the authenticated Vercel browser interface after the connector could not create the project.

## Production smoke checks

The public homepage rendered the Arabic toolkit. Uploaded synthetic PDFs through the UI; merging produced a ready download result. Password protection ran through the deployed Python API and produced a ready encrypted PDF result in two seconds. Cloud browser download synchronization did not complete within the observation timeout, so these production checks confirm generated results in the UI; binary roundtrip/download contents were verified in the local tests below.

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

Native camera hardware capture was not exercised; image upload for the scanner was. Conversion-worker PDF/A/searchable-OCR tools and AI provider calls were not activated or tested live. The advanced tools display disabled activation state when their service is absent. Production Python security API bundling and execution were verified through the deployed UI. Office conversion accuracy beyond the synthetic fixtures is not guaranteed; see README.
