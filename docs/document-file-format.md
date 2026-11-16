# Document file format

A document file (`.lemon`) holds one Document so that another machine can open it. The website (`GET /api/documents/<id>/bundle`, `POST /api/documents/import`) and the CLI (`document export`, `document import`) both call `DocumentBundleService`, so they write and read the same files. It is not an Export, which is the finished image.

The container is a zip written with Node's built-in `zlib`, so no archive library is needed. It holds a deflated `manifest.json` and one `objects/<sha256>` entry per image, stored as the original bytes. Images are already compressed (PNG, JPEG, WebP), so deflating them again gains almost nothing and would cost time. AI results stay PNG byte for byte, because converting them would lose colour depth, transparency or size limits.

Storing images under the hash of their bytes does three things. An image used twice is stored once. Import checks every image against its hash, so a damaged file is refused. A future sync can ask which hashes the other side already has and send only the rest, which is why the format is content addressed.

The manifest (`src/server/bundle/manifest.ts`) is versioned. It names the document, carries its pipeline, and lists each Source (its id in the pipeline, hash and file name) and each AI result (the render key, hash, step id and file name). A file from a newer version is refused with a message to update, and one from an older version (before images were layers, version 1) is refused too, since there is no conversion for files.

Render keys name layer images and second images by their content hash instead of their per-user Source id (`planPipeline`). The same pipeline on the same pixels therefore has the same key on every machine, so an imported AI result is found again and nothing runs a second time.

Import makes a new Document for the importing User, re-adds each Source under that User, rewrites the pipeline's Source ids, and stores the results as that User's own. `LEMONIFY_MAX_BUNDLE_BYTES` (default 1 GB) limits what the website accepts.

A file is not trusted when it is opened. Every image is unpacked within the size its entry declares and checked against its hash; the images together may not exceed `LEMONIFY_MAX_BUNDLE_BYTES`, which is also the most an export will write, so a file the website made is always one it will take back. Each result must be the one its step would store under that key, in the new document, and must be an image of the type it claims; otherwise the file is refused. Zip entries are written with fixed times, so the same document always produces the same bytes, and a name appearing twice is refused.

Export and import are all or nothing. An export is built beside its destination and moved into place when whole, and removes its temporary file when it fails or when a download stops early. An import that fails removes the document and the images it added, and keeps images the User already had.

The website receives the file in the page, not through the browser's download manager, so it can show "Preparing the document…" while the server builds the file, then how much has arrived, then "Saved “name.lemon”", or the reason it failed. The cost is that the file is held in the browser's memory until it is saved, which `LEMONIFY_MAX_BUNDLE_BYTES` bounds.
