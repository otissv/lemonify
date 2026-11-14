# Images CLI

`pnpm images` is the project's command-line tool for working with images. It wraps two engines behind one interface: [Sharp](https://sharp.pixelplumbing.com/) (libvips) for every classic image operation, and [Upscayl](https://upscayl.org/)'s `upscayl-bin` for AI upscaling and restoration on the GPU. It is designed to be used by people at a terminal, and equally by agents and GUIs, which can discover every option as JSON Schema, pass jobs as JSON, and read results as JSON.

## Contents

1. [How it fits together](#how-it-fits-together)
2. [Requirements](#requirements)
3. [Installation and setup](#installation-and-setup)
4. [Quick start](#quick-start)
5. [Commands](#commands)
6. [Using the CLI from agents and GUIs](#using-the-cli-from-agents-and-guis)
7. [Upscale models](#upscale-models)
8. [Security](#security)
9. [Performance](#performance)
10. [Errors and exit codes](#errors-and-exit-codes)
11. [Troubleshooting](#troubleshooting)
12. [Maintenance](#maintenance)
13. [Known limitations](#known-limitations)

## How it fits together

Everything runs through a single entry point, `scripts/images/index.ts`, exposed as the `images` script in `package.json`. The first argument names a command, and everything after it belongs to that command. Each command lives in its own file under `scripts/images/commands/` and declares four things: its help text, a Zod schema describing its options, a parser that maps command-line flags onto that schema, and a function that does the work and returns a result. The shared plumbing in `scripts/images/cli.ts` turns that declaration into the behaviour every command has in common: `--help`, `--job` for passing options as JSON, `--json` for machine-readable output, and consistent error reporting. The image logic itself is not in `scripts/` at all; it lives in `src/lib/images/`, so the same functions can be used from application code and are covered by the unit tests.

The two engines have a deliberate division of labour. Sharp and Upscayl overlap in several places (output format, compression, resizing to an exact size, metadata), and in each of those Sharp is the more capable tool, so Upscayl is used for the AI inference step only. When you upscale an image, Sharp first makes sure `upscayl-bin` can read it (converting formats it cannot read and applying EXIF orientation), `upscayl-bin` then runs the model and writes a lossless PNG, and finally Sharp applies any post-processing you ask for and writes the output in its final format. This means there is one way to choose a format, one way to set quality and one way to resize, whichever command you use. For the same reason there are no separate resize or compress commands: responsive width variants and in-place compression are features of `sharp` jobs, so they combine freely with every other op in one pipeline.

`upscayl-bin` is not called directly. It is shipped, for Linux, macOS and Windows, by the `opencomic-ai-bin` npm package, whose Node API runs the binary in a long-lived background process so a model is loaded once per run rather than once per image. The project uses that API for inference, and handles model downloads itself so that every model file is verified before the binary ever sees it.

## Requirements

| Requirement                                   | Needed for                    | Notes                                                                                                                                 |
| --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 22.18 or newer                        | Everything                    | The CLI is TypeScript run directly by Node's built-in type stripping, so there is no build step. The project is developed on Node 24. |
| pnpm 10                                       | Everything                    | Install scripts of dependencies are blocked in this project, and nothing in the CLI relies on one.                                    |
| A GPU with a Vulkan driver                    | `upscale` only                | Any vendor works (AMD, Intel, NVIDIA, Apple via MoltenVK). Every other command runs on the CPU.                                       |
| Network access to `raw.githubusercontent.com` | `upscale`, `models --install` | Only to download a model the first time it is used.                                                                                   |
| About 1.4 GB of disk                          | Optional                      | Only if you install every upscale model. Each model is 1–100 MB.                                                                      |

Sharp ships prebuilt libvips binaries for the common platforms, so it needs no system libraries. The Vulkan requirement for upscaling is the only thing that has to be installed outside the project, because a GPU driver cannot be installed by a package manager for Node. On Arch-based systems (including CachyOS) that means `vulkan-icd-loader` plus the driver package for your GPU (`vulkan-radeon`, `vulkan-intel` or `nvidia-utils`); on Debian and Ubuntu it means `libvulkan1` and `mesa-vulkan-drivers` (or the NVIDIA driver). On Windows and macOS the regular graphics driver is enough. You can confirm Vulkan works with `vulkaninfo --summary` from the `vulkan-tools` package.

## Installation and setup

The CLI is part of the project, so installing the project installs the CLI:

```bash
pnpm install
```

That pulls in `sharp` and `opencomic-ai-bin`, the second of which contains the `upscayl-bin` executable for every supported platform. There is no postinstall step and nothing to compile. Confirm it works:

```bash
pnpm images --help
```

```bash
pnpm images formats
```

`formats` prints the Sharp and libvips versions and the file types this build can read and write, which is a quick way to check that Sharp loaded correctly.

Upscale models are not downloaded at install time. Each model is fetched, verified and stored in `.tools/upscayl-models/` the first time you use it, and that folder is ignored by Git. If you would rather download models ahead of time, for example before working offline, install them by name or all at once:

```bash
pnpm images models --install 4x_NMKD-Siax_200k --install realcugan
```

```bash
pnpm images models --install-all
```

## Quick start

Resize a photo to 800 px wide, cropping to the most interesting area, and save it as WebP:

```bash
pnpm images sharp --input photo.jpg --output photo-800.webp \
  --ops '[{"op":"resize","width":800,"height":800,"fit":"cover","position":"attention"},{"op":"webp","quality":80}]'
```

Generate responsive variants of every image in a folder, with a manifest for use in `srcset`:

```bash
pnpm images sharp --input ./photos --output ./public/photos --recursive \
  --widths 480,768,1280,1920 --manifest ./public/photos/manifest.json \
  --ops '[{"op":"autoOrient"},{"op":"webp","quality":78}]'
```

Shrink every image in a folder in place, keeping a file only when the new version is smaller:

```bash
pnpm images sharp --input ./public/photos --in-place ifSmaller --recursive \
  --format-options '{"jpeg":{"quality":78,"mozjpeg":true},"png":{"quality":85,"palette":true},"webp":{"quality":78},"avif":{"quality":50}}'
```

Upscale an image 4× with the default model, then let Sharp produce a 2000 px wide AVIF:

```bash
pnpm images upscale small.jpg ./upscaled \
  --ops '[{"op":"resize","width":2000},{"op":"avif","quality":60}]'
```

Inspect an image:

```bash
pnpm images info photo.jpg --stats
```

## Commands

| Command   | Engine            | What it does                                             |
| --------- | ----------------- | -------------------------------------------------------- |
| `sharp`   | Sharp             | Runs any Sharp pipeline, written as JSON ops             |
| `info`    | Sharp             | Prints image metadata and, optionally, pixel statistics  |
| `upscale` | Upscayl and Sharp | Upscales or restores images with an AI model             |
| `models`  | —                 | Lists the upscale models, or downloads and verifies them |
| `formats` | Sharp             | Lists supported formats and library versions             |
| `schema`  | —                 | Prints the JSON Schema of each command's options         |

Every command prints its full options with `--help` (or `-h`), for example `pnpm images upscale --help`. Paths can be relative to the current directory or absolute. In the output, paths inside the current directory are shown relative to it and paths outside it are shown in full.

Several commands accept either a single file or a folder. With a folder, every supported image directly inside it is processed; add `--recursive` to include subfolders, in which case the folder structure is recreated under the destination. An output folder that sits inside the source folder is skipped while scanning, so you can safely write results next to the originals.

### `sharp`: any Sharp pipeline

`sharp` exposes all of Sharp: every chainable operation, every input option and the process-wide settings. A pipeline is a list of ops, each an object whose `op` field names the Sharp method and whose other fields are that method's arguments. Arguments that Sharp takes by position get names (`rotate` takes `angle` and `background`; `gamma` takes `gamma` and `gammaOut`; `boolean` takes `operand` and `operator`), and option objects are flattened into the op. Methods that only switch something on or off, such as `flip` or `greyscale`, take an optional `enabled` field that defaults to true. The output format is set by the last format op (`jpeg`, `png`, `webp`, `avif`, `gif`, `tiff`, `heif`, `jxl`, `jp2`, `raw`, `toFormat` or `tile`) or, if there is none, by the output file's extension.

The ops are not a script that runs step by step. Sharp builds one libvips pipeline per image and applies its stages in a fixed order of its own; only the relative order of `rotate`, `extract` and `resize` matters (an `extract` given before a `resize` crops the original, one given after crops the resized image). Each op sets one stage of that pipeline, so giving the same op twice keeps only the last one rather than applying it twice. To apply an operation more than once, for example to resize, sharpen and resize again, run two jobs. The one exception the CLI adds is `--widths`, described below, which resizes after all the other ops.

| Option                    | Meaning                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--input <path>`          | An image file, or a folder of images. Repeat it to pass several images to be joined into one with `options.join`. Leave it out when `options.create` or `options.text` generates the image. |
| `--output <path>`         | The output file, or the output folder when the input is a folder or `--widths` is given                                                                                                     |
| `--in-place <mode>`       | Overwrite each source instead of writing to `--output`: `always`, or `ifSmaller` to keep the original unless the result is smaller                                                          |
| `--widths <list>`         | Comma-separated widths; writes one file per width, named `<name>-<width>.<ext>`                                                                                                             |
| `--manifest <file>`       | With `--widths`, also write a JSON manifest of every source's size and variants                                                                                                             |
| `--ops <json>`            | The array of ops                                                                                                                                                                            |
| `--format-options <json>` | Encoder options per format, such as `{"jpeg":{"quality":78}}`, used for whichever format each output is written in                                                                          |
| `--options <json>`        | Input options, as passed to `sharp(input, options)`: `create`, `text`, `join`, `raw`, `density`, `pages`, `page`, `animated`, `failOn`, `limitInputPixels`, `autoOrient` and the rest       |
| `--settings <json>`       | Process settings: `concurrency`, `cache`, `simd`, `block`, `unblock`                                                                                                                        |
| `--recursive`             | Include subfolders of a folder input                                                                                                                                                        |

The ops cover these groups of Sharp methods:

| Group               | Ops                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geometry            | `resize`, `extend`, `extract`, `trim`, `rotate`, `autoOrient`, `flip`, `flop`, `affine`                                                                                                             |
| Filters and tone    | `sharpen`, `median`, `blur`, `dilate`, `erode`, `flatten`, `unflatten`, `gamma`, `negate`, `normalise`/`normalize`, `clahe`, `convolve`, `threshold`, `boolean`, `linear`, `recomb`, `modulate`     |
| Colour and channels | `tint`, `greyscale`/`grayscale`, `pipelineColourspace`/`pipelineColorspace`, `toColourspace`/`toColorspace`, `removeAlpha`, `ensureAlpha`, `extractChannel`, `joinChannel`, `bandbool`, `composite` |
| Output format       | `jpeg`, `png`, `webp`, `gif`, `avif`, `heif`, `tiff`, `jxl`, `jp2`, `raw`, `toFormat`, `tile`                                                                                                       |
| Metadata            | `keepMetadata`, `keepExif`, `withExif`, `withExifMerge`, `keepIccProfile`, `withIccProfile`, `keepXmp`, `withXmp`, `withMetadata`, `withDensity`                                                    |
| Control             | `timeout`                                                                                                                                                                                           |

Every field of every op, input option, setting and format option, with its type, range and default, is listed in the [Sharp job reference](cli-sharp-reference.md).

Writing JSON inline gets awkward for longer pipelines, so every JSON option also accepts `@path/to/file.json` to read the value from a file, or `-` to read it from standard input. A few examples of what the command can do:

```bash
# Watermark the bottom-right corner, sharpen, and keep the EXIF data
pnpm images sharp --input photo.jpg --output stamped.jpg \
  --ops '[{"op":"composite","images":[{"input":"logo.png","gravity":"southeast"}]},{"op":"sharpen","sigma":1},{"op":"keepExif"},{"op":"jpeg","quality":85,"mozjpeg":true}]'

# Convert a whole folder to greyscale AVIF, keeping the folder structure
pnpm images sharp --input ./scans --output ./scans-avif --recursive \
  --ops '[{"op":"greyscale"},{"op":"avif","quality":55}]'

# Create a transparent 64 × 64 canvas without any input file
pnpm images sharp --output blank.png \
  --options '{"create":{"width":64,"height":64,"channels":4,"background":"#0000"}}'

# Render text as an image
pnpm images sharp --output caption.png \
  --options '{"text":{"text":"<span foreground=\"white\">Lemonify</span>","rgba":true,"dpi":150}}'

# Put two images side by side
pnpm images sharp --input left.png --input right.png --output pair.png \
  --options '{"join":{"across":2}}'

# Make Deep Zoom tiles (writes pyramid.dzi and pyramid_files/)
pnpm images sharp --input big.tif --output ./tiles/pyramid.dz --ops '[{"op":"tile","size":512}]'
```

When the input is a folder, each output keeps its source file's name. If the ops change the format, the extension changes to match, so `photo.png` converted with an `avif` op is written as `photo.avif`. Two sources that would end up with the same output name, such as `photo.jpg` and `photo.png` converted to AVIF, are refused with an `OutputCollisionError` before anything is written. Sharp reports the format of AVIF output as `heif`, since AVIF is stored in a HEIF container.

#### Responsive variants with `--widths`

`--widths` writes one copy of each source per width, named `<name>-<width>.<ext>`, for use in `srcset`; `--output` is then always a folder, even for a single input file. The extension comes from the last format op, or is the source's own when there is none. A source is never enlarged: widths larger than the image are skipped, and an image narrower than the largest width contributes its own width as its largest variant. With `--manifest`, a JSON file maps each source's path (relative to the input folder) to its width, height and variants, with each variant's path relative to `--output`.

Because Sharp keeps only one resize per pipeline, a job with `--widths` runs in two stages. The ops that change pixels (crops, rotations, filters, colour, a `resize` of your own, and so on) run once per source into a lossless intermediate that keeps the source's metadata and animation frames; that intermediate is then resized to each width, and the output ops (format, metadata and `timeout`) are applied to every variant. So `--widths` always resizes after every other op, and an `extract` that crops a 1200 px image to 600 px produces variants of at most 600 px. Width variants cannot be combined with `--in-place`, `options.join`, a generated image or the `tile` op.

```bash
# AVIF variants of one hero image, sharpened after cropping to a 16:9 banner
pnpm images sharp --input hero.jpg --output ./public/img --widths 640,1280,2560 \
  --ops '[{"op":"resize","width":2560,"height":1440,"fit":"cover","position":"attention"},{"op":"sharpen"},{"op":"avif","quality":60}]'
```

#### In-place compression with `--in-place`

`--in-place` rewrites each source file instead of writing to `--output`, keeping its name and format. With `ifSmaller` a file is only replaced when the new version is smaller, so running the same job twice is safe; with `always` every file is replaced. In place, only formats Sharp can both read and write are picked up from a folder, and a format op that would change a file's format (an `avif` op on a JPEG, say) is refused with an `InPlaceFormatError`, since the file would keep a misleading extension. Each file is encoded in memory first and then swapped in with a rename, so an error never leaves a half-written file. In-place jobs cannot be combined with `--output`, `--widths`, several inputs or the `tile` op.

#### Encoder options per format with `--format-options`

`--format-options` gives encoder options per output format. They apply to whichever format each output is written in, which is what a mixed folder needs: a JPEG gets the `jpeg` options and a PNG the `png` options. When a format op is also given, its own fields take precedence over the matching `--format-options` entry. To scale down only images that are wider than a limit while compressing, add a `resize` op with `withoutEnlargement`:

```bash
pnpm images sharp --input ./public --in-place ifSmaller --recursive \
  --ops '[{"op":"autoOrient"},{"op":"resize","width":2560,"withoutEnlargement":true}]' \
  --format-options '{"jpeg":{"quality":78,"mozjpeg":true},"png":{"quality":85,"palette":true,"compressionLevel":9},"webp":{"quality":78},"avif":{"quality":50}}'
```

### `info`: metadata and statistics

`info` prints what Sharp reads from an image: dimensions, format, colour space, channels, alpha, density, orientation, page count and more. With `--stats` it also measures the pixels: the minimum, maximum, mean and standard deviation of each channel, plus entropy, sharpness and the dominant colour. Binary blocks such as EXIF, ICC and XMP data are reported as their size in bytes, so the output is always valid JSON. The terminal output is a one-line summary per image; add `--json` to see every field.

| Option        | Default | Meaning                                                   |
| ------------- | ------- | --------------------------------------------------------- |
| `<source>`    | —       | An image file, or a folder of images                      |
| `--stats`     | off     | Also compute per-channel and whole-image pixel statistics |
| `--recursive` | off     | Include subfolders of a folder source                     |

```bash
pnpm images info ./photos --recursive --stats --json
```

`info` reads every format this Sharp build supports, including GIF, TIFF, SVG and HEIF.

### `upscale`: AI upscaling and restoration

`upscale` runs an AI model over each source and writes the results into the destination, keeping file names. It accepts any format Sharp reads, and applies the EXIF orientation before upscaling so portrait photos come out the right way up. The chosen model is downloaded and verified on first use. As described in [How it fits together](#how-it-fits-together), `upscayl-bin` only does the AI step: the output format, exact size, quality and metadata come from `--ops`, which takes the same ops as the `sharp` command. Without `--ops`, each output is written in the same format as its source.

| Option                     | Default             | Meaning                                                            |
| -------------------------- | ------------------- | ------------------------------------------------------------------ |
| `--model <name>`           | `4x_NMKD-Siax_200k` | A model from the catalogue; see `pnpm images models`               |
| `--model-path <dir>`       | none                | Use your own ncnn model from this folder…                          |
| `--model-name <name>`      | none                | …loading `<name>.param` and `<name>.bin`…                          |
| `--model-scale <n>`        | none                | …which upscales by this factor                                     |
| `--scale <n>`              | the model's largest | One of the scales the model offers                                 |
| `--noise <-1..3>`          | the model's default | Denoise level, for models that have one                            |
| `--iterations <1-3>`       | `1`                 | Run the model again on its own output (Upscayl's "double upscayl") |
| `--tile-size <px>`         | auto                | Tile size, at least 32; `0` means auto                             |
| `--max-tile-size <px>`     | `2048`              | Upper limit for the automatic tile size                            |
| `--memory-percent <1-100>` | `50`                | Share of GPU memory automatic tiling may plan for                  |
| `--gpu <id>`               | `auto`              | A device index, or a list such as `0,1` for several GPUs           |
| `--threads <n>`            | binary default      | Worker threads for loading, processing and saving                  |
| `--tta`                    | off                 | Test-time augmentation: about 8× slower, slightly better results   |
| `--fp32`                   | off                 | Force 32-bit floating-point inference                              |
| `--ops <json>`             | none                | Sharp ops applied to the upscaled image                            |
| `--recursive`              | off                 | Include subfolders and keep their structure                        |

`--scale` and `--noise` are checked against what the chosen model supports, and the error says what is available, so `--scale 8` with a model that offers 2, 3 and 4 fails before anything runs. `--iterations` multiplies the scale with each pass: two passes at 4× give 16×.

```bash
# Anime artwork: RealCUGAN at 2× with light denoising, two passes
pnpm images upscale cover.png ./out --model realcugan --scale 2 --noise 0 --iterations 2

# Remove JPEG artifacts without changing the size
pnpm images upscale ./scans ./clean --recursive --model 1x-SaiyaJin-DeJpeg

# Upscale for print: Upscayl's own model, then an exact 4000 px wide TIFF
pnpm images upscale photo.jpg ./print --model upscayl-standard-4x \
  --ops '[{"op":"resize","width":4000},{"op":"tiff","compression":"lzw"}]'

# Your own model, stored as ./my-models/my-model-2x.param and .bin
pnpm images upscale photo.jpg ./out --model-path ./my-models --model-name my-model-2x --model-scale 2
```

### `models`: the model catalogue

`models` lists every model `upscale` can run, with its category, scales, download size and whether it is installed. Installed means every file is present with the expected size; the full checksum is verified whenever a model is installed or used.

| Option              | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `--category <name>` | Only list `upscale`, `descreen` or `artifact-removal` models |
| `--install <name>`  | Download and verify a model; repeat for several              |
| `--install-all`     | Download and verify every model (about 1.4 GB)               |

### `formats` and `schema`

`formats` lists every format the installed Sharp build knows about, whether it can read and write it, and the file extensions it recognises, together with the Sharp and libvips versions. `schema` prints the JSON Schema of the options each command accepts, which is described in the next section.

## Using the CLI from agents and GUIs

Every command has the same machine interface, built from three parts.

**`--job <json>`** passes all of a command's options as one JSON object instead of flags. The object has the same shape as the command's schema, so `{"input":"in","output":"out","variants":{"widths":[640,1280]}}` is equivalent to `pnpm images sharp --input in --output out --widths 640,1280`. Like the other JSON options, it accepts inline JSON, `@file.json`, or `-` for standard input, which avoids any shell quoting. When `--job` is used it must be the command's only argument (apart from `--json`).

**`schema`** prints the JSON Schema (draft 2020-12) of each command's options, so a GUI can generate forms and an agent can validate a job before running it. `pnpm images schema` prints every command's schema keyed by command name, and `pnpm images schema upscale` prints one. The schemas include enumerations (model names, fit modes, colour spaces), ranges and short descriptions. The schema for `sharp` covers every op and option and is about 68 KB.

**`--json`** changes the output to a single JSON document, and can appear anywhere on the command line. On success the result is printed to standard output as `{"command": "<name>", "result": …}`, where the result is the same data the human-readable output is built from: output paths, dimensions, formats, byte sizes and so on. On failure, an error object is printed to standard error instead and the exit code is 1.

```bash
echo '{"input":"photo.jpg","output":"thumb.webp","ops":[{"op":"resize","width":320},{"op":"webp"}]}' \
  | pnpm -s images sharp --job - --json
```

```json
{
  "command": "sharp",
  "result": [
    {
      "source": "/home/me/project/photo.jpg",
      "sourceBytes": 448343,
      "outputs": [
        {
          "file": "/home/me/project/thumb.webp",
          "written": true,
          "info": {
            "format": "webp",
            "width": 320,
            "height": 240,
            "channels": 3,
            "premultiplied": false,
            "hasAlpha": false,
            "size": 13774
          }
        }
      ]
    }
  ]
}
```

A `sharp` result has one entry per source, each with an `outputs` array: one output normally, one per width with `--widths`. `sourceBytes` is the size of a single source file (`null` for joined or generated images), and `written` is `false` when `--in-place ifSmaller` kept the original because the result was not smaller.

Use `pnpm -s` (silent) when another program reads the output, so pnpm does not print its own header before the JSON.

## Upscale models

The catalogue has 59 models in three categories. All of them run on `upscayl-bin`, and every file is pinned by SHA-256 in `src/lib/images/upscale-models.json`.

| Category           | Models | What they do                                                                     |
| ------------------ | ------ | -------------------------------------------------------------------------------- |
| `upscale`          | 35     | Enlarge images by 2×, 3× or 4× (waifu2x models: 2×, 4× or 8×)                    |
| `descreen`         | 12     | Remove halftone and screentone dot patterns from scanned print, at the same size |
| `artifact-removal` | 12     | Repair JPEG and compression damage, at the same size                             |

The models come from two sources. Fifty-five come from the [opencomic-ai-models](https://github.com/ollm/opencomic-ai-models) repository, at the commit `opencomic-ai-bin` 1.6.1 is built against. They are a mix of OpenComic's own models (`opencomic-ai-*`, trained for comics and manga), the Real-ESRGAN, Real-CUGAN and waifu2x families, and community ESRGAN models such as Remacri, UltraSharp, Siax and Nomos. The other four are Upscayl's own models (`upscayl-standard-4x`, `upscayl-lite-4x`, `high-fidelity-4x` and `digital-art-4x`), taken from the [Upscayl repository](https://github.com/upscayl/upscayl) at a fixed commit.

Some reasonable starting points are `4x_NMKD-Siax_200k` (the default) or `upscayl-standard-4x` for photos, `realcugan` or `realesrgan-x4plus-anime` for anime and illustrations, `opencomic-ai-upscale-balanced-v3` for comics, `RealESRGAN_General_x4_v3` when speed matters, and `1x-SaiyaJin-DeJpeg` for heavily compressed JPEGs. Within the OpenComic families, `compact` and `fast` versions are the smallest and quickest, the unsuffixed or `quality` versions are the largest and best, and `lite` and `balanced` versions sit in between.

Licences differ by model, so check them before commercial use. The opencomic-ai-models repository is MIT-licensed. OpenComic's own models are licensed CC BY 4.0, which requires crediting "OpenComic AI by Oleguer Llopart Mora" wherever their output is used or shared. Upscayl's four models are in an AGPL-3.0 repository. The community models each have their own licence, listed on [OpenModelDB](https://openmodeldb.info/), and some of them are non-commercial.

You can also run any ncnn model of your own with `--model-path`, `--model-name` and `--model-scale`. Custom models are not checksummed, since the project has nothing to compare them against; a custom model's name may not be the same as a catalogue model's name.

## Security

Model files are executable input to a native binary, so the project treats them as untrusted until they have been verified. Every file of every catalogue model is listed with its SHA-256 and size in `src/lib/images/upscale-models.json`, and is downloaded from a URL that names a specific Git commit, so the content behind each URL never changes. Before a model is used, each of its files is hashed; a file that is missing or does not match is downloaded again, and a download is accepted only if its hash matches the pinned value. Downloads are written to a temporary `.part` file and renamed into place only after verification, so an interrupted or tampered download never leaves a usable file behind. Because the files are always present and verified before inference starts, `opencomic-ai-bin`'s own downloader, which does not verify checksums, is never triggered.

All options, including every JSON value, are validated with Zod before anything runs. Unknown keys in JSON objects are rejected rather than ignored, for every command, so a misspelled option fails loudly instead of being silently dropped. Errors are reported without stack traces. The CLI reads and writes only the paths you give it, plus `.tools/upscayl-models/` for models and the system temporary folder for intermediate upscale files, which are deleted when each image is finished.

## Performance

Sharp is fast and runs on the CPU, using all cores by default. For batch work you can tune it with `--settings`: `concurrency` sets the number of libvips threads, `cache` sets or disables its operation cache, and `simd` switches vector instructions on or off. The `timeout` op stops processing of an image that takes longer than a given number of seconds, which is useful when processing untrusted input.

Upscaling runs on the GPU and is much slower, so its settings matter more. By default the tile size is chosen automatically from the model's measured memory use and the GPU's available memory; `--memory-percent` controls how much of that memory may be planned for, and `--max-tile-size` caps the tile size. Larger tiles are faster but need more memory, and lowering either value is the fix for out-of-memory errors. `--tta` improves quality slightly by running each tile eight times with different rotations, at roughly eight times the cost. Model size is the biggest factor: compact models of 1–5 MB are many times faster than the 33–100 MB ESRGAN models, so `RealESRGAN_General_x4_v3` or an OpenComic `compact` model is a good choice for large batches. Each `upscale` run keeps one `upscayl-bin` process alive with the model loaded, so processing a folder in one run is much faster than running the command once per image.

## Errors and exit codes

The exit code is 0 on success and 1 on any error. In human-readable mode the error message is printed to standard error, followed by the command's help text when the problem was with the command line. With `--json`, standard error contains one JSON object:

```json
{
  "error": {
    "type": "ImageOptionsError",
    "message": "Invalid image options:\n  - ops.0.fit: Invalid option: expected one of \"contain\"|\"cover\"|\"fill\"|\"inside\"|\"outside\"",
    "issues": [
      "ops.0.fit: Invalid option: expected one of \"contain\"|\"cover\"|\"fill\"|\"inside\"|\"outside\""
    ]
  }
}
```

`issues` is present for validation errors and gives one line per problem, each starting with the path to the field. `usage` is present for command-line errors and contains the help text.

| Type                                     | Meaning                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `CliUsageError`                          | Unknown command or flag, wrong number of paths, or invalid JSON in a JSON option                       |
| `ImageOptionsError`                      | An option failed validation; see `issues`                                                              |
| `ImageSourceError`                       | A source is missing, unreadable, or not a supported image                                              |
| `OutputCollisionError`                   | Two sources would be written to the same output file                                                   |
| `SharpTargetError`, `UpscaleTargetError` | An output would overwrite its own source                                                               |
| `InPlaceFormatError`                     | An `--in-place` job's format op would change a file's format                                           |
| `SharpOperationError`                    | Sharp rejected an op (the message names it, as in `ops[1] (resize)`) or failed while processing a file |
| `ModelDownloadError`                     | A model file could not be downloaded                                                                   |
| `ModelChecksumError`                     | A downloaded model file did not match its pinned SHA-256; nothing was written                          |
| `UpscaleEngineError`                     | `upscayl-bin` failed on an image, for example because no Vulkan GPU was found                          |

## Troubleshooting

**`Upscaling "…" failed: Invalid GPU Device`** means `upscayl-bin` could not find a Vulkan device. Check that a Vulkan loader and driver are installed (see [Requirements](#requirements)) and that `vulkaninfo --summary` lists your GPU. Containers and sandboxes often have no GPU access at all, in which case upscaling has to run outside them.

**Out-of-memory errors or a crash during upscaling** usually mean the tiles are too large for the GPU. Try `--memory-percent 30` or a fixed `--tile-size 256`.

**`Model file … failed verification`** means a download did not match its pinned checksum. It is safe to try again, since nothing was written. If it keeps failing, something between you and GitHub is changing the file, and you should not work around the check.

**`Cannot download model file`** means the model host could not be reached. Install the model on a machine with network access with `pnpm images models --install <name>`, then copy `.tools/upscayl-models/` across.

**An `--ops` value fails with `invalid JSON`** is almost always shell quoting. Put the JSON in a file and pass `--ops @ops.json`, or pipe it in with `--ops -`.

**An op seems to be ignored** when it appears twice in `--ops`: Sharp keeps only the last of each op, and applies them in its own pipeline order (see the [`sharp` command](#sharp-any-sharp-pipeline)). Split the work into two jobs.

## Maintenance

The model manifest is generated, not written by hand. After upgrading `opencomic-ai-bin`, or after moving the Upscayl commit pinned in `src/lib/images/upscale-models.ts`, regenerate it with:

```bash
node --disable-warning=ExperimentalWarning scripts/images/pin-models.ts
```

The script reads the model list from `opencomic-ai-bin` and the Upscayl models from the pinned commit, downloads every file once (about 1.4 GB), and rewrites `src/lib/images/upscale-models.json` with fresh checksums and sizes. Review the diff before committing it: an existing file whose checksum changed without a version or commit change is a warning sign. When `opencomic-ai-bin` changes the commit it downloads from, update `OPENCOMIC_MODELS_URL` in `src/lib/images/upscale-models.ts` to match first.

The [Sharp job reference](cli-sharp-reference.md) is generated from the same Zod schemas. After changing an op, option or job field, regenerate it with:

```bash
node --disable-warning=ExperimentalWarning scripts/images/gen-sharp-reference.ts
```

A test fails while the committed reference is out of date, so it cannot drift from the schemas unnoticed.

The CLI's tests run with the rest of the project's tests (`pnpm test`). They cover option validation, every command's flag parsing, the Sharp pipeline, model installation and the upscale pipeline. The upscale tests use a stand-in for the GPU, so they run anywhere; `upscayl-bin` itself is only exercised by real runs.

## Known limitations

- Upscayl's prepadding option (`-P`) is not available, because `opencomic-ai-bin`'s API does not pass it to the binary.
- Upscaling does not copy the source's EXIF data to the output. Sharp can only keep metadata from the image it is processing, which at that point is the model's output, so `keepExif` in `--ops` has nothing to keep.
- `--in-place` only rewrites formats Sharp can write (JPEG, PNG, WebP, GIF, AVIF, HEIF, TIFF, JPEG XL, JPEG 2000, as far as the installed build supports them); other readable formats in a folder, such as SVG or PDF, are skipped.
- The manifest written by `--manifest` records the height of the first frame for animated images, and uses `/` as the path separator on every platform.
- In the JSON Schema, the `options` field of the `toFormat` op accepts any object. The CLI still validates it against the chosen format; the format-specific ops (`jpeg`, `webp`, …) have fully typed options in the schema.
- Some invalid Sharp arguments, such as a singular `affine` matrix, are only rejected while the image is being written. Those errors name the file being processed rather than the op.
