---
name: images-cli
description: Process images with this project's `pnpm images` CLI, which runs Sharp (resize, crop, convert, compress, responsive width variants, watermark, metadata, every Sharp operation) and Upscayl AI upscaling on the GPU. Use when asked to resize, convert, compress, optimise, crop, watermark, inspect, upscale, denoise, descreen or de-JPEG images in this repository, or to generate srcset variants or an image manifest.
---

# Images CLI

`pnpm images <command>` is the project's single image tool. Every command takes a JSON job, prints JSON, and reports errors as JSON, so drive it through those interfaces rather than parsing human-readable output. The full guide is [doc/cli.md](../../doc/cli.md); every sharp field, op and option is listed in [doc/cli-sharp-reference.md](../../doc/cli-sharp-reference.md).

## Rules

1. Run it as `pnpm -s images …` from the repository. Without `-s`, pnpm prints a header before the JSON. pnpm runs the script in the project root, so relative paths resolve from there, not from your current folder; use absolute paths for anything outside the project. If the user has linked the bin (`pnpm link --global`), `lemonify-images …` works the same from any folder and resolves relative paths from the current folder.
2. Add `--json` to every call. A success prints `{"command": "<name>", "result": …}` on stdout. A failure prints `{"error": {"type", "message", "issues"?, "usage"?}}` on stderr and exits with 1.
3. Write the job to a JSON file and pass `--job @file.json`; use the scratchpad or system temp folder, not the repository. Inline JSON in a shell argument breaks on quoting. `--job` must be the only argument besides `--json` and takes the same fields as the schema; the CLI flags are only shorthands for them.
4. Look up fields instead of guessing: `pnpm -s images schema sharp` (or `upscale`, `info`, `models`) prints the JSON Schema. Unknown keys are rejected, never ignored.
5. Do a dry run before anything that writes into a folder, overwrites files or uses `inPlace`. Set `"dryRun": true` in the job (the `--dry-run` flag cannot be combined with `--job`). A dry run makes every check a real run makes and returns `{dryRun, reads, writes}`; each write has `file`, `source`, `kind` and `exists`. Show the user any `exists: true` writes before you run the job for real.
6. `inPlace` overwrites originals and cannot be undone. Use it only when the user asked to modify the files themselves; otherwise write to an `output` folder.

## Commands

| Command   | Use it to                                                                |
| --------- | ------------------------------------------------------------------------ |
| `sharp`   | Run any Sharp pipeline: convert, resize, crop, compress, variants, …     |
| `info`    | Read size, format, colour space, metadata; `stats` adds pixel statistics |
| `upscale` | Enlarge or restore images with an AI model on the GPU                    |
| `models`  | List upscale models and whether they are installed; install them         |
| `formats` | List the formats this Sharp build reads and writes                       |
| `schema`  | Print a command's JSON Schema                                            |

## Sharp jobs

A job is `{ input, output | inPlace, ops, variants?, formatOptions?, options?, settings?, recursive? }`. `input` is a file, a folder, or (with `options.join`) several files; leave it out when `options.create` or `options.text` generates the image. Each op is `{ "op": "<Sharp method>", …arguments }`.

Sharp semantics that cause wrong results if you assume otherwise:

- **Ops are not run as a script, one after another.** Sharp applies them in its own fixed pipeline order. Only the relative order of `rotate`, `extract` and `resize` matters.
- **A repeated op replaces the earlier one.** To resize, sharpen and resize again, run two jobs.
- **The output format** comes from the last format op (`jpeg`, `png`, `webp`, `avif`, `gif`, `tiff`, `heif`, `jxl`, `jp2`, `raw`, `toFormat`, `tile`), otherwise from the output file's extension. A folder input keeps each file's name and swaps the extension to match the format.
- **`variants.widths`** writes `<name>-<width>.<ext>` per width into the `output` folder. It resizes after all other ops and never enlarges.
- **`formatOptions`** sets encoder options per format (`{"jpeg": {...}, "png": {...}}`) for mixed folders. A format op's own fields win over it.
- **`inPlace` keeps each file's format.** A format op that would change it fails with `InPlaceFormatError`. `ifSmaller` keeps a file unless the result is smaller.
- **Metadata (EXIF, ICC, XMP) is stripped** unless an op keeps it (`keepMetadata`, `keepExif`, `keepIccProfile`, …).
- **AVIF output reports its format as `heif`.** That is expected.

### Recipes

Resize and convert one image, cropping to the most interesting area:

```json
{
  "input": "photo.jpg",
  "output": "photo-800.webp",
  "ops": [
    { "op": "autoOrient" },
    {
      "op": "resize",
      "width": 800,
      "height": 800,
      "fit": "cover",
      "position": "attention"
    },
    { "op": "webp", "quality": 80 }
  ]
}
```

Responsive variants of a folder with a manifest for `srcset`:

```json
{
  "input": "photos",
  "output": "public/photos",
  "recursive": true,
  "variants": {
    "widths": [480, 768, 1280, 1920],
    "manifest": "public/photos/manifest.json"
  },
  "ops": [{ "op": "autoOrient" }, { "op": "webp", "quality": 78 }]
}
```

Compress a folder in place, capping the width at 2560 px:

```json
{
  "input": "public/photos",
  "inPlace": "ifSmaller",
  "recursive": true,
  "ops": [
    { "op": "autoOrient" },
    { "op": "resize", "width": 2560, "withoutEnlargement": true }
  ],
  "formatOptions": {
    "jpeg": { "quality": 78, "mozjpeg": true },
    "png": { "quality": 85, "palette": true, "compressionLevel": 9 },
    "webp": { "quality": 78 },
    "avif": { "quality": 50 }
  }
}
```

Watermark and keep the EXIF data:

```json
{
  "input": "photo.jpg",
  "output": "stamped.jpg",
  "ops": [
    {
      "op": "composite",
      "images": [{ "input": "logo.png", "gravity": "southeast" }]
    },
    { "op": "keepExif" },
    { "op": "jpeg", "quality": 85, "mozjpeg": true }
  ]
}
```

## Upscaling

`{ "source", "destination", "model"?, "scale"?, "noise"?, "iterations"?, "ops"?, "recursive"? }`. Upscayl only runs the model; the Sharp `ops` decide the final format, size and metadata, exactly as in a sharp job.

- **It needs a Vulkan GPU.** Sandboxes and containers usually have none, and the run then fails with `UpscaleEngineError: … Invalid GPU Device`. If that happens, give the user the exact command to run in their own terminal instead of retrying.
- **A dry run needs no GPU and downloads nothing.** It reports the model, scale, `modelStatus` (`installed`, `partial`, `missing` or `custom`) and each output's `upscaledWidth`/`upscaledHeight` before the ops.
- **Missing models download automatically** (1–100 MB each, checksummed). Run `pnpm -s images models --json` to list them.
- **Model choice:**
  - `4x_NMKD-Siax_200k` (the default) or `upscayl-standard-4x` for photos;
  - `realcugan` or `realesrgan-x4plus-anime` for anime and illustration;
  - `opencomic-ai-upscale-balanced-v3` for comics;
  - `RealESRGAN_General_x4_v3` when speed matters;
  - `1x-SaiyaJin-DeJpeg` or the `artifact-removal` category to repair JPEG damage at the same size;
  - the `descreen` category for scanned print.
- **Licences differ by model**, and some community models are non-commercial. Mention this when the output is for commercial use; doc/cli.md has the details.

```json
{
  "source": "small.jpg",
  "destination": "upscaled",
  "scale": 4,
  "ops": [
    { "op": "resize", "width": 2000 },
    { "op": "avif", "quality": 60 }
  ]
}
```

## Errors

| `error.type`                                                   | What to do                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ImageOptionsError`                                            | Fix the fields named in `issues` (each line starts with the field path) and retry             |
| `CliUsageError`                                                | Fix the command line; `usage` holds the command's help                                        |
| `ImageSourceError`                                             | The input is missing or not a readable image; check the path and `pnpm images formats`        |
| `OutputCollisionError`                                         | Two sources map to one output name; process them separately or rename one                     |
| `SharpTargetError`, `UpscaleTargetError`, `InPlaceFormatError` | The output would overwrite its source or change a file's format in place; pick another output |
| `SharpOperationError`                                          | Sharp rejected an op (`ops[i] (name)` in the message) or failed on a file                     |
| `ModelDownloadError`, `ModelChecksumError`                     | Retry once; if it persists, report it and do not work around the checksum                     |
| `UpscaleEngineError`                                           | Usually no GPU; hand the command to the user                                                  |
